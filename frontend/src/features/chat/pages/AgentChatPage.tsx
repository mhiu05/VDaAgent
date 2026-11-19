import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useServices, useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { Button, IconButton } from "../../../shared/ui/button";
import { Skeleton } from "../../../shared/ui/feedback";
import { PageState } from "../../../shared/ui/page";
import { dayKey, formatDate } from "../../../shared/lib/format";
import {
  AGENT_CHAT_KEY,
  type AgentChatService,
  type ChatAttachment,
  type ChatChoice,
  type ChatMessage,
  type ChatThread,
  type TeamAgent,
} from "../services/agent-chat-service";
import {
  agentMembers,
  applyEvent,
  emptyState,
  mergeMessages,
  orderThreads,
  taskBanner,
  threadTitle,
  type AgentChatState,
} from "../model/agent-chat-state";
import {
  AgentFace,
  NewGroupDialog,
  ThreadList,
  useStatusText,
} from "../components/AgentChatList";
import {
  ChatComposer,
  fileSize,
  MessageItem,
  parseCsv,
} from "../components/AgentChatMessages";
import { MarkdownContent } from "../components/MarkdownContent";
import { GROUPS_KEY, type GroupsService } from "../../groups/services/groups-service";
import { OfficeDocumentPreview, type OfficeKind } from "../components/OfficeDocumentPreview";
import "./agent-chat.css";

const PAGE = 50;
const WIDE = "(min-width: 768px)";

function ThinkingDisclosure({ detail, interrupted, queued }: { detail: string; interrupted: boolean; queued: number }) {
  const { t } = useTranslation("chat");
  return (
    <details className={`ac-thinking ${interrupted ? "is-interrupted" : ""}`}>
      <summary>
        <em className="ac-thinking-label">{t(interrupted ? "acInterrupted" : "acThinking")}</em>
        {queued ? <span className="badge">{t("acQueued", { count: queued })}</span> : null}
        <ChevronDown className="ac-thinking-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="ac-thinking-body">
        <p>{detail}</p>
        {!interrupted ? <small>{t("acThinkingPrivacy")}</small> : null}
      </div>
    </details>
  );
}

