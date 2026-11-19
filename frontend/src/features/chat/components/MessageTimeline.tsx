import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  ArrowDown,
  ArrowUpRight,
  FileText,
  ChevronDown,
} from "lucide-react";
import type { Agent, Conversation, Evidence, Message } from "../model/types";
import { MarkdownContent } from "./MarkdownContent";
import { Avatar } from "../../../shared/ui/identity";
import { Button, IconButton } from "../../../shared/ui/button";
import { InlineAlert, useFeedback } from "../../../shared/ui/feedback";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { useOverlay } from "../../../app/providers/OverlayProvider";
import { formatDate } from "../../../shared/lib/format";
import { safeUrl } from "../../../shared/lib/url-policy";
import { TableSurface } from "../../../shared/ui/data";
import { Link, useLocation } from "react-router";
import { AgentMessageBlocks, agentResultText } from "./AgentMessageBlocks";
const MessageView = memo(function MessageView({
  message,
  agents,
  onAction,
}: {
  message: Message;
  agents: readonly Agent[];
  onAction(action: "report" | "group"): void;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const { preferences } = usePreferences();
  const notify = useFeedback();
  const overlay = useOverlay();
  const location = useLocation();
  const reportQuery = new URLSearchParams();
  if (message.artifact?.reportId && message.artifact.versionId) {
    reportQuery.set("report", message.artifact.reportId);
    reportQuery.set("version", message.artifact.versionId);
    reportQuery.set("view", "dashboard");
    const scenario = new URLSearchParams(location.search).get("scenario");
    if (scenario) reportQuery.set("scenario", scenario);
  }
  const agent = agents.find((a) => a.id === message.author);
  const user = message.author === "user";
  function openSource(source: Evidence) {
    overlay.open({
      id: "feature-dialog",
      title: t("sourceDetail"),
      content: (
        <div className="stack">
          <h3>{source.title}</h3>
          <p>{source.excerpt}</p>
          <span className="badge">{t("app:source")}</span>
          {source.access !== "available" ? (
            <InlineAlert>
              {t(
                source.access === "restricted"
                  ? "app:restricted"
                  : "app:missingSource",
              )}
            </InlineAlert>
          ) : source.url && safeUrl(source.url) ? (
            <a
              href={safeUrl(source.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("app:view")}
              <ArrowUpRight size={14} />
            </a>
          ) : (
            <p className="muted">{t("noExternal")}</p>
          )}
        </div>
      ),
    });
  }
  return (
    <article
      className={`message ${user ? "message-user" : "message-agent"} agent-${message.author}`}
      data-message-id={message.id}
      data-surface={message.surface}
      tabIndex={-1}
    >
      <Avatar
        name={user ? t("you") : (agent?.name ?? "Agent")}
        glyph={user ? undefined : agent?.glyph}
      />
      <div className="message-content">
        <div className="message-meta">
          <strong>{user ? t("you") : agent?.name}</strong>
          {!user && !message.source && (
            <span className="message-demo">{t("mockResponse")}</span>
          )}
          {message.source === "mock_fixture" && !user ? (
            <span className="message-role">{t(`role-${message.author}`)}</span>
          ) : null}
          {message.source !== "mock_fixture" ? (
            <time dateTime={message.createdAt}>
              {formatDate(
                message.createdAt,
                preferences.locale,
                preferences.timezone,
                { hour: "2-digit", minute: "2-digit" },
              )}
            </time>
          ) : null}
        </div>
        <div className="message-body">
          {user ? (
            <p className="user-text">{message.body}</p>
          ) : message.state === "responding" ? (
            <div className="replay-text">{message.body}</div>
          ) : (
            <MarkdownContent body={message.body} />
          )}
        </div>
        {message.blocks ? (
          <AgentMessageBlocks
            blocks={message.blocks}
            scope={formatDate(
              message.dataThrough ?? message.createdAt,
              preferences.locale,
              preferences.timezone,
            )}
            onAction={onAction}
          />
        ) : null}
        {message.attachments?.map((a) => (
          <span key={a.id} className="badge">
            {a.name} · {t("unuploaded")}
          </span>
        ))}
        {message.evidence?.length ? (
          <div className="evidence-strip">
            <span className="eyebrow">{t("evidence")}</span>
            <div className="row">
              {message.evidence.map((e, i) => (
                <button
                  className="source-chip"
                  key={e.id}
                  onClick={() => openSource(e)}
                >
                  <span>{i + 1}</span>
                  <FileText size={13} />
                  <span>{e.title}</span>
                  {e.access !== "available" && (
                    <span aria-label={t("sourceUnavailable")}>!</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {message.contributions && (
          <details className="contributions">
            <summary>
              {t("contributions")} ({message.contributions.length})
              <ChevronDown size={14} />
            </summary>
            {message.contributions.map((c) => (
              <div key={c.agentId}>
                <strong>{agents.find((a) => a.id === c.agentId)?.name}</strong>
                <p>{c.body}</p>
              </div>
            ))}
          </details>
        )}
        {message.artifact && (
          <div className="artifact">
            <p className="eyebrow">{message.artifact.caption}</p>
            {message.artifact.kind === "report" &&
            message.artifact.access === "available" &&
            message.artifact.sourceMode &&
            reportQuery.has("version") ? (
              <Link to={`/reports?${reportQuery}`}>
                {t("reports:openDashboard")} · {message.artifact.versionId}
              </Link>
            ) : message.artifact.kind === "table" ? (
              <TableSurface
                caption={message.artifact.caption}
                header={
                  <tr>
                    {message.artifact.columns?.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                }
              >
                {message.artifact.rows?.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </TableSurface>
            ) : (
              <p className="muted">
                {t(
                  message.artifact.kind === "report"
                    ? "reportUnavailable"
                    : "artifactFallback",
                )}
              </p>
            )}
          </div>
        )}
        {["response-interrupted", "send-rejected", "cancelled"].includes(
          message.state,
        ) && (
          <InlineAlert
            kind={message.state === "send-rejected" ? "error" : "info"}
          >
            {t(
              message.state === "cancelled"
                ? "cancelled"
                : message.state === "send-rejected"
                  ? "sendFailed"
                  : user
                    ? "unknownAck"
                    : "incomplete",
            )}
          </InlineAlert>
        )}
        {message.state === "local-pending" && (
          <span role="status">{t("app:pending")}</span>
        )}
        {!user && message.state !== "responding" && (
          <IconButton
            label={t("app:copy")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  agentResultText(message.body, message.blocks),
                );
                notify({ kind: "success", title: t("app:copied") });
              } catch {
                notify({ kind: "error", title: t("app:copyError") });
              }
            }}
          >
            <Copy size={15} />
          </IconButton>
        )}
      </div>
    </article>
  );
});
export function MessageTimeline({
  conversation,
  agents,
  onPrompt,
  onGroup,
  readingScope,
  focusMessage,
}: {
  conversation: Conversation;
  agents: readonly Agent[];
  onPrompt(text: string): void;
  onGroup(): void;
  readingScope: string;
  focusMessage?: string;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const { reducedMotion } = usePreferences();
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const jumping = useRef(false);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [limit, setLimit] = useState(50);
  const [jump, setJump] = useState(false);
  const count = conversation.messages.length;
  const last = conversation.messages.at(-1);
  const storageKey = `vdaagent:chat-reading:${readingScope}:${conversation.id}`;
  const restored = useRef(false);
  const initialFocus = useRef(focusMessage);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (!restored.current) {
      restored.current = true;
      let saved: { top: number; bottom: boolean } | undefined;
      try {
        saved =
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null") ?? undefined;
      } catch {
        /* storage can be unavailable */
      }
      nearBottom.current = saved?.bottom ?? !conversation.scenarioId;
      el.scrollTop =
        saved && Number.isFinite(saved.top)
          ? saved.top
          : conversation.scenarioId
            ? 0
            : el.scrollHeight;
    } else if (anchor.current) {
      el.scrollTop =
        anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      setJump(false);
    } else setJump(true);
  }, [
    conversation.id,
    conversation.scenarioId,
    count,
    last?.sequence,
    limit,
    storageKey,
  ]);
  useEffect(() => {
    const target = initialFocus.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const message = Array.from(
        viewport.current?.querySelectorAll<HTMLElement>("[data-message-id]") ??
          [],
      ).find((el) => el.dataset.messageId === target);
      message?.scrollIntoView({ block: "start", behavior: "instant" });
      message?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="timeline-wrap">
      <div
        className="timeline"
        ref={viewport}
        onWheel={() => {
          jumping.current = false;
        }}
        onPointerDown={() => {
          jumping.current = false;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          // Smooth scrolling emits intermediate positions; keep the user's jump
          // intent until arrival, unless they start another scroll gesture.
          if (jumping.current && !atBottom) return;
          jumping.current = false;
          nearBottom.current = atBottom;
          setJump(!nearBottom.current);
          try {
            sessionStorage.setItem(
              storageKey,
              JSON.stringify({ top: el.scrollTop, bottom: atBottom }),
            );
          } catch {
            /* retain in-memory conversation */
          }
        }}
      >
        <div className="timeline-inner">
          {count > limit && (
            <div className="history-loader">
              <span className="muted">
                {t("limit")} · {limit}/{count}
              </span>
              <Button
                onClick={() => {
                  const el = viewport.current;
                  if (el)
                    anchor.current = {
                      height: el.scrollHeight,
                      top: el.scrollTop,
                    };
                  setLimit((l) => l + 50);
                }}
              >
                {t("older")}
              </Button>
            </div>
          )}
          {count ? (
            conversation.messages
              .slice(-limit)
              .map((m) => (
                <MessageView
                  key={m.id}
                  message={m}
                  agents={agents}
                  onAction={(action) =>
                    action === "group"
                      ? onGroup()
                      : onPrompt("/report Riverside đợt 10")
                  }
                />
              ))
          ) : (
            <div className="chat-empty">
              <span className="empty-glyph">◈</span>
              <span className="eyebrow">{t("workspaceLabel")}</span>
              <h2>{t("emptyTitle")}</h2>
              <p>{t("emptyDescription")}</p>
              <div className="stack">
                {["prompt1", "prompt2", "prompt3"].map((p) => (
                  <Button key={p} onClick={() => onPrompt(t(p))}>
                    {t(p)}
                    <ArrowUpRight size={16} />
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {jump && (
        <Button
          className="jump-latest"
          onClick={() => {
            const el = viewport.current;
            jumping.current = true;
            if (el)
              el.scrollTo({
                top: el.scrollHeight,
                behavior: reducedMotion ? "instant" : "smooth",
              });
            nearBottom.current = true;
            setJump(false);
          }}
        >
          <ArrowDown size={16} />
          {t("jump")}
        </Button>
      )}
    </div>
  );
}
