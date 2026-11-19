import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { Input } from "../../../shared/ui/form";
import { InlineAlert } from "../../../shared/ui/feedback";
import { dayKey, formatDate } from "../../../shared/lib/format";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import type { AgentAvatar, AgentStatus, ChatThread, TeamAgent } from "../services/agent-chat-service";
import { agentMembers, threadPreview, threadTitle } from "../model/agent-chat-state";
import robotCoordinator from "../../../assets/agent-robots/robot-coordinator.png";
import robotChat from "../../../assets/agent-robots/robot-chat.png";
import robotCompare from "../../../assets/agent-robots/robot-compare.png";
import robotData from "../../../assets/agent-robots/robot-data.png";
import robotInsight from "../../../assets/agent-robots/robot-insight.png";
import robotReport from "../../../assets/agent-robots/robot-report.png";
import robotStorage from "../../../assets/agent-robots/robot-storage.png";
import robotDataCurator from "../../../assets/agent-robots/robot-data-curator.png";

const robotAssets = [
  robotCoordinator,
  robotChat,
  robotCompare,
  robotData,
  robotInsight,
  robotReport,
  robotStorage,
  robotDataCurator,
] as const;

function robotHash(value: string) {
  return [...value].reduce((hash, character) => ((hash * 31) + character.codePointAt(0)!) >>> 0, 7);
}

function robotVariant(name: string, identity: string) {
  const value = `${identity} ${name}`.toLocaleLowerCase();
  if (value.includes("lead") || value.includes("điều phối") || value.includes("dieu phoi") || value.includes("coordinator")) return 0;
  if (value.includes("chat") || value.includes("trò chuyện") || value.includes("tro chuyen")) return 1;
  if (value.includes("compare") || value.includes("so sánh") || value.includes("so sanh")) return 2;
  if (value.includes("insight") || value.includes("khám phá") || value.includes("kham pha")) return 4;
  if (value.includes("report") || value.includes("báo cáo") || value.includes("bao cao")) return 5;
  if (value.includes("chart") || value.includes("biểu đồ") || value.includes("bieu do") || value.includes("analytics")) return 6;
  if (value.includes("data") || value.includes("storage")) return robotHash(identity) % 2 === 0 ? 3 : 7;
  return robotHash(identity || name) % robotAssets.length;
}

function AgentRobot({ variant, group }: { variant: number; group: boolean }) {
  if (group) return (
    <span className="ac-robot-group">
      <img className="ac-robot ac-robot-back" src={robotAssets[(variant + 2) % robotAssets.length]} alt="" />
      <img className="ac-robot ac-robot-front" src={robotAssets[variant]} alt="" />
    </span>
  );
  return (
    <img className="ac-robot" data-variant={variant} src={robotAssets[variant]} alt="" />
  );
}

export function AgentFace({ name, avatar, identity = name, size = 36, group = false, status }: {
  name: string; avatar: AgentAvatar; identity?: string; size?: number; group?: boolean; status?: AgentStatus;
}) {
  const variant = robotVariant(name, identity);
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.43,
    "--ac-agent-color": avatar?.color ?? "#7c3aed",
  } as CSSProperties;
  return (
    <span
      className="ac-face"
      data-status={status ?? "idle"}
      data-group={group || undefined}
      data-robot={group ? "group" : variant}
      role="img"
      aria-label={name}
      style={style}
    >
      <span className="ac-face-body" aria-hidden="true">
        <AgentRobot variant={variant} group={group} />
      </span>
    </span>
  );
}

export function useStatusText() {
  const { t } = useTranslation("chat");
  return (status: AgentStatus | undefined, detail: string | null | undefined) =>
    status === "busy" ? t("acBusy")
      : status === "routine" ? t("acRoutine", { name: detail ?? "" })
        : status === "compacting" ? t("acCompacting") : "";
}