/** The target chat (doc 14 "Chat app layout: three panes"). */
export default function AgentChatPage() {
  const { t } = useTranslation(["chat", "app"]);
  const service = useWorkspaceService<AgentChatService>(AGENT_CHAT_KEY);
  const groupService = useServices().workspace[GROUPS_KEY] as GroupsService | undefined;
  const { threadId = null } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<AgentChatState>(emptyState);
  const [groupAgentIds, setGroupAgentIds] = useState<Record<string, string[]>>({});
  // bumped on every stream (re)open: a group's team may have changed meanwhile
  const [teamReads, setTeamReads] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [pane, setPane] = useState<"conversation" | "document">("conversation");
  const [previewDocument, setPreviewDocument] = useState<ChatAttachment | null>(null);
  const [previewImage, setPreviewImage] = useState<ChatAttachment | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const openThread = useRef<string | null>(threadId);
  openThread.current = threadId;
  // Group agents come from `/api/groups/{id}/agents`, not the personal team list: a re-read of
  // the personal team keeps them, and personal-only pickers leave them out.
  const groupAgentSet = useMemo(() => new Set(Object.values(groupAgentIds).flat()), [groupAgentIds]);
  const groupAgents = useRef(groupAgentSet);
  groupAgents.current = groupAgentSet;

  const loadAll = useCallback(async () => {
    const [agents, threads, tasks] = await Promise.all([
      service.agents(),
      service.threads(),
      service.tasks(),
    ]);
    if (agents.error || threads.error || tasks.error) {
      setStatus((s) => (s === "ready" ? s : "error"));
      return;
    }
    setState((s) => ({
      ...s,
      agents: [
        ...agents.data,
        ...s.agents.filter((a) => groupAgents.current.has(a.id) && !agents.data.some((p) => p.id === a.id)),
      ],
      threads: threads.data,
      tasks: tasks.data,
    }));
    setStatus("ready");
  }, [service]);

  const historyVersions = useRef(new Map<string, number>());
  const loadMessages = useCallback(
    async (id: string, before?: number) => {
      const version = (historyVersions.current.get(id) ?? 0) + (before === undefined ? 1 : 0);
      historyVersions.current.set(id, version);
      const page = await service.messages(id, before);
      if (page.error || historyVersions.current.get(id) !== version) return;
      setState((s) => {
        if (historyVersions.current.get(id) !== version) return s;
        const current = s.messages[id];
        if (before !== undefined && current?.items[0]?.id !== before) return s;
        // A newest-page read starts a contiguous window. Merging it with an old window
        // can leave an unreachable gap after an offline period longer than one page.
        const newest = page.data.at(-1)?.id ?? Infinity;
        const retained = before === undefined
          ? current?.items.filter((message) => message.id > newest) ?? []
          : current?.items ?? [];
        const items = mergeMessages(retained, page.data);
        const complete = page.data.length < PAGE;
        return { ...s, messages: { ...s.messages, [id]: { items, complete } } };
      });
    },
    [service],
  );

  useEffect(() => {
    void loadAll();
    const stop = service.subscribe((event) => {
      if (event.type === "reconnect") {
        void loadAll();
        setTeamReads((n) => n + 1);
        if (openThread.current) void loadMessages(openThread.current);
        return;
      }
      setState((s) => applyEvent(s, event, openThread.current));
    });
    void service.presence();
    const focus = () => void service.presence();
    window.addEventListener("focus", focus);
    return () => {
      stop();
      window.removeEventListener("focus", focus);
    };
  }, [service, loadAll, loadMessages]);

  const threads = useMemo(
    () => orderThreads(state.threads, state.agents),
    [state.threads, state.agents],
  );
  const thread = threads.find((th) => th.id === threadId) ?? null;
  const roomGroupId = thread?.group?.id;
  const roomGroupStatus = thread?.group?.status;

  useEffect(() => {
    if (!roomGroupId || roomGroupStatus === "active") return;
    const timer = window.setInterval(() => void loadAll(), 4000);
    return () => window.clearInterval(timer);
  }, [roomGroupId, roomGroupStatus, loadAll]);

  useEffect(() => {
    if (!roomGroupId || !groupService) return;
    void groupService.agents(roomGroupId).then((result) => {
      if (!result.error) {
        setGroupAgentIds((current) => ({ ...current, [roomGroupId]: result.data.map((agent) => agent.id) }));
        setState((s) => ({ ...s, agents: [
          ...s.agents.filter((agent) => !result.data.some((groupAgent) => groupAgent.id === agent.id)),
          ...result.data,
        ] }));
      }
    });
  }, [roomGroupId, roomGroupStatus, groupService, teamReads]);

  // `/chat?agent=<id>` (the agent page's "Chat" button): open that agent's direct thread
  const [search] = useSearchParams();
  const wantedAgent = search.get("agent");
  useEffect(() => {
    if (status !== "ready" || threadId || !wantedAgent) return;
    const direct = threads.find((th) => th.kind === "direct"
      && th.members.some((m) => m.type === "agent" && m.id === wantedAgent));
    if (direct) navigate(`/chat/${direct.id}`, { replace: true });
  }, [status, threadId, wantedAgent, threads, navigate]);

  useEffect(() => {
    if (status !== "ready" || threadId || wantedAgent || !threads.length) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia(WIDE).matches
    )
      navigate(`/chat/${threads[0].id}`, { replace: true });
  }, [status, threadId, wantedAgent, threads, navigate]);

  useEffect(() => {
    setPane("conversation");
    setPreviewDocument(null);
    setPreviewImage(null);
    if (threadId) void loadMessages(threadId);
  }, [threadId, loadMessages]);

  const loaded = threadId ? state.messages[threadId] : undefined;
  const newest = loaded?.items.at(-1)?.id;
  const marked = useRef(new Map<string, number>());
  useEffect(() => {
    if (
      !threadId ||
      newest === undefined ||
      document.visibilityState === "hidden"
    )
      return;
    if ((marked.current.get(threadId) ?? 0) >= newest) return;
    marked.current.set(threadId, newest);
    void service.markRead(threadId, newest);
    setState((s) => ({
      ...s,
      threads: s.threads.map((th) =>
        th.id === threadId ? { ...th, unread: 0 } : th,
      ),
    }));
  }, [threadId, newest, service]);

  if (status === "loading")
    return (
      <div className="ac-layout">
        <Skeleton label={t("app:loading")} />
      </div>
    );
  if (status === "error")
    return (
      <PageState
        kind="error"
        title={t("acLoadError")}
        action={
          <Button
            onClick={() => {
              setStatus("loading");
              void loadAll();
            }}
          >
            {t("app:retry")}
          </Button>
        }
      />
    );

  const append = (m: ChatMessage) =>
    setState((s) =>
      applyEvent(s, { type: "message", message: m }, openThread.current),
    );
  const send = async (
    text: string,
    files: File[],
    choice?: { message: ChatMessage; choice: ChatChoice },
    target?: "group" | "lead",
    mention?: string,
  ) => {
    if (!thread) return "other";
    const r = await service.send(thread.id, {
      text,
      files,
      ...(target ? { target } : {}),
      ...(mention ? { mention } : {}),
      ...(choice
        ? { choiceId: choice.choice.id, replyTo: choice.message.id }
        : {}),
    });
    if (r.error) return r.error.code;
    append(r.data);
    return null;
  };
  const view = !threadId ? "list" : pane;
  return (
    <div
      className={`ac-layout ${previewDocument ? "ac-document-open" : "ac-document-hidden"}`}
      data-pane={view}
    >
      <h1 className="sr-only" tabIndex={-1}>
        {t("acTitle")}
      </h1>
      <ThreadList
        threads={threads}
        agents={state.agents}
        activeId={threadId}
        onNewGroup={() => setGroupOpen(true)}
      />
      {thread ? (
        <Conversation
          thread={thread}
          agents={state.agents}
          groupAgentIds={thread.group ? (groupAgentIds[thread.group.id] ?? []) : []}
          messages={loaded?.items ?? null}
          complete={loaded?.complete ?? false}
          banner={taskBanner(state.tasks, thread.group?.id ?? null)}
          onOpenAttachment={(attachment) => {
            if (attachment.mime.startsWith("image/")) {
              setPreviewImage(attachment);
              return;
            }
            setPreviewDocument(attachment);
            setPane("document");
          }}
          onOlder={() =>
            loaded?.items[0] && loadMessages(thread.id, loaded.items[0].id)
          }
          onSend={(text, files, target, mention) => send(text, files, undefined, target, mention)}
          onChoose={(message, choice) =>
            void send(choice.label, [], { message, choice })
          }
          onEdit={(message, text) => {
            setState((current) => {
              const page = current.messages[thread.id];
              if (!page) return current;
              const edited = { ...message, text };
              return {
                ...current,
                messages: {
                  ...current.messages,
                  [thread.id]: { ...page, items: page.items.map((item) => item.id === message.id ? edited : item) },
                },
                threads: current.threads.map((item) => item.id === thread.id && item.lastMessage?.id === message.id
                  ? { ...item, lastMessage: edited } : item),
              };
            });
          }}
          onCancel={async (task) => {
            const r = await service.cancelTask(task.id);
            if (r.error) return r.error.code;
            setState((s) =>
              applyEvent(s, { type: "task", task: r.data }, null),
            );
            return null;
          }}
        />
      ) : (
        <section className="ac-conversation ac-placeholder">
          <p className="muted">{threadId ? "Không tìm thấy cuộc trò chuyện hoặc bạn không còn là thành viên." : t("acPick")}</p>
        </section>
      )}
      {thread && previewDocument ? (
        <DocumentPane
          attachment={previewDocument}
          onBack={() => setPane("conversation")}
          onClose={() => {
            setPreviewDocument(null);
            setPane("conversation");
          }}
        />
      ) : null}
      {previewImage ? <ImageLightbox attachment={previewImage} onClose={() => setPreviewImage(null)} /> : null}
      <NewGroupDialog
        open={groupOpen}
        agents={state.agents.filter((a) => !groupAgentSet.has(a.id))}
        onOpenChange={setGroupOpen}
        onCreate={async (name, ids) => {
          const r = await service.createGroup(name, ids);
          if (r.error) return r.error.code;
          setState((s) =>
            applyEvent(s, { type: "thread", thread: r.data }, null),
          );
          setGroupOpen(false);
          navigate(`/chat/${r.data.id}`);
          return null;
        }}
      />
    </div>
  );
}

