import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  PanelLeft,
  PanelRight,
  FileText,
  MessagesSquare,
} from "lucide-react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { useOverlay } from "../../../app/providers/OverlayProvider";
import type { AgentId, Attachment, ChatBundle } from "../model/types";
import { AgentSidebar } from "../components/AgentSidebar";
import { AgentInspector } from "../components/AgentInspector";
import { MessageTimeline } from "../components/MessageTimeline";
import { Composer } from "../components/Composer";
import { PageState } from "../../../shared/ui/page";
import { Button, IconButton } from "../../../shared/ui/button";
import { Avatar } from "../../../shared/ui/identity";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { PinnedReportLink } from "../components/ReportReferenceCard";
import { resolveMockCommand } from "../model/commands";
import { pinnedReportPath } from "../model/report-navigation";
import "./chat.css";
import "./fleet.css";
const inspectorMedia = "(min-width: 1440px)";
export default function ChatPage() {
  const { t } = useTranslation(["chat", "app"]);
  const { chat } = useServices();
  const { snapshot } = useAuth();
  const principal =
    snapshot.status === "authenticated" ? snapshot.principal.id : "";
  const overlay = useOverlay();
  const location = useLocation();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const [params, setParams] = useSearchParams();
  const [bundle, setBundle] = useState<ChatBundle | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [dockedInspector, setDockedInspector] = useState(
    () => window.matchMedia(inspectorMedia).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(inspectorMedia);
    const update = () => setDockedInspector(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [inspector, setInspector] = useState(() =>
    chat.inspectorOpen(principal),
  );
  const changeInspector = (open: boolean) => {
    setInspector(open);
    chat.saveInspector(principal, open);
  };
  const [focusedAgent, setFocusedAgent] = useState<AgentId>("orchestrator");
  const [online, setOnline] = useState(navigator.onLine);
  const [prompt, setPrompt] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState("");
  const [commandRevision, setCommandRevision] = useState(0);
  const work = useRef<{ controller: AbortController; id: string } | null>(null);
  const bytes = useRef(new Map<string, File>());
  const drafts = useRef(
    new Map<string, { draft: string; attachments: Attachment[] }>(),
  );
  const mounted = useRef(false);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const agents = useMemo(() => chat.catalog(), [chat]);
  const reload = useCallback(async () => {
    setError("");
    const r = await chat.load(principal);
    if (!mounted.current) return;
    if (r.error) setError(r.error.messageKey);
    else setBundle(r.data);
  }, [chat, principal]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const capturedBytes = bytes.current;
    return () => {
      mounted.current = false;
      work.current?.controller.abort();
      capturedBytes.clear();
    };
  }, [reload]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const selectedId = params.get("conversation");
  const storedConversation =
    bundle?.conversations.find((c) => c.id === selectedId) ??
    bundle?.conversations[0];
  const current = storedConversation
    ? { ...storedConversation, ...drafts.current.get(storedConversation.id) }
    : undefined;
  const select = (id: string) => {
    work.current?.controller.abort();
    work.current = null;
    setPending(false);
    setPrompt("");
    setNotice("");
    setParams((p) => {
      p.set("conversation", id);
      return p;
    });
    const conversation = bundle?.conversations.find((c) => c.id === id);
    if (conversation) setFocusedAgent(conversation.participants[0]);
    overlay.close();
  };
  async function create(participants: AgentId[]) {
    const result = await chat.create(principal, participants);
    setBundle(result);
    const c = result.conversations.at(-1);
    if (c) {
      setParams((p) => {
        p.set("conversation", c.id);
        return p;
      });
      setFocusedAgent(c.participants[0]);
      setPrompt("");
      overlay.close();
    }
  }
  async function send(body: string, files: Attachment[]) {
    if (!current || work.current) return;
    const command =
      chat.sourceMode === "mock"
        ? resolveMockCommand(current, body)
        : "message";
    if (command === "report") {
      drafts.current.set(current.id, { draft: "", attachments: files });
      await chat.saveDraft(principal, current.id, "", files);
      setCommandRevision((value) => value + 1);
      setPrompt("");
      setNotice("");
      const reference = current.messages.find((m) =>
        m.blocks?.some((b) => b.kind === "report-ref"),
      );
      if (reference) {
        const target = Array.from(
          document.querySelectorAll<HTMLElement>(".timeline [data-message-id]"),
        ).find((el) => el.dataset.messageId === reference.id);
        target?.scrollIntoView({ block: "start", behavior: "instant" });
        target?.focus({ preventScroll: true });
      } else if (current.reportRef) {
        navigate(pinnedReportPath(current.reportRef, location.search), {
          state: {
            chatOrigin: `/chat?${new URLSearchParams({ conversation: current.id })}`,
            reportViewerDepth: 1,
          },
        });
      }
      return;
    }
    if (
      command === "unsupported" ||
      (chat.sourceMode === "mock" && current.scenarioId)
    ) {
      setNotice(
        t(
          command === "unsupported"
            ? "unsupportedReportCommand"
            : "mockInputNotice",
        ),
      );
      return;
    }
    const controller = new AbortController();
    const id = chat.allocateId("request");
    work.current = { controller, id };
    setPending(true);
    setPrompt("");
    setError("");
    setAnnouncement("");
    const result = await chat.send(
      principal,
      current.id,
      body,
      files,
      id,
      controller.signal,
      (b) => {
        if (mounted.current && !controller.signal.aborted) {
          const conversation = b.conversations.find((c) => c.id === current.id);
          if (conversation)
            drafts.current.set(current.id, {
              draft: conversation.draft,
              attachments: conversation.attachments,
            });
          setBundle(b);
        }
      },
    );
    if (!mounted.current || controller.signal.aborted) return;
    if (result.error) setError(result.error.messageKey);
    else {
      setBundle(result.data);
      setAnnouncement(t("replyComplete"));
    }
    work.current = null;
    setPending(false);
  }
  if (!bundle)
    return error ? (
      <PageState
        kind="error"
        title={t("app:error")}
        description={t(error)}
        action={<Button onClick={() => void reload()}>{t("app:retry")}</Button>}
      />
    ) : (
      <div style={{ padding: 32 }}>
        <Skeleton label={t("app:loading")} />
      </div>
    );
  if (!current) return <PageState kind="empty" title={t("emptyTitle")} />;
  const selectedAgent =
    agents.find(
      (a) => a.id === focusedAgent && current.participants.includes(a.id),
    ) ?? agents.find((a) => a.id === current.participants[0])!;
  const sidebar = (
    <AgentSidebar
      agents={agents}
      bundle={bundle}
      current={current}
      onSelect={select}
      onCreate={(ids) => void create(ids)}
    />
  );
  const inspectorContent = (
    <AgentInspector
      agent={selectedAgent}
      agents={agents}
      participants={current.participants}
      onSelect={setFocusedAgent}
      conversation={current}
      onAgent={(id) => {
        const dm = bundle.conversations.find(
          (c) =>
            c.kind === "direct" &&
            c.participants[0] === id &&
            c.scenarioId === current.scenarioId,
        );
        if (dm) select(dm.id);
      }}
    />
  );
  const replay = chat.delivery === "replay";
  const offline = !online || chat.connection === "offline";
  const interrupted = current.messages.some(
    (message) => message.state === "response-interrupted",
  );
  return (
    <section
      className={`chat-layout ${inspector ? "inspector-open" : ""} ${current.scenarioId ? "fleet-scenario" : ""}`}
    >
      <h1 className="sr-only" tabIndex={-1}>
        {t("app:chat")}
      </h1>
      <div className="docked-agent-list">{sidebar}</div>
      <div className="conversation-workspace">
        <header className="conversation-header">
          <div className="row">
            <IconButton
              className="agents-mobile-toggle"
              ref={agentTrigger}
              label={t("agents")}
              onClick={() =>
                overlay.open({
                  id: "agents",
                  title: t("agents"),
                  side: "left",
                  content: sidebar,
                  triggerRef: agentTrigger,
                })
              }
            >
              <PanelLeft size={19} />
            </IconButton>
            <Avatar
              name={selectedAgent.name}
              glyph={
                current.kind === "group" ? (
                  <MessagesSquare size={18} />
                ) : (
                  selectedAgent.glyph
                )
              }
            />
            <div>
              <h2 tabIndex={-1}>{current.title}</h2>
              <p className="conversation-subtitle">
                {current.kind === "group"
                  ? `${current.participants.length} ${t("participants")} · ${current.context?.project ?? t("groupDisclaimer")}`
                  : selectedAgent.description[preferences.locale]}
              </p>
            </div>
          </div>
          <div className="conversation-header-actions">
            {current.scenarioId ? (
              <span className="fleet-mock-badge">{t("simulation")}</span>
            ) : null}
            {current.reportRef ? (
              <PinnedReportLink
                reference={current.reportRef}
                className="button button-secondary fleet-header-report"
              >
                <FileText size={15} />
                <span>{t("reportShort")}</span>
              </PinnedReportLink>
            ) : null}
            <IconButton
              ref={inspectorTrigger}
              label={t("inspector")}
              aria-expanded={dockedInspector ? inspector : undefined}
              aria-haspopup={dockedInspector ? undefined : "dialog"}
              onClick={() => {
                if (dockedInspector) changeInspector(!inspector);
                else
                  overlay.open({
                    id: "inspector",
                    title: t("inspector"),
                    content: inspectorContent,
                    triggerRef: inspectorTrigger,
                  });
              }}
            >
              <PanelRight size={19} />
            </IconButton>
          </div>
        </header>
        {selectedId &&
          !bundle.conversations.some((c) => c.id === selectedId) && (
            <InlineAlert>{t("app:targetMissing")}</InlineAlert>
          )}
        {(offline || interrupted) && (
          <InlineAlert>{t(offline ? "app:offline" : "incomplete")}</InlineAlert>
        )}
        {replay && (
          <div className="replay-label" role="status">
            {t("replay")}
            {pending ? ` · ${t("loadingReplay")}` : ""}
          </div>
        )}
        {chat.degraded && <InlineAlert>{t("app:storage")}</InlineAlert>}
        {error && <InlineAlert kind="error">{t(error)}</InlineAlert>}
        {notice && <InlineAlert>{notice}</InlineAlert>}
        <MessageTimeline
          key={current.id}
          conversation={current}
          agents={agents}
          readingScope={principal}
          focusMessage={location.state?.chatFocusMessage}
          onGroup={() => {
            const group = bundle.conversations.find(
              (c) => c.kind === "group" && c.scenarioId === current.scenarioId,
            );
            if (group) select(group.id);
          }}
          onPrompt={(text) => {
            setPrompt(text);
            drafts.current.set(current.id, {
              draft: text,
              attachments: current.attachments,
            });
            void chat.saveDraft(
              principal,
              current.id,
              text,
              current.attachments,
            );
          }}
        />
        <Composer
          key={`${current.id}-${commandRevision}-${current.messages.filter((m) => m.author === "user" && ["accepted", "complete"].includes(m.state)).length}`}
          conversation={current}
          agents={agents}
          pending={pending}
          replay={replay}
          offline={offline}
          bytes={bytes}
          allocateId={chat.allocateId}
          onDraft={(draft, attachments) => {
            drafts.current.set(current.id, { draft, attachments });
            void chat.saveDraft(principal, current.id, draft, attachments);
          }}
          onSend={(body, files) => void send(body, files)}
          onCancel={() => {
            if (work.current) void chat.cancel(principal, work.current.id);
          }}
          prompt={prompt}
        />
        <div className="sr-only" role="status">
          {announcement}
        </div>
      </div>
      {inspector && (
        <div className="docked-inspector">
          <AgentInspector
            agent={selectedAgent}
            agents={agents}
            participants={current.participants}
            conversation={current}
            onSelect={setFocusedAgent}
            onAgent={(id) => {
              const dm = bundle.conversations.find(
                (c) =>
                  c.kind === "direct" &&
                  c.participants[0] === id &&
                  c.scenarioId === current.scenarioId,
              );
              if (dm) select(dm.id);
            }}
            onClose={() => changeInspector(false)}
          />
        </div>
      )}
    </section>
  );
}
