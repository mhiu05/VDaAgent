import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { PageFrame } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { FormField, Input, Select } from "../../../shared/ui/form";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { formatDate } from "../../../shared/lib/format";
import { useLoad } from "../../agents/components/common";
import { ADMIN_CONSOLE_KEY, type AdminConsoleService, type AdminUser } from "../services/admin-service";
import "./admin.css";

function Failure({ code }: { code: string | null }) {
  const { t } = useTranslation("admin");
  return code ? <InlineAlert kind="error">{t(`error-${code}`, { defaultValue: t("error-other") })}</InlineAlert> : null;
}

type Action = { kind: "password" | "resetAgent" | "disable"; user: AdminUser } | { kind: "create" } | null;

/** While any row is provisioning the list is re-read this often (doc 12 "User management"). */
export const USERS_POLL_MS = 4000;
const BADGE: Record<AdminUser["status"], string> = {
  active: "badge-success", provisioning: "badge-warning", failed: "badge-danger", disabled: "",
};
const DETAIL_MAX = 160;

/** One line on where a provisioning user is: queued behind another job, or the agent being made. */
function Progress({ user }: { user: AdminUser }) {
  const { t } = useTranslation("admin");
  const p = user.provisioning;
  const text = p?.jobStatus === "queued" ? t("provQueued")
    : p?.agent ? t("provAgent", { agent: p.agent, n: Math.min(p.done + 1, p.total), total: p.total })
    : t("provWorking");
  return <small className="muted admin-progress">{text}</small>;
}