export function ThreadList({ threads, agents, activeId, onNewGroup }: {
  threads: readonly ChatThread[]; agents: readonly TeamAgent[]; activeId: string | null;
  onNewGroup(): void;
}) {
  const { t } = useTranslation("chat");
  const { preferences } = usePreferences();
  const statusText = useStatusText();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? threads.filter((th) => threadTitle(th).toLocaleLowerCase().includes(q)) : threads;
  }, [threads, query]);
  const today = dayKey(new Date().toISOString(), preferences.timezone);
  return (
    <nav className="ac-list" aria-label={t("acTitle")}>
      <header>
        <h2>{t("acTitle")}</h2>
        <label className="ac-search">
          <Search size={15} aria-hidden />
          <span className="sr-only">{t("acSearch")}</span>
          <Input value={query} placeholder={t("acSearch")} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>
      {[false, true].map((isGroup) => <div key={String(isGroup)} className="ac-thread-section">
        <h3>{isGroup ? "Nhóm" : "Cá nhân"}</h3>
        <ul>
        {shown.filter((th) => Boolean(th.group) === isGroup).map((th) => {
          const members = agentMembers(th);
          const agent = th.kind === "direct" ? agents.find((a) => a.id === members[0]?.id) : undefined;
          const lead = th.kind === "direct" && (members[0]?.isLead || agent?.isLead);
          const status = statusText(agent?.status, agent?.statusDetail);
          const when = th.lastMessage
            ? formatDate(th.lastMessageAt, preferences.locale, preferences.timezone,
              dayKey(th.lastMessageAt, preferences.timezone) === today
                ? { timeStyle: "short" } : { day: "2-digit", month: "2-digit" })
            : "";
          return (
            <li key={th.id}>
              <Link
                to={`/chat/${th.id}`}
                className={`ac-thread ${th.id === activeId ? "selected" : ""} ${th.readOnly ? "ac-dim" : ""}`}
                aria-current={th.id === activeId ? "page" : undefined}
              >
                <AgentFace name={threadTitle(th)} identity={members[0]?.id ?? th.id} avatar={members[0]?.avatar ?? null} group={th.kind === "group"} status={agent?.status} />
                <span className="ac-thread-text">
                  <span className="ac-thread-top">
                    <strong>{threadTitle(th)}</strong>
                    {lead ? <span className="badge">{t("acLead")}</span> : null}
                    <time>{when}</time>
                  </span>
                  <span className="ac-thread-bottom">
                    <span className="ac-preview">{status || threadPreview(th)}</span>
                    {th.unread > 0 ? <span className="ac-unread" aria-label={`${th.unread}`}>{th.unread}</span> : null}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        </ul>
      </div>)}
      {threads.length === 0 ? <p className="muted ac-empty">{t("acNoThreads")}</p>
        : shown.length === 0 ? <p className="muted ac-empty">{t("acNoMatch")}</p> : null}
      <footer>
        <Button onClick={onNewGroup}><Plus size={16} />{t("acNewGroup")}</Button>
      </footer>
    </nav>
  );
}

export function NewGroupDialog({ open, agents, onOpenChange, onCreate }: {
  open: boolean; agents: readonly TeamAgent[]; onOpenChange(open: boolean): void;
  onCreate(name: string, agentIds: string[]): Promise<string | null>;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const valid = name.trim().length > 0 && picked.length >= 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("acNewGroup")} closeLabel={t("app:close")}>
      <form
        className="stack ac-group-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setPending(true);
          const code = await onCreate(name.trim(), picked);
          setPending(false);
          if (code) setError(code);
          else { setName(""); setPicked([]); setError(null); }
        }}
      >
        <label className="stack">
          <span>{t("acGroupName")}</span>
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="stack">
          <legend>{t("acGroupAgents")}</legend>
          {agents.map((a) => (
            <label key={a.id} className="ac-pick">
              <input
                type="checkbox"
                checked={picked.includes(a.id)}
                onChange={(e) => setPicked((p) => e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id))}
              />
              <AgentFace name={a.name} identity={a.id} avatar={a.avatar} size={24} status={a.status} />
              <span>{a.name}</span>
              {a.isLead ? <span className="badge">{t("acLead")}</span> : null}
            </label>
          ))}
        </fieldset>
        {error ? <InlineAlert kind="error">{t(`acError-${error}`, { defaultValue: t("acError-other") })}</InlineAlert> : null}
        <Button type="submit" variant="primary" disabled={!valid} pending={pending}>{t("acCreate")}</Button>
      </form>
    </Dialog>
  );
}