function ImageLightbox({ attachment, onClose }: { attachment: ChatAttachment; onClose(): void }) {
  const { t } = useTranslation("chat");
  const [zoom, setZoom] = useState(1);
  const zoomBy = useCallback((delta: number) => {
    setZoom((value) => Math.min(4, Math.max(0.5, Number((value + delta).toFixed(2)))));
  }, []);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomBy(0.25);
      else if (event.key === "-") zoomBy(-0.25);
      else if (event.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose, zoomBy]);

  return createPortal(
    <div className="ac-image-lightbox" role="dialog" aria-modal="true" aria-label={t("acImageViewer")} onClick={onClose}>
      <div className="ac-image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton label={t("acZoomOut")} onClick={() => zoomBy(-0.25)} disabled={zoom <= 0.5}><Minus size={18} /></IconButton>
        <IconButton label={t("acResetZoom")} onClick={() => setZoom(1)}><RotateCcw size={17} /></IconButton>
        <IconButton label={t("acZoomIn")} onClick={() => zoomBy(0.25)} disabled={zoom >= 4}><Plus size={18} /></IconButton>
        <IconButton label={t("acCloseImage")} onClick={onClose}><X size={19} /></IconButton>
      </div>
      <div className="ac-image-lightbox-stage" onClick={(event) => event.stopPropagation()}
        onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 0.15 : -0.15); }}>
        <img src={attachment.url} alt={attachment.filename} style={{ transform: `scale(${zoom})` }} />
      </div>
      <p className="ac-image-lightbox-name">{attachment.filename}</p>
    </div>,
    document.body,
  );
}