/** `/admin/users` on the API (doc 12 "User management"). */
export default function UsersPage() {
  const { t } = useTranslation(["admin", "app"]);
  const { preferences } = usePreferences();
  const service = useServices().workspace[ADMIN_CONSOLE_KEY] as AdminConsoleService;
  const users = useLoad((s) => service.users(s), [service]);
  const reloadUsers = users.reload;
  // a failed poll keeps the last list on screen (and the polling going) instead of blanking it
  const lastRows = useRef<AdminUser[] | undefined>(undefined);
  if (users.data) lastRows.current = users.data;
  const rows = users.data ?? lastRows.current;
  // provisioning runs as the new user's `builder.job`, whose events the admin's stream never
  // carries — poll while any row is still provisioning (doc 12 "User management"); `reload`
  // aborts a read still in flight, so polls never pile up
  const provisioning = (rows ?? []).some((u) => u.status === "provisioning");
  useEffect(() => {
    if (!provisioning) return undefined;
    const timer = setInterval(reloadUsers, USERS_POLL_MS);
    return () => clearInterval(timer);
  }, [provisioning, reloadUsers]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const done = (code: string | null, message = t("done")) => {
    setError(code);
    setNote(code ? null : message);
    if (!code) { setAction(null); users.reload(); }
  };
  const retry = async (u: AdminUser) => {
    setRetrying(u.id);
    const r = await service.retryProvisioning(u.id);
    setRetrying(null);
    done(r.error?.code ?? null, t("retryQueued"));
  };
  return (
    <PageFrame title={t("usersTitle")} width="wide" actions={
      <Button variant="primary" onClick={() => setAction({ kind: "create" })}><Plus size={16} />{t("createUser")}</Button>
    }>
      {users.loading && !rows ? <Skeleton label={t("app:loading")} /> : null}
      {note ? <p role="status" className="muted">{note}</p> : null}
      {!action ? <Failure code={error ?? (rows ? null : users.error) ?? null} /> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>{t("username")}</th><th>{t("displayName")}</th><th>{t("domain")}</th><th>{t("status")}</th><th>{t("created")}</th><th>{t("actions")}</th></tr>
          </thead>
          <tbody>
            {rows?.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong></td>
                <td>{u.displayName || "—"}</td>
                <td>{u.domain ? `${u.domain.name} (${u.domain.status})` : "—"}</td>
                <td>
                  <span className={`badge ${BADGE[u.status]} admin-status-${u.status}`}>{t(`st-${u.status}`)}</span>
                  {u.status === "provisioning" ? <Progress user={u} /> : null}
                  {u.statusDetail ? (
                    <small className="muted admin-progress" title={u.statusDetail}>
                      {u.statusDetail.length > DETAIL_MAX ? `${u.statusDetail.slice(0, DETAIL_MAX)}…` : u.statusDetail}
                    </small>
                  ) : null}
                </td>
                <td>{formatDate(u.createdAt, preferences.locale, preferences.timezone)}</td>
                <td className="admin-actions">
                  {u.status === "failed" ? (
                    <Button variant="primary" disabled={retrying === u.id} aria-busy={retrying === u.id || undefined}
                      onClick={() => void retry(u)}>
                      {retrying === u.id ? t("retrying") : t("retry")}
                    </Button>
                  ) : null}
                  {u.status === "disabled"
                    ? <Button onClick={async () => done((await service.setDisabled(u.id, false)).error?.code ?? null)}>{t("enable")}</Button>
                    : <Button onClick={() => setAction({ kind: "disable", user: u })}>{t("disable")}</Button>}
                  <Button onClick={() => setAction({ kind: "password", user: u })}>{t("resetPassword")}</Button>
                  <Button onClick={() => setAction({ kind: "resetAgent", user: u })}>{t("resetAgent")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {action?.kind === "create" ? <CreateUser service={service} error={error} onClose={() => { setAction(null); setError(null); }} onDone={done} /> : null}
      {action?.kind === "password" ? <PasswordDialog service={service} user={action.user} error={error} onClose={() => { setAction(null); setError(null); }} onDone={done} /> : null}
      {action?.kind === "resetAgent" ? <ResetAgentDialog service={service} user={action.user} error={error} onClose={() => { setAction(null); setError(null); }} onDone={done} /> : null}
      {action?.kind === "disable" ? (
        <Dialog open onOpenChange={(o) => { if (!o) setAction(null); }} title={`${t("disable")} ${action.user.username}?`} closeLabel={t("app:close")}>
          <div className="row admin-dialog-actions">
            <Button onClick={() => setAction(null)}>{t("cancel")}</Button>
            <Button variant="danger" onClick={async () => done((await service.setDisabled(action.user.id, true)).error?.code ?? null)}>{t("confirm")}</Button>
          </div>
        </Dialog>
      ) : null}
    </PageFrame>
  );
}

type DialogProps = { service: AdminConsoleService; error: string | null; onClose(): void; onDone(code: string | null): void };

function CreateUser({ service, error, onClose, onDone }: DialogProps) {
  const { t } = useTranslation(["admin", "app"]);
  const [local, setLocal] = useState<string | null>(null);
  const overview = useLoad((s) => service.overview(s), [service]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domainId, setDomainId] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("createUser")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        // a browser may autofill the password into the display name; it would then be shown to others
        if (displayName.trim() && displayName.trim() === password.trim()) { setLocal("displayNameIsPassword"); return; }
        setLocal(null);
        onDone((await service.createUser({ username: username.trim(), password, domainId, displayName: displayName.trim() })).error?.code ?? null);
      }}>
        <FormField id="u-name" label={t("username")}><Input id="u-name" name="username" value={username} required autoComplete="off" onChange={(e) => setUsername(e.target.value)} /></FormField>
        <FormField id="u-pass" label={t("password")}><Input id="u-pass" name="new-password" type="password" value={password} required autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></FormField>
        <FormField id="u-domain" label={t("domain")}>
          <Select id="u-domain" value={domainId} required onChange={(e) => setDomainId(e.target.value)}>
            <option value="">—</option>
            {overview.data?.domains.filter((d) => d.status === "available").map((d) => <option key={d.id} value={d.id}>{d.name} ({d.status})</option>)}
          </Select>
        </FormField>
        <FormField id="u-display" label={t("displayName")}><Input id="u-display" name="display_name" value={displayName} maxLength={100} autoComplete="off" onChange={(e) => setDisplayName(e.target.value)} /></FormField>
        <Failure code={local ?? error} />
        <Button type="submit" variant="primary" disabled={!username.trim() || !password || !domainId}>{t("createUser")}</Button>
      </form>
    </Dialog>
  );
}

function PasswordDialog({ service, user, error, onClose, onDone }: DialogProps & { user: AdminUser }) {
  const { t } = useTranslation(["admin", "app"]);
  const [password, setPassword] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`${t("resetPassword")} · ${user.username}`} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        onDone((await service.resetPassword(user.id, password)).error?.code ?? null);
      }}>
        <FormField id="p-new" label={t("newPassword")}><Input id="p-new" type="password" value={password} required autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></FormField>
        <Failure code={error} />
        <Button type="submit" variant="primary" disabled={!password}>{t("confirm")}</Button>
      </form>
    </Dialog>
  );
}

function ResetAgentDialog({ service, user, error, onClose, onDone }: DialogProps & { user: AdminUser }) {
  const { t } = useTranslation(["admin", "app"]);
  const agents = useLoad((s) => service.userAgents(user.id, s), [service, user.id]);
  const [agentId, setAgentId] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`${t("resetAgent")} · ${user.username}`}
            description={t("resetAgentBody")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        onDone((await service.resetAgent(agentId)).error?.code ?? null);
      }}>
        <FormField id="a-pick" label={t("pickAgent")}>
          <Select id="a-pick" value={agentId} required onChange={(e) => setAgentId(e.target.value)}>
            <option value="">—</option>
            {agents.data?.filter((a) => a.state === "active").map((a) => <option key={a.id} value={a.id}>{a.avatar.emoji} {a.name} (@{a.slug})</option>)}
          </Select>
        </FormField>
        <Failure code={error} />
        <Button type="submit" variant="danger" disabled={!agentId}>{t("resetAgent")}</Button>
      </form>
    </Dialog>
  );
}
