import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { PageFrame } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { FormField, Input } from "../../../shared/ui/form";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { useLoad } from "../../agents/components/common";
import {
  ADMIN_CONSOLE_KEY, type AdminConsoleService, type DomainDetail, type StarterDetail, type StarterInput,
} from "../services/admin-service";
import "./admin.css";

function Failure({ code }: { code: string | null }) {
  const { t } = useTranslation("admin");
  return code ? <InlineAlert kind="error">{t(`error-${code}`, { defaultValue: t("error-other") })}</InlineAlert> : null;
}

const emptyStarter = (): StarterInput => ({
  slug: "", displayName: "", description: "", avatar: { emoji: "🤖", color: "#64748B" },
  presets: [], credentials: [], prompt: "",
});

type Action =
  | { kind: "createDomain" }
  | { kind: "addSet"; domainId: string }
  | { kind: "fillSet"; domainId: string; name: string; keys: string[] }
  | { kind: "starter"; domainId: string; starter: StarterInput; editing: boolean }
  | { kind: "lead"; domainId: string; prompt: string }
  | null;

/** `/admin/domains` (doc 12 "Domains"): create domains, credential sets and starters — no file
 * edit, no restart; every write re-validates immediately. */
export default function DomainsPage() {
  const { t } = useTranslation(["admin", "app"]);
  const service = useServices().workspace[ADMIN_CONSOLE_KEY] as AdminConsoleService;
  const domains = useLoad((s) => service.listDomainsDetailed(s), [service]);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const close = () => { setAction(null); setError(null); };
  const done = (code: string | null) => {
    setError(code);
    if (!code) { setAction(null); domains.reload(); }
  };

  return (
    <PageFrame title={t("domainsTitle")} width="wide" actions={
      <Button variant="primary" onClick={() => setAction({ kind: "createDomain" })}><Plus size={16} />{t("addDomain")}</Button>
    }>
      {domains.loading && !domains.data ? <Skeleton label={t("app:loading")} /> : null}
      {!action ? <Failure code={domains.error ?? null} /> : null}
      {domains.data?.length === 0 ? <p className="muted">{t("noDomains")}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>{t("domainId")}</th><th>{t("domainName")}</th><th>{t("status")}</th><th>{t("statusReason")}</th><th /></tr>
          </thead>
          <tbody>
            {domains.data?.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td><strong>{d.id}</strong></td>
                  <td>{d.name}</td>
                  <td><span className={`badge ${d.status === "available" ? "badge-success" : "badge-danger"}`}>{d.status}</span></td>
                  <td><small className="muted">{d.statusReason}</small></td>
                  <td><Button onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "−" : "+"}</Button></td>
                </tr>
                {open === d.id ? (
                  <tr key={`${d.id}-detail`}>
                    <td colSpan={5}>
                      <DomainDetailPanel domain={d} service={service} setAction={setAction} onReload={domains.reload} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {action?.kind === "createDomain" ? <CreateDomainDialog service={service} error={error} onClose={close} onDone={done} /> : null}
      {action?.kind === "addSet" ? <AddSetDialog service={service} domainId={action.domainId} error={error} onClose={close} onDone={done} /> : null}
      {action?.kind === "fillSet" ? (
        <FillSetDialog service={service} domainId={action.domainId} name={action.name} keys={action.keys} error={error} onClose={close} onDone={done} />
      ) : null}
      {action?.kind === "starter" ? (
        <StarterDialog service={service} domainId={action.domainId} initial={action.starter} editing={action.editing} error={error} onClose={close} onDone={done} />
      ) : null}
      {action?.kind === "lead" ? (
        <LeadDialog service={service} domainId={action.domainId} initial={action.prompt} error={error} onClose={close} onDone={done} />
      ) : null}
    </PageFrame>
  );
}

function DomainDetailPanel({
  domain, service, setAction, onReload,
}: {
  domain: DomainDetail; service: AdminConsoleService; setAction(a: Action): void; onReload(): void;
}) {
  const { t } = useTranslation("admin");
  const deleteSet = async (name: string) => {
    const r = await service.deleteCredentialSet(domain.id, name);
    if (!r.error) onReload();
  };
  const deleteStarter = async (slug: string) => {
    const r = await service.deleteStarter(domain.id, slug);
    if (!r.error) onReload();
  };
  const lead = domain.starters.find((s) => s.isLead);
  return (
    <div className="admin-domain-detail">
      <section>
        <div className="row">
          <h4>{t("credentialSets")}</h4>
          <Button onClick={() => setAction({ kind: "addSet", domainId: domain.id })}><Plus size={14} />{t("addCredentialSet")}</Button>
        </div>
        {domain.credentialSets.length === 0 ? <p className="muted">{t("noCredentialSets")}</p> : null}
        {domain.credentialSets.map((s) => (
          <div key={s.name} className="admin-cred-set">
            <strong>{s.name}</strong> <small className="muted">{s.description}</small>
            <ul>
              {s.keys.map((k) => (
                <li key={k.key}>
                  {k.key}: <span className={k.filled ? "badge badge-success" : "badge badge-warning"}>
                    {k.filled ? t("keyFilled") : t("keyMissing")}
                  </span>
                </li>
              ))}
            </ul>
            <Button onClick={() => setAction({ kind: "fillSet", domainId: domain.id, name: s.name, keys: s.keys.map((k) => k.key) })}>
              {t("fillValues")}
            </Button>
            <Button variant="danger" onClick={() => void deleteSet(s.name)}><Trash2 size={14} />{t("deleteCredentialSet")}</Button>
          </div>
        ))}
      </section>
      <section>
        <div className="row">
          <h4>{t("starters")}</h4>
          <Button onClick={() => setAction({ kind: "starter", domainId: domain.id, starter: emptyStarter(), editing: false })}>
            <Plus size={14} />{t("addStarter")}
          </Button>
        </div>
        {domain.starters.filter((s) => !s.isLead).length === 0 ? <p className="muted">{t("noStarters")}</p> : null}
        {domain.starters.filter((s) => !s.isLead).map((s: StarterDetail) => (
          <div key={s.slug} className="admin-starter">
            <span>{s.avatar.emoji} <strong>{s.displayName}</strong> ({s.slug})</span>
            <Button onClick={() => setAction({
              kind: "starter", domainId: domain.id, editing: true,
              starter: {
                slug: s.slug, displayName: s.displayName, description: s.description, avatar: s.avatar,
                presets: s.presets, credentials: s.credentials, prompt: s.prompt,
              },
            })}>{t("editStarter")}</Button>
            <Button variant="danger" onClick={() => void deleteStarter(s.slug)}><Trash2 size={14} />{t("deleteStarter")}</Button>
          </div>
        ))}
      </section>
      <section>
        <div className="row">
          <h4>{t("leadPrompt")}</h4>
          <Button onClick={() => setAction({ kind: "lead", domainId: domain.id, prompt: lead?.prompt ?? "" })}>
            {t("saveLead")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function CreateDomainDialog({
  service, error, onClose, onDone,
}: { service: AdminConsoleService; error: string | null; onClose(): void; onDone(code: string | null): void }) {
  const { t } = useTranslation(["admin", "app"]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("addDomain")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        onDone((await service.createDomain({ id: id.trim(), name: name.trim() })).error?.code ?? null);
      }}>
        <FormField id="d-id" label={t("domainId")}>
          <Input id="d-id" value={id} required pattern="[a-z0-9][a-z0-9-]{1,63}" onChange={(e) => setId(e.target.value)} />
        </FormField>
        <FormField id="d-name" label={t("domainName")}>
          <Input id="d-name" value={name} required onChange={(e) => setName(e.target.value)} />
        </FormField>
        <Failure code={error} />
        <Button type="submit" variant="primary" disabled={!id.trim() || !name.trim()}>{t("addDomain")}</Button>
      </form>
    </Dialog>
  );
}

function AddSetDialog({
  service, domainId, error, onClose, onDone,
}: { service: AdminConsoleService; domainId: string; error: string | null; onClose(): void; onDone(code: string | null): void }) {
  const { t } = useTranslation(["admin", "app"]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [keys, setKeys] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("addCredentialSet")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        const keyNames = keys.split("\n").map((k) => k.trim()).filter(Boolean);
        onDone((await service.createCredentialSet(domainId, { name: name.trim(), description, keys: keyNames })).error?.code ?? null);
      }}>
        <FormField id="s-name" label={t("setName")}>
          <Input id="s-name" value={name} required pattern="[a-z0-9][a-z0-9-]{1,63}" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id="s-desc" label={t("setDescription")}>
          <Input id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField id="s-keys" label={t("setKeys")}>
          <textarea id="s-keys" className="input" rows={4} value={keys} required onChange={(e) => setKeys(e.target.value)} />
        </FormField>
        <Failure code={error} />
        <Button type="submit" variant="primary" disabled={!name.trim() || !keys.trim()}>{t("addCredentialSet")}</Button>
      </form>
    </Dialog>
  );
}

function FillSetDialog({
  service, domainId, name, keys, error, onClose, onDone,
}: {
  service: AdminConsoleService; domainId: string; name: string; keys: string[];
  error: string | null; onClose(): void; onDone(code: string | null): void;
}) {
  const { t } = useTranslation(["admin", "app"]);
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`${t("fillValues")} — ${name}`} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        onDone((await service.setCredentialValues(domainId, name, values)).error?.code ?? null);
      }}>
        {keys.map((k) => (
          <FormField id={`v-${k}`} label={k} key={k}>
            <Input id={`v-${k}`} type="password" autoComplete="off"
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </FormField>
        ))}
        <Failure code={error} />
        <Button type="submit" variant="primary">{t("saveValues")}</Button>
      </form>
    </Dialog>
  );
}