function CsvDocumentPreview({ text, filename }: { text: string; filename: string }) {
  const { t } = useTranslation("chat");
  const rows = useMemo(() => parseCsv(text.replace(/^\uFEFF/, ""), 201), [text]);
  const [head = [], ...body] = rows;
  return (
    <div className="ac-office-preview ac-office-workbook" aria-label={filename}>
      <section className="ac-office-sheet ac-csv-document">
        <header><span>{t("acDataReport")}</span><h3>{filename}</h3><small>CSV · {t("acPreviewMode")}</small></header>
        {rows.length ? (
          <div className="table-scroll"><table>
            <thead><tr><th className="ac-row-number">#</th>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
            <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}><td className="ac-row-number">{rowIndex + 1}</td>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
          </table></div>
        ) : <p className="muted ac-document-error">{t("acDocumentEmpty")}</p>}
      </section>
    </div>
  );
}

function Conversation({
  thread,
  agents,
  groupAgentIds,
  messages,
  complete,
  banner,
  onOpenAttachment,
  onOlder,
  onSend,
  onChoose,
  onEdit,
  onCancel,
}: {
  thread: ChatThread;
  agents: readonly TeamAgent[];
  groupAgentIds: readonly string[];
  messages: ChatMessage[] | null;
  complete: boolean;
  banner: ReturnType<typeof taskBanner>;
  onOpenAttachment(attachment: ChatAttachment): void;
  onOlder(): unknown;
  onSend(text: string, files: File[], target?: "group" | "lead", mention?: string): Promise<string | null>;
  onChoose(message: ChatMessage, choice: ChatChoice): void;
  onEdit(message: ChatMessage, text: string): void;
  onCancel(task: NonNullable<ReturnType<typeof taskBanner>["running"]>): Promise<string | null>;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const { preferences } = usePreferences();
  const { snapshot } = useAuth();
  const domainUnavailable = !thread.group &&
    snapshot.status === "authenticated" &&
    snapshot.domain?.status === "unavailable";
  const statusText = useStatusText();
  const members = agentMembers(thread);
  const direct =
    thread.kind === "direct"
      ? agents.find((a) => a.id === members[0]?.id)
      : undefined;
  const activeAgent = direct ?? agents.find((agent) =>
    members.some((member) => member.id === agent.id) && agent.status !== "idle"
  );
  const activeStatus = banner.running ? "busy" : activeAgent?.status;
  const isThinking = Boolean(
    banner.running || activeStatus === "busy" || activeStatus === "compacting" || activeStatus === "routine",
  );
  const thinkingDetail = banner.running?.description
    ?? activeAgent?.statusDetail
    ?? (statusText(activeStatus, activeAgent?.statusDetail) || t("acThinkingActive"));
  const [interrupted, setInterrupted] = useState<string | null>(null);
  const runningId = banner.running?.id ?? null;
  const previousRunningId = useRef<number | null>(null);
  useEffect(() => {
    if (runningId !== null && runningId !== previousRunningId.current) setInterrupted(null);
    previousRunningId.current = runningId;
  }, [runningId]);
  const isLead =
    Boolean(direct?.isLead ?? members[0]?.isLead) && thread.kind === "direct";
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const previousHeight = useRef<number | null>(null);
  const lastId = messages?.at(-1)?.id;

  useLayoutEffect(() => {
    stick.current = true;
  }, [thread.id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (previousHeight.current !== null) {
      el.scrollTop += el.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, lastId]);

  // late content (CSV previews, images) must not push the newest message out of view
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !inner.current || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (stick.current && previousHeight.current === null)
        el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner.current);
    return () => observer.disconnect();
  }, []);

  const older = () => {
    if (complete || !messages?.length) return;
    previousHeight.current = scroller.current?.scrollHeight ?? null;
    void onOlder();
  };
  let lastDay = "";
  return (
    <section className="ac-conversation" aria-label={threadTitle(thread)}>
      <header className="ac-header">
        <Link
          to="/chat"
          className="ac-back icon-button button button-ghost"
          aria-label={t("acBack")}
        >
          <ArrowLeft size={18} />
        </Link>
        <AgentFace
          name={threadTitle(thread)}
          identity={members[0]?.id ?? thread.id}
          avatar={members[0]?.avatar ?? null}
          group={thread.kind === "group"}
          status={activeStatus}
        />
        <div className="ac-header-text">
          <h2>
            {threadTitle(thread)}{" "}
            {isLead ? <span className="badge">{t("acLead")}</span> : null}
          </h2>
          {thread.kind === "group" ? (
            <div className="ac-room-team">
              <span className="ac-human-members">{thread.members.filter((member) => member.type === "user").map((member) => member.name).join(", ")}</span>
              <span className="ac-member-faces">
              {members.map((m) => {
                const a = agents.find((x) => x.id === m.id);
                const s = statusText(a?.status, a?.statusDetail);
                return (
                  <span key={m.id} title={s ? `${m.name} · ${s}` : m.name}>
                    <AgentFace name={m.name} identity={m.id} avatar={m.avatar} size={20} status={a?.status} />
                  </span>
                );
              })}
              {groupAgentIds.filter((id) => !members.some((member) => member.id === id)).map((id) => {
                const agent = agents.find((item) => item.id === id);
                return agent ? <span key={id} title={`${agent.name} · ${statusText(agent.status, agent.statusDetail) || "Sẵn sàng"}`}>
                  <AgentFace name={agent.name} identity={id} avatar={agent.avatar} size={20} status={agent.status} />
                </span> : null;
              })}
              </span>
            </div>
          ) : (
            <span className="ac-status" aria-live="polite">
              {statusText(direct?.status, direct?.statusDetail)}
            </span>
          )}
        </div>
      </header>
      <div
        className="ac-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 40) older();
        }}
      >
        <div className="ac-scroll-inner" ref={inner}>
          {messages === null ? <Skeleton label={t("app:loading")} /> : null}
          {messages && !complete ? (
            <Button className="ac-older" onClick={older}>
              {t("acOlder")}
            </Button>
          ) : null}
          {messages?.length === 0 ? (
            <p className="muted ac-empty">{t("acStart")}</p>
          ) : null}
          {messages?.map((m) => {
            const day = dayKey(m.createdAt, preferences.timezone);
            const separator = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {separator ? (
                  <div className="ac-day" role="separator">
                    {formatDate(
                      m.createdAt,
                      preferences.locale,
                      preferences.timezone,
                      { dateStyle: "full" },
                    )}
                  </div>
                ) : null}
                <MessageItem
                  message={m}
                  messages={messages}
                  group={thread.kind === "group"}
                  currentUserId={snapshot.status === "authenticated" ? snapshot.principal.id : undefined}
                  onChoose={onChoose}
                  // edits are browser-local; a group room is shared, so it offers none
                  onEdit={thread.group ? undefined : onEdit}
                  onOpenAttachment={onOpenAttachment}
                  disabled={thread.readOnly}
                />
              </div>
            );
          })}
          {isThinking || interrupted ? (
            <div className="ac-thinking-row" role="status">
              <AgentFace
                name={activeAgent?.name ?? threadTitle(thread)}
                identity={activeAgent?.id ?? members[0]?.id ?? thread.id}
                avatar={activeAgent?.avatar ?? members[0]?.avatar ?? null}
                size={30}
                status={interrupted ? "idle" : activeStatus}
              />
              <ThinkingDisclosure
                detail={interrupted ?? thinkingDetail}
                interrupted={Boolean(interrupted)}
                queued={banner.queued}
              />
            </div>
          ) : null}
        </div>
      </div>
      <ChatComposer
        key={thread.id}
        disabled={thread.readOnly || domainUnavailable}
        groupStatus={thread.group?.status}
        mentionAgents={groupAgentIds.flatMap((id) => {
          const agent = agents.find((a) => a.id === id);
          return agent ? [{ slug: agent.slug, name: agent.name, avatar: agent.avatar }] : [];
        })}
        disabledReason={
          thread.readOnly
            ? t("acReadOnly")
            : domainUnavailable
              ? t("acDomainUnavailable")
              : undefined
        }
        thinking={isThinking && !interrupted}
        onStop={banner.running ? async () => {
          const detail = banner.running?.description ?? thinkingDetail;
          const code = await onCancel(banner.running!);
          if (!code) setInterrupted(detail);
        } : undefined}
        onSend={async (text, files, target, mention) => {
          setInterrupted(null);
          return onSend(text, files, target, mention);
        }}
      />
    </section>
  );
}

