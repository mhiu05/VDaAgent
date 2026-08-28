"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, createProfile, getProfile, listDatasets, listRuns, streamQuestion, uploadDataset, waitForProfilingJob, type QAHistoryMessage } from "@/lib/api";
import type { AnswerSource, Profile } from "@/lib/types";
import { createConversation, getConversation, getConversationSnapshot, listConversations, updateConversationSnapshot, type ChatMessage } from "@/lib/chat-history";
import { AnswerSources } from "@/components/answer-sources";
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

function makeMessage(role: ChatMessage["role"], text: string, label?: string, sources?: AnswerSource[]): ChatMessage {
  return { id: `${Date.now()}-${Math.random()}`, role, text, label, sources };
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
  return <div className="markdown-message">{blocks}</div>;
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
  const [state, setState] = useState<AgentState>("ready");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileProgress, setProfileProgress] = useState(0);
  const [profileStage, setProfileStage] = useState("Sẵn sàng");
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<AnswerSource[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const draftRef = useRef("");
  const responseSourcesRef = useRef<AnswerSource[]>([]);
  const hydrated = useRef(false);
  const activeConversationRef = useRef<string | null>(null);
  const profileSubmission = useRef<{ signature: string; key: string } | null>(null);
  const datasets = useQuery({ queryKey: ["chat-datasets"], queryFn: ({ signal }) => listDatasets(signal) });
  const runs = useQuery({ queryKey: ["chat-runs", selectedDatasetId], queryFn: () => listRuns(selectedDatasetId), enabled: Boolean(selectedDatasetId) });
  const completedRuns = runs.data?.filter((run) => run.status === "completed") || [];

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
    const conversation = queryConversation ? getConversation(queryConversation) : null;
    const current = conversation || listConversations()[0] || createConversation();
    if (!queryConversation) window.history.replaceState({}, "", `/chat?conversation=${current.id}`);
    activeConversationRef.current = current.id;
    setConversationId(current.id);
    const saved = getConversationSnapshot(current.id);
    if (saved?.messages.length) setMessages(saved.messages);
    if (saved?.profile) {
      setProfile(saved.profile);
    }
    setSelectedDatasetId(saved?.datasetId || saved?.profile?.dataset_id || "");
    setSelectedRunId(saved?.profileRunId || saved?.profile?.profile_run_id || "");
    if (saved?.sources) setSources(saved.sources);
    refreshConversationProfile(current.id, saved?.profile || null, saved?.profileRunId);
    hydrated.current = true;
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
    updateConversationSnapshot(conversationId, {
      messages,
      profile,
      datasetId: selectedDatasetId || profile?.dataset_id || null,
      profileRunId: selectedRunId || profile?.profile_run_id || null,
    });
  }, [conversationId, messages, profile, selectedDatasetId, selectedRunId, sources]);

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
      const saved = getConversationSnapshot(nextId);
      activeConversationRef.current = nextId;
      setConversationId(nextId);
      setMessages(saved?.messages.length ? saved.messages : [makeMessage("agent", "Xin chào, tôi là VDaAgent. Hãy chọn dataset và profile run trong workspace để bắt đầu hỏi dựa trên evidence.", "VDaAgent")]);
      setProfile(saved?.profile || null);
      setSelectedDatasetId(saved?.datasetId || saved?.profile?.dataset_id || "");
      setSelectedRunId(saved?.profileRunId || saved?.profile?.profile_run_id || "");
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
    setSelectedDatasetId(datasetId);
    setSelectedRunId("");
    setProfile(null);
    setSources([]);
    setError(null);
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
      addMessage("agent", `Đã chọn “${selected.run_name?.trim() || `Phiên bản v${selected.version ?? "—"}`}” của ${selected.dataset_name || "dataset"}. Bạn có thể hỏi Agent dựa trên evidence đã tính.`, "VDaAgent");
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
      await waitForProfilingJob(job.job_id, undefined, 30 * 60_000, (nextJob) => {
        const stage = (nextJob.stage || "").toLocaleLowerCase("vi");
        const nextProgress = nextJob.status === "succeeded" ? 100 : stage.includes("queue") ? 25 : stage.includes("profile") || stage.includes("scan") || stage.includes("compute") ? 60 : nextJob.status === "running" ? 45 : 30;
        setProfileProgress(nextProgress);
        setProfileStage(nextJob.status === "queued" ? "Đang chờ worker xử lý" : nextJob.status === "running" ? (nextJob.stage || "Đang tính profile") : "Đang hoàn thiện kết quả");
      });
      setProfileProgress(90); setProfileStage("Đang tải kết quả profile");
      const result = await getProfile(job.profiling_run_id);
      localStorage.removeItem(ACTIVE_PROFILE_JOB_KEY);
      profileSubmission.current = null;
      setProfile(result); setProfileLoading(false); setProfileProgress(100); setProfileStage("Profiling đã hoàn tất"); setSelectedFile(null); setSelectedDatasetId(result.dataset_id); setSelectedRunId(result.profile_run_id);
      addMessage("agent", result.pending_proposals > 0 ? `Profile đã sẵn sàng. Tôi đã tính ${result.row_count?.toLocaleString() || "—"} dòng và ${result.column_count} cột. Có ${result.pending_proposals} đề xuất cần bạn review; sau đó bạn có thể tiếp tục hỏi tôi về dataset.` : "Profile đã sẵn sàng. Tôi đã tính xong các metric và có thể trả lời câu hỏi của bạn dựa trên evidence.", "VDaAgent");
      setState("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Upload hoặc profiling thất bại.";
      setError(message); setProfileStage("Không thể hoàn tất"); setState("error");
      addMessage("agent", `Tôi chưa thể hoàn thành profiling: ${message}`, "VDaAgent");
    }
  }

  async function submitPrompt(value: string) {
    const prompt = value.trim();
    if (!prompt || state === "thinking" || state === "uploading" || state === "profiling") return;
    if (profileLoading) return;
    if (!profile) {
      setQuestion("");
      addMessage("agent", "Hãy chọn một profile run đã hoàn tất trong workspace trước khi hỏi Agent.", "VDaAgent");
      return;
    }
    if (profile?.pending_proposals) {
      setQuestion("");
      addMessage("agent", `Trước khi tiếp tục, bạn cần review ${profile.pending_proposals} đề xuất metadata của profile. Hãy hoàn tất bước xem xét proposals để tôi có thể trả lời dựa trên báo cáo đã được xác nhận.`, "VDaAgent");
      return;
    }
    controller.current?.abort();
    controller.current = new AbortController();
    setQuestion(""); setError(null); setSources([]); setState("thinking"); draftRef.current = ""; responseSourcesRef.current = [];
    addMessage("user", prompt, "Bạn");
    try {
      const history: QAHistoryMessage[] = messages.slice(-12).map((message) => ({
        role: message.role,
        text: message.text.slice(0, 2000),
      }));
      await streamQuestion({ question: prompt, history, ...(profile ? { profile_run_id: profile.profile_run_id } : {}) }, (event) => {
        if (event.event === "token" && typeof event.data === "object" && event.data) {
          draftRef.current += String((event.data as { text?: unknown }).text || "");
        }
        if (event.event === "source" && typeof event.data === "object" && event.data) responseSourcesRef.current = (event.data as { sources?: AnswerSource[] }).sources || [];
        if (event.event === "done") {
          setMessages((current) => [...current, makeMessage("agent", draftRef.current, "VDaAgent", responseSourcesRef.current)]);
          setState("ready");
        }
        if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent response failed."));
      }, controller.current.signal);
      setState("ready");
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        if (reason instanceof ApiError && reason.status === 409 && profile?.pending_proposals) {
          addMessage("agent", `Bạn cần review ${profile.pending_proposals} đề xuất metadata trước khi tiếp tục hỏi về dataset.`, "VDaAgent");
          setState("ready");
        } else if (reason instanceof ApiError && reason.status === 404 && profile) {
          setProfile(null);
          setSources([]);
          setError(null);
          addMessage("agent", "Profile này không còn tồn tại trong backend hiện tại. Hãy upload lại dataset để tiếp tục.", "VDaAgent");
          setState("ready");
        } else {
          setError(reason instanceof Error ? reason.message : "Agent không thể trả lời.");
          setState("error");
        }
      }
    } finally { controller.current = null; }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void submitPrompt(question);
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
      <section className="agent-chat-panel">
        <div className="agent-panel-header"><div className="agent-identity"><span className="context-icon">✦</span><div><b>VDaAgent</b><small>{profile ? `Nguồn đang dùng · ${profile.dataset_name || "Dataset"}` : "Data Profiling Agent"}</small></div></div>{profile && <span className="agent-profile-name">{profile.run_name?.trim() || `Phiên bản v${profile.version ?? "—"}`}</span>}</div>
        <section className="agent-context-selector" aria-label="Chọn dataset và profile cho Agent"><div className="agent-context-field"><label htmlFor="agent-dataset">Dataset trong workspace</label><select id="agent-dataset" value={selectedDatasetId} onChange={(event) => selectDataset(event.target.value)} disabled={busy || datasets.isPending}><option value="">Chọn dataset…</option>{datasets.data?.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></div><div className="agent-context-field"><label htmlFor="agent-profile">Phiên profiling đã hoàn tất</label><select id="agent-profile" value={selectedRunId} onChange={(event) => void selectProfileRun(event.target.value)} disabled={!selectedDatasetId || !completedRuns.length || runs.isPending || busy}><option value="">Chọn theo tên phiên…</option>{completedRuns.map((run) => <option value={run.id} key={run.id}>{profileRunOptionLabel(run)}</option>)}</select></div><div className="agent-context-hint">{!datasets.data?.length && !datasets.isPending ? <span>Chưa có dataset. <Link href="/datasets/new">Upload trong Bộ dữ liệu →</Link></span> : selectedDatasetId && !runs.isPending && !completedRuns.length ? "Dataset này chưa có profile run hoàn tất để hỏi Agent." : "Agent chỉ trả lời theo phiên profiling bạn đã chọn; ID được hệ thống xử lý ngầm."}</div>{selectedRunId && process.env.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED === "true" && <Link className="button secondary agent-open-charts" href={`/charts?runId=${encodeURIComponent(selectedRunId)}`}>Mở Biểu đồ →</Link>}</section>
        <div ref={messageListRef} className="agent-message-list" aria-live="polite">
          {messages.map((message) => <article className={`agent-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === "agent" ? "✦" : "Bạn"}</div><div className="message-body"><span className="message-label">{message.label}</span>{message.role === "agent" ? <><MarkdownMessage text={message.text} profile={profile} /><AnswerSources sources={message.sources} /></> : <p>{message.text}</p>}</div></article>)}
          {busy && state === "thinking" && <article className="agent-message agent"><div className="message-avatar">✦</div><div className="message-body"><span className="message-label">VDaAgent</span><p className="thinking-dots">Đang phân tích<span>.</span><span>.</span><span>.</span></p></div></article>}
        </div>
        {selectedFile && <section className="agent-intake-card" aria-label="Tùy chọn profiling">
          <div className="intake-file"><span className="file-icon">▤</span><div><b>{selectedFile.name}</b><small>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Sẵn sàng để profiling</small></div></div>
          <div className="intake-choice-heading"><div><b>Chọn cách agent xử lý dữ liệu</b><small>{selectedFile.size > LARGE_FILE_THRESHOLD ? "Sampling được khuyến nghị cho file lớn hơn 50 MB." : "Bạn có thể ưu tiên tốc độ hoặc độ đầy đủ của kết quả."}</small></div></div>
          <div className="scan-choice-list"><button type="button" className={scanMode === "sample" ? "scan-choice selected" : "scan-choice"} onClick={() => setScanMode("sample")}><span className="choice-radio" /><span><b>Sampling</b><small>Chạy nhanh, tiết kiệm RAM, có đánh dấu approximate.</small></span><em>{selectedFile.size > LARGE_FILE_THRESHOLD ? "Khuyến nghị" : "Nhanh"}</em></button><button type="button" className={scanMode === "full" ? "scan-choice selected" : "scan-choice"} onClick={() => setScanMode("full")}><span className="choice-radio" /><span><b>Full scan</b><small>Tính trên toàn bộ file, có thể lâu hơn và cần nhiều RAM.</small></span><em>Đầy đủ</em></button></div>
          {busy && (state === "uploading" || state === "profiling") && <ProgressSteps steps={["Upload", "Xử lý dữ liệu", "Hoàn tất"]} activeStep={profileProgress >= 90 ? 2 : profileProgress >= 20 ? 1 : 0} detail={`${profileStage} · ${profileProgress}%`} />}
          <LoadingButton className="button primary intake-start" onClick={startProfile} busy={busy && (state === "uploading" || state === "profiling")}>Tải lên và bắt đầu profiling</LoadingButton>
        </section>}
        {profile?.pending_proposals ? <div className="notice warning agent-review-required"><b>Cần review trước khi tiếp tục</b><p>Profile còn {profile.pending_proposals} đề xuất. Hãy xác nhận, từ chối hoặc chỉnh sửa các đề xuất trước khi hỏi Agent.</p><Link className="button primary" href={`/profiles/${profile.profile_run_id}/review?returnTo=${encodeURIComponent(`/chat?conversation=${conversationId || ""}`)}`}>Xem xét proposals</Link></div> : null}
        {error && <div className="notice error" role="alert"><b>Agent gặp lỗi</b><p>{error}</p></div>}
        <form className="agent-composer" onSubmit={submit}>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.parquet,.json,application/json,text/csv" hidden onChange={handleFile} />
          <button type="button" className="upload-trigger" onClick={() => fileRef.current?.click()} disabled={busy} title="Upload nhanh dataset">＋</button>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={profile?.pending_proposals ? "Xem xét proposals trước khi hỏi Agent…" : profile ? "Đặt câu hỏi về dataset của bạn…" : "Chọn dataset/profile để hỏi Agent…"} rows={1} disabled={Boolean(profile?.pending_proposals) || (busy && state !== "thinking")} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button className="send-trigger" disabled={!question.trim() || !profile || busy} aria-busy={state === "thinking" || undefined} aria-label="Gửi câu hỏi">{state === "thinking" ? <span className="button-spinner small" aria-hidden="true" /> : "➤"}</button>
        </form>
        {profile && <div className="composer-suggestions"><span className="composer-suggestions-label">Gợi ý câu hỏi</span><div className="starter-list">{starters.map((starter) => <button key={starter} onClick={() => void submitPrompt(starter)} disabled={busy || Boolean(profile.pending_proposals)}>{starter}<span>→</span></button>)}</div></div>}
        <div className="composer-hint"><span>Enter để gửi · Shift + Enter để xuống dòng</span><span>Dựa trên evidence · PII được bảo vệ</span></div>
      </section>
    </div>
  </div>;
}
