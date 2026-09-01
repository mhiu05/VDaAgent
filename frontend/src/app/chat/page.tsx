"use client";

import Link from "next/link";
import React, { ChangeEvent, FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, archiveDurableConversation, createDurableConversation, createProfile, deleteDurableConversation, getChatSuggestions, getDurableConversation, getProfile, listDatasets, listDurableConversations, listRuns, streamQuestion, submitChatFeedback, uploadDataset, waitForProfilingJob, type DurableConversation, type DurableConversationMessage, type QAHistoryMessage } from "@/lib/api";
import type { AnswerSource, Profile } from "@/lib/types";
import { createConversation, getConversation, getConversationSnapshot, listConversations, updateConversationSnapshot, type ChatContextSnapshot, type ChatMessage, type ChatSuggestion } from "@/lib/chat-history";
import { ChatAnswer } from "@/components/chat-answer";
import { ChatMessageActions } from "@/components/chat-message-actions";
import { ChatProgress } from "@/components/chat-progress";
import { chatHistory, chatMessagePatch, initialChatStream, reduceChatStream } from "@/lib/chat-core";
import { LoadingButton, ProgressSteps } from "@/components/ui";
import { profileRunOptionLabel } from "@/components/profile-run-picker";

type AgentState = "ready" | "uploading" | "profiling" | "thinking" | "error";
type ScanMode = "sample" | "full";

const starters = [
  "Tóm tắt chất lượng dữ liệu của tôi",
  "Cột nào có rủi ro PII cao nhất?",
  "Có cột nào phù hợp làm candidate key không?",
];
const ACTIVE_PROFILE_JOB_KEY = "p170_active_profile_job";

function contextForProfile(profile: Profile | null): ChatContextSnapshot | undefined {
  if (!profile) return undefined;
  return {
    datasetId: profile.dataset_id,
    datasetName: profile.dataset_name || undefined,
    profileRunId: profile.profile_run_id,
    profileRunLabel: profile.run_name || (profile.version ? `Version ${profile.version}` : undefined),
    scanMode: profile.scan_mode || undefined,
    rowScope: profile.is_approximate ? "sample" : "full",
    rowCount: profile.row_count ?? undefined,
    profiledAt: profile.updated_at || profile.created_at || undefined,
    proposalStatus: profile.pending_proposals ? "review required" : "reviewed",
  };
}

function makeMessage(
  role: ChatMessage["role"],
  text: string,
  label?: string,
  sources?: AnswerSource[],
  status?: ChatMessage["status"],
  statusDetail?: string,
): ChatMessage {
  return { id: `${Date.now()}-${Math.random()}`, role, text, label, sources, status, statusDetail };
}

function durableContext(snapshot: Record<string, unknown> | null | undefined): ChatContextSnapshot | undefined {
  if (!snapshot) return undefined;
  return {
    datasetId: typeof snapshot.dataset_id === "string" ? snapshot.dataset_id : undefined,
    datasetName: typeof snapshot.dataset_name === "string" ? snapshot.dataset_name : undefined,
    profileRunId: typeof snapshot.profile_run_id === "string" ? snapshot.profile_run_id : undefined,
    profileRunLabel: typeof snapshot.profile_run_label === "string" ? snapshot.profile_run_label : undefined,
    scanMode: typeof snapshot.scan_mode === "string" ? snapshot.scan_mode : undefined,
    rowScope: typeof snapshot.row_scope === "string" ? snapshot.row_scope : undefined,
    rowCount: typeof snapshot.row_count === "number" ? snapshot.row_count : undefined,
    profiledAt: typeof snapshot.profiled_at === "string" ? snapshot.profiled_at : undefined,
    proposalStatus: typeof snapshot.proposal_status === "string" ? snapshot.proposal_status : undefined,
    contextVersionId: typeof snapshot.context_version_id === "string" ? snapshot.context_version_id : undefined,
  };
}

function durableMessage(message: DurableConversationMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    label: message.role === "agent" ? "VDaAgent" : "Báº¡n",
    status: message.status === "running" ? "streaming" : message.status === "cancelled" ? "cancelled" : message.status === "completed" ? undefined : "error",
    requestId: message.request_id || undefined,
    agentRunId: message.agent_run_id || undefined,
    parentMessageId: message.parent_message_id || undefined,
    retryOf: message.retry_of || undefined,
    regenerationOf: message.regeneration_of || undefined,
    answerEnvelope: message.answer_envelope || undefined,
    context: durableContext(message.context_snapshot),
    conversationId: message.conversation_id,
    lifecycle: message.status === "completed" ? "completed" : message.status === "cancelled" ? "cancelled" : message.status === "running" ? "answering" : "failed",
  };
}

function ChatStatsPreview({ profile }: { profile: Profile }) {
  const columns = Object.entries(profile.column_stats);
  return <section className="chat-stats-preview" aria-label="Thống kê từng cột">
    <div className="chat-stats-caption"><span>Xem trước từ compute engine</span><b>{columns.length} cột đã phân tích</b></div>
    <div className="chat-table-wrap"><table className="chat-table"><thead><tr><th>Cột</th><th>Kiểu</th><th>Thiếu</th><th>Cardinality</th><th>Unique</th></tr></thead><tbody>{columns.map(([name, stat]) => <tr key={name}><td><b>{name}</b>{stat.pii_masked ? <small className="chat-pii">Đã bảo vệ PII</small> : null}</td><td>{stat.dtype || "—"}</td><td className={Number(stat.null_pct || 0) > 0 ? "chat-metric-warning" : ""}>{Number(stat.null_pct || 0).toFixed(2)}%</td><td>{Number(stat.cardinality || 0).toLocaleString()}</td><td>{(Number(stat.uniqueness_ratio || 0) * 100).toFixed(2)}%</td></tr>)}</tbody></table></div>
  </section>;
}

