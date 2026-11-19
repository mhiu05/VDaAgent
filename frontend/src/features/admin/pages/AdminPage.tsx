import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { PageFrame, PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { Skeleton } from "../../../shared/ui/feedback";
import { formatDate, formatNumber } from "../../../shared/lib/format";
import { AgentFace } from "../../chat/components/AgentChatList";
import type { AgentStatus } from "../../chat/services/agent-chat-service";
import { MarkdownContent } from "../../chat/components/MarkdownContent";
import { FolderViewer } from "../../agents/components/FolderViewer";
import { AGENT_BUILDER_KEY, type AgentBuilderService } from "../../agents/services/builder-service";
import { ErrorText, useLoad, useStatusText } from "../../agents/components/common";
import {
  ADMIN_CONSOLE_KEY, type AdminConsoleService, type AgentTrace, type OverviewAgent,
} from "../services/admin-service";
import { buildTimeline, type InputBlock, type TimelineRow } from "../model/trace";
import "./admin.css";

const useAdmin = () => useServices().workspace[ADMIN_CONSOLE_KEY] as AdminConsoleService | undefined;
const MOTION_STATUSES: readonly AgentStatus[] = ["idle", "busy", "routine", "compacting"];
const motionStatus = (status: string): AgentStatus | undefined =>
  MOTION_STATUSES.find((candidate) => candidate === status);

/** `/admin`, `/admin/trace/:agentId` and `/admin/threads/:threadId` (doc 13). */
export default function AdminPage() {
  const { t } = useTranslation("admin");
  const service = useAdmin();
  const location = useLocation();
  const { agentId, threadId } = useParams();
  if (!service) return <PageFrame title={t("overview")}><PageState kind="empty" title={t("unavailable")} /></PageFrame>;
  if (location.pathname.startsWith("/admin/trace/") && agentId)
    return <WithSidebar service={service} agentId={agentId}><Trace service={service} agentId={agentId} /></WithSidebar>;
  if (location.pathname.startsWith("/admin/threads/") && threadId)
    return <WithSidebar service={service} threadId={threadId}><ThreadMode service={service} threadId={threadId} /></WithSidebar>;
  return <Overview service={service} />;
}

const langfuseTrace = (config: { langfuseUrl: string; projectId: string } | undefined, traceId: string) =>
  config ? `${config.langfuseUrl.replace(/\/$/, "")}/project/${config.projectId}/traces/${traceId}` : null;

function Overview({ service }: { service: AdminConsoleService }) {
  const { t } = useTranslation(["admin", "app"]);
  const { preferences } = usePreferences();
  const status = useStatusText();
  const overview = useLoad((s) => service.overview(s), [service]);
  const config = useLoad((s) => service.config(s), [service]);
  return (
    <PageFrame title={t("overview")} width="wide" actions={config.data ? (
      <a className="button button-secondary" href={config.data.langfuseUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} />{t("langfuse")}
      </a>) : null}>
      {overview.loading && !overview.data ? <Skeleton label={t("app:loading")} /> : null}
      <ErrorText code={overview.error} />
      {overview.data ? (
        <>
          <h2>{t("domains")}</h2>
          <ul className="admin-domains">
            {overview.data.domains.map((d) => (
              <li key={d.id} className={`admin-domain admin-domain-${d.status}`}>
                <strong>{d.name}</strong> <code>{d.id}</code> · {d.status}{d.statusReason ? ` · ${d.statusReason}` : ""}
              </li>
            ))}
          </ul>
          <h2>{t("agents")}</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("user")}</th><th>{t("domain")}</th><th>{t("agent")}</th><th>{t("status")}</th><th>{t("task")}</th>
                  <th>{t("queue")}</th><th>{t("pending")}</th><th>{t("compaction")}</th><th>{t("lastError")}</th><th>{t("costToday")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.agents.map((a) => (
                  <tr key={a.id}>
                    <td>{a.user.username}</td>
                    <td>{a.domain ?? "—"}</td>
                    <td><Link to={`/admin/trace/${a.id}`}>{a.avatar.emoji} {a.slug}</Link></td>
                    <td><span className={`admin-dot admin-dot-${a.status}`} aria-hidden /> {status(a.status, a.statusDetail)}</td>
                    <td>{a.currentTask ? `T${a.currentTask.id} · ${a.currentTask.description}` : "—"}</td>
                    <td>{a.queueLen ?? "—"}</td>
                    <td>{a.pending}</td>
                    <td>{a.compactionFailed ? <span className="error">{t("compactionFailed")}</span>
                      : a.compactionPending ? t("compactionPending") : "—"}</td>
                    <td>{a.lastErrorAt ? formatDate(a.lastErrorAt, preferences.locale, preferences.timezone) : "—"}</td>
                    <td>{formatNumber(a.costToday, preferences.locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </PageFrame>
  );
}

function WithSidebar({ service, agentId, threadId, children }: {
  service: AdminConsoleService; agentId?: string; threadId?: string; children: React.ReactNode;
}) {
  const { t } = useTranslation(["admin", "app"]);
  const overview = useLoad((s) => service.overview(s), [service]);
  const agents = useMemo(() => overview.data?.agents ?? [], [overview.data]);
  const current = agents.find((a) => a.id === agentId);
  const [userId, setUserId] = useState<string | null>(null);
  const selectedUser = userId ?? current?.user.id ?? null;
  const threads = useLoad(
    (s) => (selectedUser ? service.userThreads(selectedUser, s) : Promise.resolve({ data: [] })),
    [service, selectedUser],
  );
  const groups = useMemo(() => {
    const out = new Map<string, Map<string, OverviewAgent[]>>();
    for (const a of agents) {
      const d = out.get(a.domain ?? "—") ?? new Map<string, OverviewAgent[]>();
      d.set(a.user.id, [...(d.get(a.user.id) ?? []), a]);
      out.set(a.domain ?? "—", d);
    }
    return out;
  }, [agents]);
  return (
    <div className="admin-trace-layout">
      <nav className="admin-sidebar" aria-label={t("sidebar")}>
        <Link to="/admin">← {t("overview")}</Link>
        {[...groups].map(([domain, users]) => (
          <section key={domain}>
            <h3>{domain}</h3>
            {[...users].map(([uid, list]) => (
              <div key={uid} className="admin-user">
                <button type="button" onClick={() => setUserId(uid)} aria-expanded={selectedUser === uid}>{list[0].user.username}</button>
                <ul>
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link to={`/admin/trace/${a.id}`} className={a.id === agentId ? "selected" : ""}>
                        <span className={`admin-dot admin-dot-${a.status}`} aria-hidden /> {a.avatar.emoji} {a.slug}
                      </Link>
                    </li>
                  ))}
                </ul>
                {selectedUser === uid && threads.data?.length ? (
                  <ul className="admin-threads" aria-label={t("threads")}>
                    {threads.data.map((th) => (
                      <li key={th.id}>
                        <Link to={`/admin/threads/${th.id}`} className={th.id === threadId ? "selected" : ""}>
                          {th.kind === "agent" ? "⇄" : th.kind === "group" ? "👥" : "💬"} {th.name ?? th.members.filter((m) => m.type === "agent").map((m) => m.slug).join("+")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </section>
        ))}
      </nav>
      <div className="admin-main">{children}</div>
    </div>
  );
}

function Block({ block, slugToId, service, onMarked }: {
  block: InputBlock; slugToId: Map<string, string>; service: AdminConsoleService; onMarked(): void;
}) {
  const { t } = useTranslation("admin");
  const from = block.attrs.from ?? "";
  const agentSender = from.startsWith("agent:") ? slugToId.get(from.slice(6)) : undefined;
  const label = block.tag === "begin_task" ? t("beginTask", { id: block.attrs.id })
    : [block.tag, from, block.attrs.thread, block.attrs.kind].filter(Boolean).join(" · ");
  return (
    <div className={`trace-in trace-in-${block.tag}`}>
      <div className="trace-in-head">
        {agentSender ? <Link to={`/admin/trace/${agentSender}`}>{label}</Link> : <span>{label}</span>}
        {block.jev ? (
          <span className="trace-jev">
            <span className={`badge jev-${block.jev.label}`}>jev: {block.jev.label}{block.jev.fallback ? ` (${t("jevFallback")})` : ""}</span>
            {block.jev.observed ? <span className="muted">{t("jevObserved", { label: block.jev.observed })}</span> : (
              <Button onClick={async () => {
                await service.markJev(block.jev!.messageId, block.jev!.label === "task" ? "side_question" : "task");
                onMarked();
              }}>{t("jevWrong")}</Button>
            )}
          </span>
        ) : null}
      </div>
      <pre className="trace-text">{block.body}</pre>
    </div>
  );
}

function Row({ row, agentId, service, config, slugToId, onReload, onFolder }: {
  row: TimelineRow; agentId: string; service: AdminConsoleService; config?: { langfuseUrl: string; projectId: string };
  slugToId: Map<string, string>; onReload(): void; onFolder(commit: string): void;
}) {
  const { t } = useTranslation("admin");
  const { preferences } = usePreferences();
  const builder = useServices().workspace[AGENT_BUILDER_KEY] as AgentBuilderService | undefined;
  const [diff, setDiff] = useState<string | null>(null);
  switch (row.type) {
    case "activation": {
      const url = row.traceId ? langfuseTrace(config, row.traceId) : null;
      return (
        <div className="trace-activation" id={row.traceId ? `trace-${row.traceId}` : undefined}>
          <strong>{t("activation")} · {t(`act-${row.kind}`, { defaultValue: row.kind ?? "" })}{row.taskId ? ` · T${row.taskId}` : ""}</strong>
          <span>{formatDate(row.startedAt, preferences.locale, preferences.timezone, { timeStyle: "medium" })}</span>
          <span>{(row.durationMs / 1000).toFixed(1)} s</span>
          <span>{t("tokens", { count: row.tokens })}</span>
          <span>${row.cost.toFixed(4)}</span>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">{t("openLangfuse")}</a> : null}
        </div>
      );
    }
    case "input":
      return (
        <div className="trace-input">
          {row.state ? <details className="trace-state"><summary>{t("state")}</summary><pre>{row.state}</pre></details> : null}
          {row.blocks.map((b, i) => <Block key={i} block={b} slugToId={slugToId} service={service} onMarked={onReload} />)}
        </div>
      );
    case "reasoning":
      return <details className="trace-reasoning"><summary>{t("reasoning")}</summary><MarkdownContent body={row.text} /></details>;
    case "call":
      return (
        <div className="trace-call">
          <div className="trace-call-head">
            <strong>{t("call")}</strong>
            {row.sends.includes("user") ? <span className="badge">{t("toUser")}</span> : null}
            {row.sends.includes("agent") ? <span className="badge">{t("toAgent")}</span> : null}
            {row.endsTask ? <span className="badge">{t("endTask")}</span> : null}
            {row.result ? (
              <span className="muted">
                {row.result.exitCode !== null ? t("exit", { code: row.result.exitCode }) : ""}
                {row.result.durationMs !== null ? ` · ${(row.result.durationMs / 1000).toFixed(1)} s` : ""}
                {row.result.timedOut ? ` · ${t("timedOut")}` : ""}
              </span>
            ) : null}
          </div>
          <pre className="trace-code">{row.code}</pre>
          {row.result ? (
            <>
              <pre className={`trace-output ${row.result.exitCode ? "trace-output-failed" : ""}`}>{row.result.text}</pre>
              {row.result.offloadPath ? <p className="muted">{t("offloaded", { path: row.result.offloadPath })}</p> : null}
              {row.result.changed.length ? (
                <div className="trace-changed">
                  <span>{t("changed")}: {row.result.changed.map((f) => <code key={f.path}>{f.path}</code>)}</span>
                  {row.result.head && builder ? (
                    <>
                      <Button onClick={async () => setDiff((await builder.diff(agentId, row.result!.head!)).data ?? "")}>{t("showDiff")}</Button>
                      <Button onClick={() => onFolder(row.result!.head!)}>{t("folderAt")}</Button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {diff !== null ? <pre className="trace-code">{diff}</pre> : null}
            </>
          ) : null}
        </div>
      );
    case "epoch":
      return (
        <details className="trace-epoch">
          <summary>{t("epoch", { epoch: row.epoch.epoch })} · {row.epoch.reason}</summary>
          {row.epoch.summary ? <><h4>{t("summary")}</h4><pre className="trace-text">{row.epoch.summary}</pre></> : null}
          <h4>{t("systemPrompt")}</h4>
          <pre className="trace-text">{row.epoch.systemPrompt}</pre>
        </details>
      );
    case "error":
      return <div className="trace-error" role="alert"><strong>{t("error", { code: row.code })}</strong> {row.text}</div>;
  }
}

function Trace({ service, agentId }: { service: AdminConsoleService; agentId: string }) {
  const { t } = useTranslation(["admin", "app"]);
  const status = useStatusText();
  const builder = useServices().workspace[AGENT_BUILDER_KEY] as AgentBuilderService | undefined;
  const config = useLoad((s) => service.config(s), [service]);
  const overview = useLoad((s) => service.overview(s), [service]);
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ status: string; detail: string | null } | null>(null);
  const [folderAt, setFolderAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async (after: number) => {
    const r = await service.trace(agentId, after);
    if (r.error) { setError(r.error.code); return 0; }
    setTrace((prev) => {
      if (!prev || after === 0) return r.data;
      const seen = new Set(prev.events.map((e) => e.seq));
      return { ...r.data, events: [...prev.events, ...r.data.events.filter((e) => !seen.has(e.seq))] };
    });
    if (after === 0 || r.data.events.length) setMore(r.data.events.length >= 200);
    return r.data.events.length;
  }, [service, agentId]);

  useEffect(() => {
    setTrace(null);
    setLive(null);
    void load(0);
  }, [load]);

  const lastSeq = trace?.events.at(-1)?.seq ?? 0;
  useEffect(() => service.watch(agentId, (e) => {
    if (e.type === "status") setLive({ status: e.status, detail: e.statusDetail });
    else void load(lastSeq);
  }), [service, agentId, load, lastSeq]);

  const slugToId = useMemo(() => {
    const me = overview.data?.agents.find((a) => a.id === agentId);
    return new Map((overview.data?.agents ?? []).filter((a) => a.user.id === me?.user.id).map((a) => [a.slug, a.id]));
  }, [overview.data, agentId]);
  const rows = useMemo(() => (trace ? buildTimeline(trace.events, trace.epochs, trace.jev) : []), [trace]);
  if (error) return <ErrorText code={error} />;
  if (!trace) return <Skeleton label={t("app:loading")} />;
  const agent = trace.agent;
  return (
    <section className="trace">
      <header className="trace-header">
        <AgentFace name={agent.name} avatar={agent.avatar} size={40} status={motionStatus(live?.status ?? agent.status)} />
        <div>
          <h1 tabIndex={-1}>{agent.name} <small className="muted">@{agent.slug}</small></h1>
          <span className="muted">{t("live")} · {status(live?.status ?? agent.status, live ? live.detail : agent.statusDetail)}</span>
        </div>
        <Button onClick={async () => {
          const r = await service.compact(agentId);
          setNote(r.error ? null : t("compactRequested"));
        }}>{t("compactNow")}</Button>
      </header>
      {note ? <p role="status" className="muted">{note}</p> : null}
      {rows.length === 0 ? <p className="muted">{t("noEvents")}</p> : null}
      <div className="trace-rows">
        {rows.map((row, i) => (
          <Row key={i} row={row} agentId={agentId} service={service} config={config.data} slugToId={slugToId}
               onReload={() => void load(0)} onFolder={setFolderAt} />
        ))}
      </div>
      {more ? <Button onClick={() => void load(lastSeq)}>{t("older")}</Button> : null}
      {folderAt && builder ? (
        <Dialog open onOpenChange={(o) => { if (!o) setFolderAt(null); }} title={`${agent.slug} @ ${folderAt.slice(0, 7)}`}
                closeLabel={t("app:close")} className="trace-folder">
          <FolderViewer service={builder} agentId={agentId} initialAt={folderAt} />
        </Dialog>
      ) : null}
    </section>
  );
}

function ThreadMode({ service, threadId }: { service: AdminConsoleService; threadId: string }) {
  const { t } = useTranslation(["admin", "app"]);
  const { preferences } = usePreferences();
  const data = useLoad((s) => service.thread(threadId, s), [service, threadId]);
  if (data.loading && !data.data) return <Skeleton label={t("app:loading")} />;
  if (data.error || !data.data) return <ErrorText code={data.error} />;
  const { thread, messages } = data.data;
  const title = thread.name ?? thread.members.filter((m) => m.type === "agent").map((m) => m.slug).join(" + ");
  return (
    <section className="trace">
      <header className="trace-header">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          <span className="muted">{t("threadMode")} · {thread.kind}</span>
        </div>
      </header>
      <div className="trace-rows">
        {messages.map((m) => (
          <article key={m.id} className={`thread-msg thread-msg-${m.sender.type}`}>
            <div className="thread-msg-head">
              <strong>{m.sender.avatar?.emoji ?? ""} {m.sender.name}</strong>
              <time>{formatDate(m.createdAt, preferences.locale, preferences.timezone)}</time>
              {m.traceId && m.sender.type === "agent" && m.sender.id ? (
                <Link to={`/admin/trace/${m.sender.id}#trace-${m.traceId}`}>{t("sentBy")}</Link>
              ) : null}
            </div>
            {m.text ? <MarkdownContent body={m.text} /> : null}
            {m.attachments.length ? <p className="muted">📎 {m.attachments.map((a) => a.filename).join(", ")}</p> : null}
            {m.choices.length ? <p className="muted">{m.choices.map((c) => `[${c.label}]`).join(" ")}</p> : null}
            {m.reportRefs.length ? <p className="muted">📄 {m.reportRefs.map((r) => r.versionId).join(", ")}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
