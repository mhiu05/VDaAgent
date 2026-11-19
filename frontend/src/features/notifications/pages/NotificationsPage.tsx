import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bell,
  ArrowUpRight,
  CheckCheck,
  FileText,
  Info,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { useNotifications } from "../state/NotificationsProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { useServices } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { resolveTarget } from "../../../app/routing/targets";
import {
  AGENT_CHAT_KEY,
  type AgentChatService,
} from "../../chat/services/agent-chat-service";
import { PageFrame, PageState } from "../../../shared/ui/page";
import { Button, IconButton } from "../../../shared/ui/button";
import { Select } from "../../../shared/ui/form";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { formatDate, dayKey } from "../../../shared/lib/format";
import type { Notification, NotificationKind } from "../model/types";
import "./notifications.css";
const icons = {
  "account-created": UserRound,
  system: Info,
  "report-ready": FileText,
  "task-failed": TriangleAlert,
  "action-required": Bell,
};
export default function NotificationsPage() {
  const { t } = useTranslation(["notifications", "app"]);
  const store = useNotifications();
  const { preferences: p } = usePreferences();
  const services = useServices();
  const { chat, context, reportTargets } = services;
  const { snapshot } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [kind, setKind] = useState("all");
  const [detail, setDetail] = useState<Notification | null>(null);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState(false);
  const detailRegion = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const allFilter = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (detail) detailRegion.current?.focus();
  }, [detail]);
  const unread = store.items.filter((n) => !n.readAt).length;
  const items = store.items.filter(
    (n) =>
      (filter === "all" || !n.readAt) && (kind === "all" || n.kind === kind),
  );
  const now = context.clock.now();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const key = dayKey(n.occurredAt, p.timezone);
    const group =
      key === dayKey(now.toISOString(), p.timezone)
        ? "today"
        : key === dayKey(yesterday.toISOString(), p.timezone)
          ? "yesterday"
          : "earlier";
    groups.set(group, [...(groups.get(group) ?? []), n]);
  }
  async function open(n: Notification) {
    setDetail(n);
    setTargetError(false);
    setError("");
    if (!n.readAt) {
      const error = await store.markRead(n.id);
      if (error) setError(error);
    }
  }
  async function target(n: Notification) {
    if (snapshot.status !== "authenticated") return;
    // the target chat (S12b) addresses threads as /chat/:threadId
    const agentChat = services.workspace[AGENT_CHAT_KEY] as AgentChatService | undefined;
    let ids: string[] | null;
    if (agentChat) {
      const threads = await agentChat.threads();
      ids = threads.error ? null : threads.data.map((c) => c.id);
    } else {
      const loaded = await chat.load(snapshot.principal.id);
      ids = loaded.error ? null : loaded.data.conversations.map((c) => c.id);
    }
    const resolved =
      n.access === "available" && ids
        ? resolveTarget(
            n.target,
            snapshot.principal.role,
            ids,
            reportTargets.hasReport,
          )
        : null;
    const path =
      resolved && agentChat && n.target.kind === "chat"
        ? `/chat/${encodeURIComponent(n.target.conversationId)}`
        : resolved;
    if (path) navigate(path);
    else setTargetError(true);
  }
  return (
    <PageFrame
      title={t("title")}
      actions={
        <div className="stack">
          <Button
            disabled={!unread || store.pending}
            onClick={async () => {
              const e = await store.markRead();
              setError(e ?? "");
            }}
          >
            <CheckCheck size={16} />
            {t("markAll")}
          </Button>
          <span className="field-description">{t("markScope")}</span>
        </div>
      }
    >
      <div className="notification-toolbar">
        <div className="segmented">
          {["all", "unread"].map((f) => (
            <button
              key={f}
              ref={f === "all" ? allFilter : undefined}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(`app:${f}`)}
              {f === "unread" && <span>{unread}</span>}
            </button>
          ))}
        </div>
        <Select
          aria-label={t("filter")}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">{t("app:all")}</option>
          {Object.keys(icons).map((k) => (
            <option key={k} value={k}>
              {t(k)}
            </option>
          ))}
        </Select>
      </div>
      {(error || store.error) && (
        <InlineAlert kind="error">
          {t(error || store.error)}{" "}
          <Button
            variant="ghost"
            onClick={() => {
              store.reload();
              setError("");
            }}
          >
            {t("app:retry")}
          </Button>
        </InlineAlert>
      )}
      {store.loading ? (
        <Skeleton label={t("app:loading")} />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title={t(
            store.items.length === 0
              ? "noItems"
              : filter === "unread"
                ? "noUnread"
                : "noResults",
          )}
        />
      ) : (
        Array.from(groups, ([key, notifications]) => (
          <section className="notification-group" key={key}>
            <h2 className="eyebrow">{t(key)}</h2>
            <ul>
              {notifications.map((n) => {
                const Icon = icons[n.kind as NotificationKind];
                return (
                  <li key={n.id} className={!n.readAt ? "is-unread" : ""}>
                    <button
                      onClick={(event) => {
                        detailTrigger.current = event.currentTarget;
                        void open(n);
                      }}
                      aria-expanded={detail?.id === n.id}
                      aria-controls={
                        detail?.id === n.id ? "notification-detail" : undefined
                      }
                      aria-label={`${t("open")}: ${n.title[p.locale]}`}
                    >
                      <span className="notification-icon">
                        <Icon size={19} />
                      </span>
                      <span className="notification-summary">
                        <span className="row">
                          <strong>{n.title[p.locale]}</strong>
                          {!n.readAt && (
                            <span className="badge">{t("unread")}</span>
                          )}
                        </span>
                        <span>{n.summary[p.locale]}</span>
                        <small>
                          {t(n.kind)} ·{" "}
                          {formatDate(n.occurredAt, p.locale, p.timezone)}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {detail && (
        <section
          id="notification-detail"
          ref={detailRegion}
          tabIndex={-1}
          className="notification-detail"
          aria-label={detail.title[p.locale]}
        >
          <header className="row spread">
            <h2>{detail.title[p.locale]}</h2>
            <IconButton
              label={t("back")}
              onClick={() => {
                setDetail(null);
                if (detailTrigger.current?.isConnected)
                  detailTrigger.current.focus();
                else allFilter.current?.focus();
              }}
            >
              <X size={18} />
            </IconButton>
          </header>
          <p>{detail.summary[p.locale]}</p>
          <span className="badge">{t("app:demo")}</span>
          {detail.target.kind !== "system-detail" && (
            <Button variant="primary" onClick={() => void target(detail)}>
              {t("target")}
              <ArrowUpRight size={16} />
            </Button>
          )}
          {targetError && <InlineAlert>{t("app:targetMissing")}</InlineAlert>}
        </section>
      )}
    </PageFrame>
  );
}