function renderInlineMarkdown(text: string): ReactNode {
  const cleaned = text.replace(/"{1,2}([^"\n]+?)"{1,2}/g, "$1");
  const tokens = cleaned.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g);
  return tokens.map((token, tokenIndex) => {
    const code = token.match(/^`(.+)`$/);
    if (code) return <code key={`code-${tokenIndex}`}>{code[1]}</code>;
    const bold = token.match(/^\*\*(.+)\*\*$|^__(.+)__$/);
    if (bold) return <strong key={`strong-${tokenIndex}`}>{bold[1] || bold[2]}</strong>;
    return token.replace(/^_(.+)_$/, "$1");
  });
}

function MarkdownMessage({ text, profile }: { text: string; profile: Profile | null }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const indentation = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    if (!line) { index += 1; continue; }
    if (line.startsWith("### ") || line.startsWith("## ")) {
      const heading = line.replace(/^#{2,3}\s*/, "");
      if (profile && heading.toLocaleLowerCase("vi").includes("thống kê từng cột")) {
        blocks.push(<ChatStatsPreview key={`stats-${index}`} profile={profile} />);
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith("##")) index += 1;
        continue;
      }
      blocks.push(<h4 key={`heading-${index}`}>{renderInlineMarkdown(heading)}</h4>);
      index += 1;
      continue;
    }
    if (/^\d+\.\s+.+:$/.test(line)) {
      blocks.push(<h4 key={`numbered-heading-${index}`}>{renderInlineMarkdown(line)}</h4>);
      index += 1;
      continue;
    }
    if (line.endsWith(":")) {
      if (/^(?:-\s+)?(Cột .*|Outlier):$/.test(line)) {
        const sectionLabel = line.startsWith("- ") ? line.slice(2) : line;
        blocks.push(<div className="markdown-section-heading" key={`section-${index}`}><span aria-hidden="true">−</span>{renderInlineMarkdown(sectionLabel)}</div>);
        index += 1;
        continue;
      }
      blocks.push(<h5 key={`subheading-${index}`}>{renderInlineMarkdown(line)}</h5>);
      index += 1;
      continue;
    }
    if (line.startsWith("|") && lines[index + 1]?.trim().startsWith("| ---")) {
      const headers = line.split("|").slice(1, -1).map((cell) => cell.trim());
      index += 2;
      const rows: string[][] = [];
      while (lines[index]?.trim().startsWith("|")) {
        rows.push(lines[index].split("|").slice(1, -1).map((cell) => cell.trim()));
        index += 1;
      }
      blocks.push(<div className="chat-table-wrap" key={`table-${index}`}><table className="chat-table"><thead><tr>{headers.map((header) => <th key={header}>{renderInlineMarkdown(header)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (indentation > 0 && line.startsWith("- ")) {
      blocks.push(<div className="markdown-detail-item nested" key={`nested-detail-${index}`}>{renderInlineMarkdown(line.slice(2))}</div>);
      index += 1;
      continue;
    }
    if (line.startsWith("- ") && /:$/.test(line)) {
      blocks.push(<div className="markdown-section-heading" key={`section-${index}`}><span aria-hidden="true">−</span>{renderInlineMarkdown(line.slice(2))}</div>);
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (lines[index]?.trim().startsWith("- ")) { items.push(lines[index].trim().slice(2)); index += 1; }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    if (line.startsWith("`") || line.startsWith("**") || line.startsWith("__") || line.startsWith("Outlier") || /(?:null%|cardinality|uniqueness ratio|outlier count)\s*=/.test(line)) {
      blocks.push(<div className={`markdown-detail-item${indentation > 0 ? " nested" : ""}`} key={`detail-${index}`}>{renderInlineMarkdown(line)}</div>);
      index += 1;
      continue;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(line)}</p>);
    index += 1;
  }
  return <div className="markdown-message chat-markdown-message">{blocks}</div>;
}

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    makeMessage("agent", "Xin chào, tôi là VDaAgent. Hãy chọn dataset và profile run đã có trong workspace; tôi sẽ trả lời dựa trên evidence đã tính. Nếu cần, bạn vẫn có thể upload nhanh bằng nút ＋ bên dưới.", "VDaAgent"),
  ]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("sample");
  const [question, setQuestion] = useState("");
  const [answerDetail, setAnswerDetail] = useState<"quick" | "standard" | "deep">("standard");
  const [state, setState] = useState<AgentState>("ready");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileProgress, setProfileProgress] = useState(0);
  const [profileStage, setProfileStage] = useState("Sẵn sàng");
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<AnswerSource[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [durableConversations, setDurableConversations] = useState<DurableConversation[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const draftRef = useRef("");
  const responseSourcesRef = useRef<AnswerSource[]>([]);
  const assistantMessageId = useRef<string | null>(null);
  const streamSequence = useRef(0);
  const hydrated = useRef(false);
  const activeConversationRef = useRef<string | null>(null);
  const pendingSnapshotRef = useRef<{
    conversationId: string;
    snapshot: {
      messages: ChatMessage[];
      profile: Profile | null;
      datasetId: string | null;
      profileRunId: string | null;
      answerDetail: "quick" | "standard" | "deep";
      sources: AnswerSource[];
    };
  } | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const profileSubmission = useRef<{ signature: string; key: string } | null>(null);
  const datasets = useQuery({ queryKey: ["chat-datasets"], queryFn: ({ signal }) => listDatasets(signal) });
  const runs = useQuery({ queryKey: ["chat-runs", selectedDatasetId], queryFn: () => listRuns(selectedDatasetId), enabled: Boolean(selectedDatasetId) });
  const completedRuns = runs.data?.filter((run) => run.status === "completed") || [];

  function flushPendingSnapshot() {
    const pendingSnapshot = pendingSnapshotRef.current;
    if (!pendingSnapshot) return;
    updateConversationSnapshot(pendingSnapshot.conversationId, pendingSnapshot.snapshot);
    pendingSnapshotRef.current = null;
  }

  useEffect(() => () => {
    streamSequence.current += 1;
    controller.current?.abort();
    if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    flushPendingSnapshot();
  }, []);

  function refreshConversationProfile(targetConversationId: string, savedProfile: Profile | null, savedProfileRunId?: string | null) {
    const profileRunId = savedProfile?.profile_run_id || savedProfileRunId;
    if (!profileRunId) {
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    void getProfile(profileRunId).then((freshProfile) => {
      if (activeConversationRef.current !== targetConversationId) return;
      setProfile(freshProfile);
      setSelectedDatasetId(freshProfile.dataset_id);
      setSelectedRunId(freshProfile.profile_run_id);
    }).catch((reason) => {
      if (activeConversationRef.current !== targetConversationId) return;
      // A browser snapshot can outlive a deleted profile or an old DB. Do not
      // keep sending that ID to QA; the conversation itself remains usable.
      if (reason instanceof ApiError && reason.status === 404) {
        setProfile(null);
        setSources([]);
        setError(null);
      }
    }).finally(() => {
      if (activeConversationRef.current === targetConversationId) setProfileLoading(false);
    });
  }

  useEffect(() => {
    const queryConversation = new URLSearchParams(window.location.search).get("conversation");
    let cancelled = false;
    const hydrateLegacy = () => {
      const conversation = queryConversation ? getConversation(queryConversation) : null;
      const current = conversation || listConversations()[0] || createConversation();
      if (!queryConversation) window.history.replaceState({}, "", `/chat?conversation=${current.id}`);
      activeConversationRef.current = current.id;
      setConversationId(current.id);
      const saved = getConversationSnapshot(current.id);
      if (saved?.messages.length) setMessages(saved.messages);
      if (saved?.profile) setProfile(saved.profile);
      setSelectedDatasetId(saved?.datasetId || saved?.profile?.dataset_id || "");
      setSelectedRunId(saved?.profileRunId || saved?.profile?.profile_run_id || "");
      setAnswerDetail(saved?.answerDetail || "standard");
      if (saved?.sources) setSources(saved.sources);
      refreshConversationProfile(current.id, saved?.profile || null, saved?.profileRunId);
      hydrated.current = true;
    };
    void (async () => {
      try {
        const list = await listDurableConversations({ limit: 30 });
        if (cancelled) return;
        setDurableConversations(list);
        const localRequested = queryConversation ? getConversation(queryConversation) : null;
        // A legacy browser conversation remains local until the user sends a
        // new message. We never upload its existing history automatically.
        if (localRequested && !list.some((item) => item.id === localRequested.id)) {
          hydrateLegacy();
          return;
        }
        const selected = queryConversation
          ? await getDurableConversation(queryConversation)
          : list.length
            ? await getDurableConversation(list[0].id)
            : { conversation: await createDurableConversation(), messages: [] };
        if (cancelled) return;
        const current = selected.conversation;
        const hydratedMessages = selected.messages.map(durableMessage);
        const latestContext = [...hydratedMessages].reverse().find((message) => message.context)?.context;
        activeConversationRef.current = current.id;
        setConversationId(current.id);
        if (!queryConversation) window.history.replaceState({}, "", `/chat?conversation=${current.id}`);
        setMessages(hydratedMessages.length ? hydratedMessages : [makeMessage("agent", "Xin chÃ o, tÃ´i lÃ  VDaAgent. HÃ£y chá»n dataset vÃ  profile run Ä‘Ã£ cÃ³ trong workspace; tÃ´i sáº½ tráº£ lá»i dá»±a trÃªn evidence Ä‘Ã£ tÃ­nh.", "VDaAgent")]);
        setSelectedDatasetId(latestContext?.datasetId || current.active_dataset_id || "");
        setSelectedRunId(latestContext?.profileRunId || current.active_profile_run_id || "");
        setAnswerDetail("standard");
        refreshConversationProfile(current.id, null, latestContext?.profileRunId || current.active_profile_run_id);
        hydrated.current = true;
        if (!list.some((item) => item.id === current.id)) setDurableConversations((items) => [current, ...items]);
      } catch {
        if (!cancelled) hydrateLegacy();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const jobId = localStorage.getItem(ACTIVE_PROFILE_JOB_KEY);
    if (!jobId) return;
    const abort = new AbortController();
    setState("profiling");
    setProfileLoading(true);
    void waitForProfilingJob(jobId, abort.signal).then(() => getProfile(jobId, abort.signal)).then((result) => {
      setProfile(result);
      setSelectedDatasetId(result.dataset_id);
      setSelectedRunId(result.profile_run_id);
      setState("ready");
      setError(null);
      localStorage.removeItem(ACTIVE_PROFILE_JOB_KEY);
    }).catch((reason) => {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Không thể khôi phục profiling đang chạy.");
      setState("error");
      if (reason instanceof ApiError && [404, 409].includes(reason.status)) {
        localStorage.removeItem(ACTIVE_PROFILE_JOB_KEY);
      }
    }).finally(() => setProfileLoading(false));
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!hydrated.current || !conversationId) return;
    pendingSnapshotRef.current = {
      conversationId,
      snapshot: {
        messages,
        profile,
        datasetId: selectedDatasetId || profile?.dataset_id || null,
        profileRunId: selectedRunId || profile?.profile_run_id || null,
        answerDetail,
        sources,
      },
    };

    if (!messages.some((message) => message.status === "streaming")) {
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      flushPendingSnapshot();
      return;
    }

    if (snapshotTimerRef.current !== null) return;
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null;
      flushPendingSnapshot();
    }, 450);
  }, [conversationId, messages, profile, selectedDatasetId, selectedRunId, sources, answerDetail]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const frame = window.requestAnimationFrame(() => {
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, state]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const eventConversationId = event instanceof CustomEvent && typeof event.detail?.conversationId === "string"
        ? event.detail.conversationId
        : null;
      const nextId = eventConversationId || new URLSearchParams(window.location.search).get("conversation");
      if (!nextId || nextId === conversationId || !getConversation(nextId)) return;
      streamSequence.current += 1;
      controller.current?.abort();
      controller.current = null;
      flushPendingSnapshot();
      const saved = getConversationSnapshot(nextId);
      activeConversationRef.current = nextId;
      setConversationId(nextId);
      setMessages(saved?.messages.length ? saved.messages : [makeMessage("agent", "Xin chào, tôi là VDaAgent. Hãy chọn dataset và profile run trong workspace để bắt đầu hỏi dựa trên evidence.", "VDaAgent")]);
      setProfile(saved?.profile || null);
      setSelectedDatasetId(saved?.datasetId || saved?.profile?.dataset_id || "");
      setSelectedRunId(saved?.profileRunId || saved?.profile?.profile_run_id || "");
      setAnswerDetail(saved?.answerDetail || "standard");
      setSources(saved?.sources || []);
      setError(null);
      setQuestion("");
      refreshConversationProfile(nextId, saved?.profile || null, saved?.profileRunId);
    };
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("p170-chat-navigation", handleNavigation);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("p170-chat-navigation", handleNavigation);
    };
  }, [conversationId]);

  function addMessage(role: ChatMessage["role"], text: string, label?: string) {
    setMessages((current) => [...current, makeMessage(role, text, label)]);
  }

  function selectDataset(datasetId: string) {
    const previous = profile;
    setSelectedDatasetId(datasetId);
    setSelectedRunId("");
    setProfile(null);
    setSources([]);
    setError(null);
    if (previous && previous.dataset_id !== datasetId) {
      addMessage("agent", "Context changed. Select a completed Profile Run before asking a question; earlier answers keep their original context.", "Context");
    }
  }

  async function selectProfileRun(runId: string) {
    setSelectedRunId(runId);
    if (!runId) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    setError(null);
    try {
      const selected = await getProfile(runId);
      setProfile(selected);
      setSelectedDatasetId(selected.dataset_id);
      addMessage("agent", `Context changed to ${selected.dataset_name || "dataset"} — ${selected.run_name?.trim() || `Phiên bản v${selected.version ?? "—"}`}. Earlier answers keep their original context.`, "Context");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể mở profile đã chọn.");
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const isLarge = file.size > LARGE_FILE_THRESHOLD;
    setError(null); setProfile(null); setSources([]); setProfileLoading(false); setSelectedDatasetId(""); setSelectedRunId(""); setSelectedFile(file); setScanMode("sample"); setState("ready");
    addMessage("user", `Đã chọn dataset: ${file.name}`, "Bạn");
    addMessage("agent", isLarge
      ? `Dataset này lớn hơn 50 MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Tôi đề xuất Sampling để giảm thời gian và RAM, nhưng quyết định vẫn thuộc về bạn. Hãy chọn chế độ bên dưới.`
      : "Tôi đã nhận diện dataset. Hãy chọn Sampling để có kết quả nhanh hoặc Full scan để tính trên toàn bộ dữ liệu.", "VDaAgent");
  }

  async function startProfile() {
    if (!selectedFile) return;
    setError(null); setState("uploading"); setProfileProgress(0); setProfileStage("Đang upload dataset");
    try {
      const upload = await uploadDataset(selectedFile, (percent) => setProfileProgress(Math.round(percent * 0.2)));
      addMessage("agent", `Đã nhận ${upload.filename}. Tôi đang chạy ingest và compute engine — các số liệu sẽ được tính từ dữ liệu thật, không do LLM bịa ra.`, "VDaAgent");
      setState("profiling"); setProfileProgress(20); setProfileStage("Đang đưa profiling vào hàng đợi");
      const payload = {
        ...(upload.dataset_id ? { dataset_id: upload.dataset_id } : { dataset_ref: upload.dataset_ref }),
        dataset_name: upload.suggested_name || upload.filename,
        run_name: `${upload.suggested_name || upload.filename} · ${scanMode === "full" ? "Full scan" : "Sample scan"}`,
        scan_mode: scanMode,
        ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" as const, sample_size: 10_000, random_seed: 42 } } : {}),
      } as const;
      const signature = JSON.stringify(payload);
      if (profileSubmission.current?.signature !== signature) {
        profileSubmission.current = { signature, key: crypto.randomUUID() };
      }
      const job = await createProfile(payload, profileSubmission.current.key);
      localStorage.setItem(ACTIVE_PROFILE_JOB_KEY, job.job_id);
      profileSubmission.current = null;
      window.location.assign(`/profiles/${encodeURIComponent(job.profiling_run_id)}/review`);
      return;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Upload hoặc profiling thất bại.";
      setError(message); setProfileStage("Không thể hoàn tất"); setState("error");
      addMessage("agent", `Tôi chưa thể hoàn thành profiling: ${message}`, "VDaAgent");
    }
  }

  async function submitPrompt(value: string, options: {
    retryOf?: string;
    regenerationOf?: string;
    parentMessageId?: string;
    includeUserMessage?: boolean;
    reuseRequestId?: string;
    profileOverride?: Profile;
    answerDetailOverride?: "quick" | "standard" | "deep";
  } = {}) {
    const prompt = value.trim();
    const targetProfile = options.profileOverride || profile;
    const targetAnswerDetail = options.answerDetailOverride || answerDetail;
    if (!prompt || state === "thinking" || state === "uploading" || state === "profiling") return;
    if (profileLoading) return;
    if (!targetProfile) {
      setQuestion("");
      addMessage("agent", "Hãy chọn một profile run đã hoàn tất trong workspace trước khi hỏi Agent.", "VDaAgent");
      return;
    }
    if (targetProfile.pending_proposals) {
      setQuestion("");
      addMessage("agent", `Trước khi tiếp tục, bạn cần review ${targetProfile.pending_proposals} đề xuất metadata của profile. Hãy hoàn tất bước xem xét proposals để tôi có thể trả lời dựa trên báo cáo đã được xác nhận.`, "VDaAgent");
      return;
    }
    controller.current?.abort();
    const requestId = ++streamSequence.current;
    controller.current = new AbortController();
    const chatRequestId = options.reuseRequestId || crypto.randomUUID();
    let streamState = initialChatStream(chatRequestId);
    setQuestion(""); setError(null); setSources([]); setState("thinking"); draftRef.current = ""; responseSourcesRef.current = [];
    const assistantPlaceholder = {
      ...makeMessage("agent", "", "VDaAgent", [], "streaming", "Preparing request"),
      lifecycle: "sending" as const,
      requestId: chatRequestId,
      startedAt: Date.now(),
      context: contextForProfile(targetProfile),
      conversationId: conversationId || undefined,
      parentMessageId: options.parentMessageId,
      retryOf: options.retryOf,
      regenerationOf: options.regenerationOf,
      answerDetail: targetAnswerDetail,
    };
    assistantMessageId.current = assistantPlaceholder.id;
    const userMessage = {
      ...makeMessage("user", prompt, "Bạn"),
      context: contextForProfile(targetProfile),
      conversationId: conversationId || undefined,
      parentMessageId: options.parentMessageId,
      answerDetail: targetAnswerDetail,
    };
    setMessages((current) => options.includeUserMessage === false
      ? [...current, assistantPlaceholder]
      : [...current, userMessage, assistantPlaceholder]);
    try {
      const history: QAHistoryMessage[] = chatHistory(messages, 12);
      await streamQuestion({
        question: prompt,
        request_id: chatRequestId,
        conversation_id: conversationId || undefined,
        message_id: userMessage.id,
        assistant_message_id: assistantPlaceholder.id,
        persist_user_message: options.includeUserMessage !== false,
        parent_message_id: options.parentMessageId,
        retry_of: options.retryOf,
        regeneration_of: options.regenerationOf,
        history,
        profile_run_id: targetProfile.profile_run_id,
        answer_detail: targetAnswerDetail,
      }, (event) => {
        if (requestId !== streamSequence.current || assistantMessageId.current !== assistantPlaceholder.id) return;
        streamState = reduceChatStream(streamState, event);
        draftRef.current = streamState.text;
        responseSourcesRef.current = streamState.sources;
        setSources(streamState.sources);
        setMessages((current) => current.map((message) => message.id === assistantPlaceholder.id
          ? { ...message, ...chatMessagePatch(streamState) }
          : message));
        if (event.event === "done") {
          setState("ready");
          return;
        }
        if (event.event === "suggestions") {
          const payload = event.data as { suggestions?: unknown } | undefined;
          if (Array.isArray(payload?.suggestions)) setSuggestions(payload.suggestions as ChatSuggestion[]);
        }
        if (event.event === "error") {
          const payload = event.data as { detail?: unknown; code?: unknown; recovery_actions?: unknown } | undefined;
          const failure = new Error(String(payload?.detail || "Agent response failed.")) as Error & { chatCode?: string; recoveryActions?: string[] };
          failure.chatCode = typeof payload?.code === "string" ? payload.code : undefined;
          failure.recoveryActions = Array.isArray(payload?.recovery_actions)
            ? payload.recovery_actions.filter((item): item is string => typeof item === "string")
            : undefined;
          throw failure;
        }
      }, controller.current.signal);
      if (requestId === streamSequence.current) setState("ready");
    } catch (reason) {
      if (requestId !== streamSequence.current) return;
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        const failure = reason as Error & { chatCode?: string; recoveryActions?: string[] };
        setMessages((current) => current.map((message) => message.id === assistantPlaceholder.id
          ? {
            ...message,
            text: message.text || failure.message,
            lifecycle: failure.chatCode === "CHAT_TIMEOUT" ? "timeout" : "failed",
            status: "error",
            statusDetail: failure.message || message.statusDetail,
            errorCode: failure.chatCode || (reason instanceof ApiError ? reason.code || (reason.status === 0 ? "CHAT_NETWORK" : undefined) : message.errorCode),
            recoveryActions: failure.recoveryActions || (reason instanceof ApiError ? reason.recoveryActions : message.recoveryActions),
          }
          : message));
        if (reason instanceof ApiError && reason.status === 409 && targetProfile.pending_proposals) {
          setState("ready");
        } else if (reason instanceof ApiError && reason.status === 404 && profile) {
          setProfile(null);
          setSources([]);
          setError(null);
          setState("ready");
        } else {
          setError(reason instanceof Error ? reason.message : "Agent không thể trả lời.");
          setState("error");
        }
      }
    } finally {
      if (requestId === streamSequence.current) controller.current = null;
    }
  }

  async function openDurableConversation(conversation: DurableConversation) {
    streamSequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    try {
      const detail = await getDurableConversation(conversation.id);
      const restored = detail.messages.map(durableMessage);
      const latestContext = [...restored].reverse().find((message) => message.context)?.context;
      activeConversationRef.current = conversation.id;
      setConversationId(conversation.id);
      setMessages(restored.length ? restored : [makeMessage("agent", "Xin chÃ o, tÃ´i lÃ  VDaAgent. HÃ£y chá»n dataset vÃ  Profile Run Ä‘á»ƒ báº¯t Ä‘áº§u.", "VDaAgent")]);
      setSelectedDatasetId(latestContext?.datasetId || conversation.active_dataset_id || "");
      setSelectedRunId(latestContext?.profileRunId || conversation.active_profile_run_id || "");
      setSuggestions([]);
      setError(null);
      window.history.replaceState({}, "", `/chat?conversation=${conversation.id}`);
      refreshConversationProfile(conversation.id, null, latestContext?.profileRunId || conversation.active_profile_run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "KhÃ´ng thá»ƒ má»Ÿ cuá»™c trÃ² chuyá»‡n.");
    }
  }

  async function startDurableConversation() {
    try {
      const conversation = await createDurableConversation();
      setDurableConversations((current) => [conversation, ...current]);
      await openDurableConversation(conversation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "KhÃ´ng thá»ƒ táº¡o cuá»™c trÃ² chuyá»‡n má»›i.");
    }
  }

  async function removeDurableConversation(conversation: DurableConversation) {
    try {
      await deleteDurableConversation(conversation.id);
      const remaining = durableConversations.filter((item) => item.id !== conversation.id);
      setDurableConversations(remaining);
      if (conversation.id === conversationId) {
        if (remaining[0]) await openDurableConversation(remaining[0]);
        else await startDurableConversation();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "KhÃ´ng thá»ƒ xÃ³a cuá»™c trÃ² chuyá»‡n.");
    }
  }

  async function archiveDurableConversationFromHistory(conversation: DurableConversation) {
    try {
      await archiveDurableConversation(conversation.id);
      const remaining = durableConversations.filter((item) => item.id !== conversation.id);
      setDurableConversations(remaining);
      if (conversation.id === conversationId) {
        if (remaining[0]) await openDurableConversation(remaining[0]);
        else await startDurableConversation();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not archive this conversation.");
    }
  }

  function previousUserMessage(messageId: string): ChatMessage | undefined {
    const index = messages.findIndex((message) => message.id === messageId);
    return [...messages.slice(0, index)].reverse().find((message) => message.role === "user");
  }

  async function profileForMessage(message: ChatMessage): Promise<Profile | null> {
    const profileRunId = message.answerEnvelope?.provenance.profile_run_id || message.context?.profileRunId;
    if (!profileRunId) return profile;
    if (profile?.profile_run_id === profileRunId) return profile;
    try {
      const historicalProfile = await getProfile(profileRunId);
      if (historicalProfile.status !== "completed" || historicalProfile.pending_proposals) {
        addMessage("agent", "The original Profile Run is no longer ready for a safe retry. Choose a completed context before trying again.", "Context");
        return null;
      }
      return historicalProfile;
    } catch {
      addMessage("agent", "The original Profile Run is unavailable in this workspace, so this answer cannot be retried safely.", "Context");
      return null;
    }
  }

  async function retryAssistantMessage(message: ChatMessage) {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    const reconnect = message.errorCode === "REQUEST_IN_PROGRESS" || message.errorCode === "CHAT_NETWORK";
    void submitPrompt(userMessage.text, {
      parentMessageId: userMessage.id,
      includeUserMessage: false,
      retryOf: message.requestId,
      reuseRequestId: reconnect ? message.requestId : undefined,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  }

  async function regenerateAssistantMessage(message: ChatMessage) {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void submitPrompt(userMessage.text, {
      parentMessageId: userMessage.id,
      includeUserMessage: false,
      regenerationOf: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  }

  async function askDeeper(message: ChatMessage) {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void submitPrompt(`Please provide a deeper, evidence-backed explanation of: ${userMessage.text}`, {
      parentMessageId: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: "deep",
    });
  }

  async function chooseClarification(message: ChatMessage, option: { id: string; label: string }) {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void submitPrompt(`${userMessage.text}\n\nClarification: ${option.label}`, {
      parentMessageId: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  }

  function sendFeedback(message: ChatMessage, polarity: "helpful" | "not_helpful", reasonCode?: string) {
    if (!message.agentRunId) return;
    void submitChatFeedback({ agent_run_id: message.agentRunId, message_id: message.id, polarity, reason_code: reasonCode }).catch(() => {
      // Feedback is best-effort P1 telemetry. Do not replace a validated
      // answer with an unrelated network error if telemetry is unavailable.
    });
  }

  useEffect(() => {
    if (!profile?.profile_run_id || state === "thinking") return;
    let cancelled = false;
    void getChatSuggestions(profile.profile_run_id).then((items) => {
      if (!cancelled) setSuggestions(items);
    }).catch(() => {
      if (!cancelled) setSuggestions([]);
    });
    return () => { cancelled = true; };
  }, [profile?.profile_run_id, state]);

  function handleRecoveryAction(message: ChatMessage, recoveryAction: string) {
    const originalQuestion = previousUserMessage(message.id)?.text || "";
    if (recoveryAction === "narrow_question" || recoveryAction === "clarify") {
      setQuestion(originalQuestion);
      return;
    }
    if (recoveryAction === "refresh_session") {
      window.location.reload();
      return;
    }
    if (recoveryAction === "open_profiling_status") {
      const profileRunId = message.answerEnvelope?.provenance.profile_run_id || message.context?.profileRunId;
      if (profileRunId) window.location.assign(`/profiles/${encodeURIComponent(profileRunId)}/review`);
      return;
    }
    document.getElementById("agent-profile")?.focus();
  }

  useEffect(() => {
    const handleMessageAction = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as {
        messageId?: string;
        action?: string;
        polarity?: "helpful" | "not_helpful";
        reasonCode?: string;
        option?: { id: string; label: string };
        recoveryAction?: string;
      } : undefined;
      const message = detail?.messageId ? messages.find((item) => item.id === detail.messageId) : undefined;
      if (!message || message.role !== "agent") return;
      if (detail?.action === "retry") void retryAssistantMessage(message);
      if (detail?.action === "regenerate") void regenerateAssistantMessage(message);
      if (detail?.action === "deepen") void askDeeper(message);
      if (detail?.action === "clarify" && detail.option) void chooseClarification(message, detail.option);
      if (detail?.action === "feedback" && detail.polarity) sendFeedback(message, detail.polarity, detail.reasonCode);
      if (detail?.action === "recovery" && detail.recoveryAction) handleRecoveryAction(message, detail.recoveryAction);
    };
    window.addEventListener("p170-chat-message-action", handleMessageAction);
    return () => window.removeEventListener("p170-chat-message-action", handleMessageAction);
  }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void submitPrompt(question);
  }

  function stopAnswer() {
    if (state !== "thinking") return;
    streamSequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    setMessages((current) => current.map((message) => message.id === assistantMessageId.current
      ? { ...message, lifecycle: "cancelled", status: "cancelled", statusDetail: "Request stopped" }
      : message));
    setState("ready");
  }

  const busy = profileLoading || state === "uploading" || state === "profiling" || state === "thinking";
  const statusText = profileLoading ? "Đang kiểm tra profile…" : state === "uploading" ? "Đang upload dataset…" : state === "profiling" ? "Agent đang tính profile…" : state === "thinking" ? "Agent đang tìm evidence…" : selectedFile ? "Chờ chọn chế độ" : "Sẵn sàng";
  const hasChatStarted = messages.some((message) => message.role === "user");

  return <div className="agent-workspace">
    {!hasChatStarted && <header className="agent-hero">
      <div><p className="eyebrow">Trí tuệ dữ liệu tự động</p><h1>Chat với Data Profiling Agent</h1><p>Quy trình analyst: chọn dataset và profile run trong workspace → review proposals → đặt câu hỏi dựa trên evidence đã tính.</p></div>
      <div className="agent-status"><span className="pulse" /> {statusText}</div>
    </header>}
    <div className="agent-layout">
      <aside className="chat-conversation-history" aria-label="Recent conversations">
        <button type="button" className="button secondary" onClick={() => void startDurableConversation()} disabled={busy}>New chat</button>
        <span className="chat-conversation-history-label">Recent conversations</span>
        {durableConversations.length ? durableConversations.map((item) => <div className="chat-conversation-history-item" key={item.id}>
          <button type="button" className={item.id === conversationId ? "active" : ""} onClick={() => void openDurableConversation(item)} title={item.title}>
            <b>{item.title}</b><small>{new Date(item.updated_at).toLocaleDateString()}</small>
          </button>
          <button type="button" aria-label={`Delete ${item.title}`} onClick={() => void removeDurableConversation(item)} disabled={busy}>×</button>
          <button type="button" aria-label={`Archive ${item.title}`} onClick={() => void archiveDurableConversationFromHistory(item)} disabled={busy}>Archive</button>
        </div>) : <small className="muted">No server conversations yet.</small>}
      </aside>
      <section className="agent-chat-panel">
        <div className="agent-panel-header"><div className="agent-identity"><span className="context-icon">✦</span><div><b>VDaAgent</b><small>{profile ? `Nguồn đang dùng · ${profile.dataset_name || "Dataset"}` : "Data Profiling Agent"}</small></div></div>{profile && <span className="agent-profile-name">{profile.run_name?.trim() || `Phiên bản v${profile.version ?? "—"}`}</span>}</div>
        <section className="agent-context-selector" aria-label="Chọn dataset và profile cho Agent"><div className="agent-context-field"><label htmlFor="agent-dataset">Dataset trong workspace</label><select id="agent-dataset" value={selectedDatasetId} onChange={(event) => selectDataset(event.target.value)} disabled={busy || datasets.isPending}><option value="">Chọn dataset…</option>{datasets.data?.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></div><div className="agent-context-field"><label htmlFor="agent-profile">Phiên profiling đã hoàn tất</label><select id="agent-profile" value={selectedRunId} onChange={(event) => void selectProfileRun(event.target.value)} disabled={!selectedDatasetId || !completedRuns.length || runs.isPending || busy}><option value="">Chọn theo tên phiên…</option>{completedRuns.map((run) => <option value={run.id} key={run.id}>{profileRunOptionLabel(run)}</option>)}</select></div><div className="agent-context-hint">{!datasets.data?.length && !datasets.isPending ? <span>Chưa có dataset. <Link href="/datasets/new">Upload trong Bộ dữ liệu →</Link></span> : selectedDatasetId && !runs.isPending && !completedRuns.length ? "Dataset này chưa có profile run hoàn tất để hỏi Agent." : "Agent chỉ trả lời theo phiên profiling bạn đã chọn; ID được hệ thống xử lý ngầm."}</div>{selectedRunId && process.env.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED === "true" && <Link className="button secondary agent-open-charts" href={`/charts?runId=${encodeURIComponent(selectedRunId)}`}>Mở Biểu đồ →</Link>}</section>
        <div ref={messageListRef} className="agent-message-list" aria-live="off">
          {messages.map((message) => <article className={`agent-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === "agent" ? "✦" : "Bạn"}</div><div className="message-body"><span className="message-label">{message.label}</span>{message.role === "agent" ? message.text ? <ChatAnswer message={message} fallback={<MarkdownMessage text={message.text} profile={profile} />} /> : <p className={message.status === "error" ? "muted" : "thinking-dots"}>{message.status === "error" ? "Không thể nhận phản hồi từ Agent. Hãy thử lại." : message.status === "cancelled" ? "Request stopped." : <ChatProgress message={message} fallback="Preparing request" />}</p> : <p>{message.text}</p>}</div></article>)}
          {messages.map((message) => message.role === "user" ? <ChatMessageActions key={`${message.id}-actions`} message={message} busy={busy} onEditUserQuestion={() => setQuestion(message.text)} /> : null)}
        </div>
        {state === "thinking" && <div className="sr-only" role="status" aria-live="polite">{messages.at(-1)?.statusDetail || "Processing request"}</div>}
        {selectedFile && <section className="agent-intake-card" aria-label="Tùy chọn profiling">
          <div className="intake-file"><span className="file-icon">▤</span><div><b>{selectedFile.name}</b><small>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Sẵn sàng để profiling</small></div></div>
          <div className="intake-choice-heading"><div><b>Chọn cách agent xử lý dữ liệu</b><small>{selectedFile.size > LARGE_FILE_THRESHOLD ? "Sampling được khuyến nghị cho file lớn hơn 50 MB." : "Bạn có thể ưu tiên tốc độ hoặc độ đầy đủ của kết quả."}</small></div></div>
          <div className="scan-choice-list"><button type="button" className={scanMode === "sample" ? "scan-choice selected" : "scan-choice"} onClick={() => setScanMode("sample")}><span className="choice-radio" /><span><b>Sampling</b><small>Chạy nhanh, tiết kiệm RAM, có đánh dấu approximate.</small></span><em>{selectedFile.size > LARGE_FILE_THRESHOLD ? "Khuyến nghị" : "Nhanh"}</em></button><button type="button" className={scanMode === "full" ? "scan-choice selected" : "scan-choice"} onClick={() => setScanMode("full")}><span className="choice-radio" /><span><b>Full scan</b><small>Tính trên toàn bộ file, có thể lâu hơn và cần nhiều RAM.</small></span><em>Đầy đủ</em></button></div>
          {busy && (state === "uploading" || state === "profiling") && <ProgressSteps steps={["Upload", "Xử lý dữ liệu", "Hoàn tất"]} activeStep={profileProgress >= 90 ? 2 : profileProgress >= 20 ? 1 : 0} detail={`${profileStage} · ${profileProgress}%`} />}
          <LoadingButton className="button primary intake-start" onClick={startProfile} busy={busy && (state === "uploading" || state === "profiling")}>Tải lên và bắt đầu profiling</LoadingButton>
        </section>}
        {profile?.pending_proposals ? <div className="notice warning agent-review-required"><b>Cần review trước khi tiếp tục</b><p>Profile còn {profile.pending_proposals} đề xuất. Hãy xác nhận, từ chối hoặc chỉnh sửa các đề xuất trước khi hỏi Agent.</p><Link className="button primary" href={`/profiles/${profile.profile_run_id}/review`}>Xem xét proposals</Link></div> : null}
        {error && <div className="notice error" role="alert"><b>Agent gặp lỗi</b><p>{error}</p></div>}
        {profile && <div className="chat-active-context" aria-label="Active answer context">
          <b>Answering against</b>
          <span>{profile.dataset_name || "Dataset"}</span>
          <span>{profile.run_name || `Version ${profile.version ?? "—"}`}</span>
          <span>{profile.scan_mode || "unknown"} scan</span>
          <span>{profile.is_approximate ? "sample scope" : "full scope"}</span>
          {profile.row_count !== null && profile.row_count !== undefined && <span>{profile.row_count.toLocaleString()} rows</span>}
          {(profile.updated_at || profile.created_at) && <span>Profiled {new Date(profile.updated_at || profile.created_at || "").toLocaleDateString()}</span>}
          <span>{profile.pending_proposals ? "review required" : "reviewed"}</span>
        </div>}
        <form className="agent-composer" onSubmit={submit}>
          <label className="chat-detail-control">
            <span className="sr-only">Answer detail</span>
            <select value={answerDetail} onChange={(event) => setAnswerDetail(event.target.value as "quick" | "standard" | "deep")} disabled={busy} aria-label="Answer detail">
              <option value="quick">Nhanh</option>
              <option value="standard">Tiêu chuẩn</option>
              <option value="deep">Chuyên sâu</option>
            </select>
          </label>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.parquet,.json,application/json,text/csv" hidden onChange={handleFile} />
          <button type="button" className="upload-trigger" onClick={() => fileRef.current?.click()} disabled={busy} title="Upload nhanh dataset">＋</button>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={profile?.pending_proposals ? "Xem xét proposals trước khi hỏi Agent…" : profile ? "Đặt câu hỏi về dataset của bạn…" : "Chọn dataset/profile để hỏi Agent…"} rows={1} disabled={Boolean(profile?.pending_proposals) || (busy && state !== "thinking")} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          {state === "thinking" ? <button type="button" className="button secondary" onClick={stopAnswer} aria-label="Stop answer">Stop</button> : null}
          <button className="send-trigger" disabled={!question.trim() || !profile || busy} aria-busy={state === "thinking" || undefined} aria-label="Gửi câu hỏi">{state === "thinking" ? <span className="button-spinner small" aria-hidden="true" /> : "➤"}</button>
        </form>
        {profile && <div className="composer-suggestions"><span className="composer-suggestions-label">Profile Run suggestions</span><div className="starter-list">{(suggestions.length ? suggestions.map((suggestion) => suggestion.question) : starters).map((starter) => <button key={starter} onClick={() => void submitPrompt(starter)} disabled={busy || Boolean(profile.pending_proposals)}>{starter}<span>→</span></button>)}</div></div>}
        <div className="composer-hint"><span>Enter để gửi · Shift + Enter để xuống dòng</span><span>Dựa trên evidence · PII được bảo vệ</span></div>
      </section>
    </div>
  </div>;
}