function StarterDialog({
  service, domainId, initial, editing, error, onClose, onDone,
}: {
  service: AdminConsoleService; domainId: string; initial: StarterInput; editing: boolean;
  error: string | null; onClose(): void; onDone(code: string | null): void;
}) {
  const { t } = useTranslation(["admin", "app"]);
  const [form, setForm] = useState(initial);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={editing ? t("editStarter") : t("addStarter")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        const r = editing
          ? await service.updateStarter(domainId, form.slug, form)
          : await service.createStarter(domainId, form);
        onDone(r.error?.code ?? null);
      }}>
        <FormField id="st-slug" label={t("slug")}>
          <Input id="st-slug" value={form.slug} required disabled={editing} pattern="[a-z0-9][a-z0-9-]{1,31}"
            onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </FormField>
        <FormField id="st-name" label={t("displayName")}>
          <Input id="st-name" value={form.displayName} required onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </FormField>
        <FormField id="st-desc" label={t("description")}>
          <Input id="st-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </FormField>
        <FormField id="st-avatar" label={t("avatar")}>
          <Input id="st-avatar" value={form.avatar.emoji} maxLength={4}
            onChange={(e) => setForm({ ...form, avatar: { ...form.avatar, emoji: e.target.value } })} />
          <Input type="color" value={form.avatar.color}
            onChange={(e) => setForm({ ...form, avatar: { ...form.avatar, color: e.target.value } })} />
        </FormField>
        <FormField id="st-presets" label={`${t("presets")} (comma-separated)`}>
          <Input id="st-presets" value={form.presets.join(",")}
            onChange={(e) => setForm({ ...form, presets: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })} />
        </FormField>
        <FormField id="st-creds" label={`${t("credentials")} (comma-separated)`}>
          <Input id="st-creds" value={form.credentials.join(",")}
            onChange={(e) => setForm({ ...form, credentials: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} />
        </FormField>
        <FormField id="st-prompt" label={t("prompt")}>
          <textarea id="st-prompt" className="input" rows={8} value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        </FormField>
        <Failure code={error} />
        <Button type="submit" variant="primary" disabled={!form.slug.trim() || !form.displayName.trim()}>
          {editing ? t("editStarter") : t("addStarter")}
        </Button>
      </form>
    </Dialog>
  );
}

function LeadDialog({
  service, domainId, initial, error, onClose, onDone,
}: { service: AdminConsoleService; domainId: string; initial: string; error: string | null; onClose(): void; onDone(code: string | null): void }) {
  const { t } = useTranslation(["admin", "app"]);
  const [prompt, setPrompt] = useState(initial);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("leadPrompt")} closeLabel={t("app:close")}>
      <form className="admin-form" onSubmit={async (e) => {
        e.preventDefault();
        onDone((await service.setLeadPrompt(domainId, prompt)).error?.code ?? null);
      }}>
        <FormField id="lead-prompt" label={t("prompt")}>
          <textarea id="lead-prompt" className="input" rows={10} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </FormField>
        <Failure code={error} />
        <Button type="submit" variant="primary">{t("saveLead")}</Button>
      </form>
    </Dialog>
  );
}