function DocumentPane({ attachment, onBack, onClose }: {
  attachment: ChatAttachment;
  onBack(): void;
  onClose(): void;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const { preferences } = usePreferences();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const lower = attachment.filename.toLowerCase();
  const markdown = attachment.mime === "text/markdown" || /\.mdx?$/.test(lower);
  const csv = attachment.mime === "text/csv" || lower.endsWith(".csv");
  const textual = attachment.mime.startsWith("text/") || /\.(md|mdx|txt|csv|json|xml|yaml|yml|log)$/.test(lower);
  const pdf = attachment.mime === "application/pdf" || lower.endsWith(".pdf");
  const image = attachment.mime.startsWith("image/");
  const officeKind: OfficeKind | null = lower.endsWith(".docx") ? "docx"
    : lower.endsWith(".xlsx") ? "xlsx"
      : lower.endsWith(".pptx") ? "pptx" : null;
  const browserPreview = pdf || markdown || /\.docx?$/.test(lower);
  const browserPreviewHref = `/chat/file-preview?${new URLSearchParams({
    name: attachment.filename,
    mime: attachment.mime,
    url: attachment.url,
  }).toString()}`;

  useEffect(() => {
    setText(null);
    setFailed(false);
    if (!textual) return undefined;
    const controller = new AbortController();
    fetch(attachment.url, { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(String(response.status))))
      .then(setText)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attachment.id, attachment.url, textual]);

  return (
    <aside className="ac-document" aria-label={t("acDocumentPreview")}>
      <header className="ac-document-header">
        <IconButton className="ac-back" label={t("acBack")} onClick={onBack}><ArrowLeft size={18} /></IconButton>
        <div><h2>{attachment.filename}</h2><span className="muted">{fileSize(attachment.size, preferences.locale)}</span></div>
        {browserPreview ? <a className="button button-ghost icon-button" href={browserPreviewHref} target="_blank" rel="noopener noreferrer" aria-label={t("acOpenBrowser", { name: attachment.filename })}><ExternalLink size={17} /></a> : null}
        <a className="button button-ghost icon-button" href={attachment.url} download={attachment.filename} aria-label={t("acDownload")}><Download size={17} /></a>
        <IconButton label={t("acCloseDocument")} onClick={onClose}><X size={18} /></IconButton>
      </header>
      <div className="ac-document-content">
        {image ? <img src={attachment.url} alt={attachment.filename} /> : null}
        {pdf ? <iframe src={attachment.url} title={attachment.filename} /> : null}
        {officeKind ? <OfficeDocumentPreview url={attachment.url} filename={attachment.filename} kind={officeKind} /> : null}
        {textual && text === null && !failed ? <Skeleton label={t("app:loading")} /> : null}
        {csv && text !== null ? <CsvDocumentPreview text={text} filename={attachment.filename} /> : null}
        {textual && !csv && text !== null ? (
          <article className="ac-report-paper ac-text-document">
            <header className="ac-report-masthead">
              <span>{t("acProfessionalReport")}</span>
              <strong>{attachment.filename.replace(/\.[^.]+$/, "")}</strong>
              <small>{lower.split(".").at(-1)?.toUpperCase()} · {t("acPreviewMode")}</small>
            </header>
            <div className="ac-report-rule" />
            <div className="ac-report-body">
              {markdown ? <MarkdownContent body={text} /> : <pre>{text}</pre>}
            </div>
            <footer className="ac-report-footer"><span>VDaAgent</span><span>{t("acPreviewMode")}</span></footer>
          </article>
        ) : null}
        {!image && !pdf && !textual && !officeKind ? (
          <div className="ac-document-unsupported">
            <FileText size={48} aria-hidden />
            <strong>{attachment.filename}</strong>
            <p className="muted">{t("acDocumentUnsupported")}</p>
            <a className="button button-primary" href={attachment.url} download={attachment.filename}><Download size={16} />{t("acDownload")}</a>
          </div>
        ) : null}
        {failed ? <p className="muted ac-document-error">{t("acDocumentLoadError")}</p> : null}
      </div>
    </aside>
  );
}

/* Legacy agent information pane retained temporarily for migration reference.
function InfoPane({
  thread,
  agents,
  banner,
  onBack,
  onClose,
  onUpdate,
}: {
  thread: ChatThread;
  agents: readonly TeamAgent[];
  banner: ReturnType<typeof taskBanner>;
  onBack(): void;
  onClose(): void;
  onUpdate(patch: {
    name?: string;
    add?: string[];
    remove?: string[];
  }): Promise<string | null>;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const statusText = useStatusText();
  const members = agentMembers(thread);
  const { preferences } = usePreferences();
  const builder = useServices().workspace[AGENT_BUILDER_KEY] as
    AgentBuilderService | undefined;
  const [routines, setRoutines] = useState<readonly Routine[]>([]);
  const directAgent = thread.kind === "direct" ? members[0]?.id : undefined;
  useEffect(() => {
    if (!builder || !directAgent) return undefined;
    const controller = new AbortController();
    void builder.routines(directAgent, controller.signal).then((r) => {
      if (!controller.signal.aborted && r.data) setRoutines(r.data);
    });
    return () => controller.abort();
  }, [builder, directAgent]);
  // the Lịch shortcut carries the next fire times (doc 14 "Right pane: info")
  const nextFires = routines
    .filter((r) => r.enabled && r.nextFires.length)
    .map((r) => ({ name: r.name, at: r.nextFires[0] }))
    .slice(0, 3);
  const [name, setName] = useState(thread.name ?? "");
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(thread.name ?? "");
    setError(null);
  }, [thread.id, thread.name]);
  const run = async (patch: Parameters<typeof onUpdate>[0]) =>
    setError(await onUpdate(patch));
  const header = (
    <div className="ac-info-top">
      <IconButton className="ac-back" label={t("acBack")} onClick={onBack}>
        <ArrowLeft size={18} />
      </IconButton>
      <h2>{t("acInfo")}</h2>
      <IconButton label={t("acHideInfo")} onClick={onClose}>
        <X size={18} />
      </IconButton>
    </div>
  );
  if (thread.kind === "direct") {
    const member = members[0];
    const agent = agents.find((a) => a.id === member?.id);
    const status =
      statusText(agent?.status, agent?.statusDetail) || t("acIdle");
    return (
      <aside className="ac-info" aria-label={t("acInfo")}>
        {header}
        <div className="ac-identity">
          <AgentFace
            name={member?.name ?? ""}
            identity={member?.id ?? "agent"}
            avatar={member?.avatar ?? null}
            size={72}
            status={agent?.status}
          />
          <h3>{member?.name}</h3>
          {agent?.isLead ? <span className="badge">{t("acLead")}</span> : null}
          <p className="muted">{agent?.description}</p>
          <p className="ac-status">● {status}</p>
        </div>
        {agent?.isLead && banner.running ? (
          <p className="ac-info-task">
            📋 T{banner.running.id} · {banner.running.description}
          </p>
        ) : null}
        {member ? (
          <>
            <nav className="ac-shortcuts">
              <Link to={`/agents/${member.id}/folder`}>
                <Folder size={16} />
                {t("acFolder")}
              </Link>
              <Link to={`/agents/${member.id}/role`}>
                <Settings2 size={16} />
                {t("acRole")}
              </Link>
              <Link to={`/agents/${member.id}/routines`}>
                <CalendarClock size={16} />
                {t("acSchedule")}
                {routines.length ? ` (${routines.length})` : ""}
              </Link>
            </nav>
            {nextFires.length ? (
              <ul className="ac-fires muted">
                {nextFires.map((f) => (
                  <li key={f.name}>
                    ⏰ {f.name} ·{" "}
                    {formatDate(f.at, preferences.locale, preferences.timezone)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </aside>
    );
  }
  const outside = agents.filter((a) => !members.some((m) => m.id === a.id));
  return (
    <aside className="ac-info" aria-label={t("acInfo")}>
      {header}
      <form
        className="row ac-rename"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run({ name: name.trim() });
        }}
      >
        <label className="sr-only" htmlFor="ac-group-name">
          {t("acRename")}
        </label>
        <Input
          id="ac-group-name"
          value={name}
          maxLength={100}
          disabled={thread.readOnly}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="submit"
          disabled={
            thread.readOnly || !name.trim() || name.trim() === thread.name
          }
        >
          {t("acSave")}
        </Button>
      </form>
      <h3>{t("acMembers")}</h3>
      <ul className="ac-members">
        {members.map((m) => {
          const a = agents.find((x) => x.id === m.id);
          return (
            <li key={m.id}>
              <AgentFace name={m.name} identity={m.id} avatar={m.avatar} size={28} status={a?.status} />
              <span>
                {m.name}
                <small className="muted">
                  {" "}
                  {statusText(a?.status, a?.statusDetail)}
                </small>
              </span>
              <IconButton
                label={t("acRemoveMember", { name: m.name })}
                disabled={thread.readOnly || members.length <= 2}
                onClick={() => void run({ remove: [m.id] })}
              >
                <X size={14} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {outside.length && !thread.readOnly ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding) void run({ add: [adding] }).then(() => setAdding(""));
          }}
        >
          <label className="sr-only" htmlFor="ac-add-member">
            {t("acAddMember")}
          </label>
          <Select
            id="ac-add-member"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">{t("acAddMember")}</option>
            {outside.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!adding}>
            {t("acAddMember")}
          </Button>
        </form>
      ) : null}
      {error ? (
        <InlineAlert kind="error">
          {t(`acError-${error}`, { defaultValue: t("acError-other") })}
        </InlineAlert>
      ) : null}
    </aside>
  );
}
*/
