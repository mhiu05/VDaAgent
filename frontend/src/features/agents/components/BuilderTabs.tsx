import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { FormField, Input, Select, Switch } from "../../../shared/ui/form";
import { Skeleton } from "../../../shared/ui/feedback";
import { formatDate } from "../../../shared/lib/format";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { MarkdownContent } from "../../chat/components/MarkdownContent";
import { AgentFace } from "../../chat/components/AgentChatList";
import type { AgentBuilderService, BuilderAgent, CatalogSkill, Routine } from "../services/builder-service";
import { describeCron, parseSchedule, toCron, validRoutineName, weekdayNames, type Schedule } from "../model/schedule";
import { ErrorText, useLoad, useTrackJob } from "./common";

type TabProps = { service: AgentBuilderService; agent: BuilderAgent; onChanged(): void };

function Confirm({ open, title, body, onCancel, onConfirm }: {
  open: boolean; title: string; body: string; onCancel(): void; onConfirm(): Promise<void>;
}) {
  const { t } = useTranslation(["agents", "app"]);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }} title={title} description={body} closeLabel={t("app:close")}>
      <div className="row builder-actions">
        <Button onClick={onCancel}>{t("cancel")}</Button>
        <Button variant="danger" pending={pending} onClick={async () => {
          setPending(true);
          await onConfirm();
          setPending(false);
        }}>{t("confirm")}</Button>
      </div>
    </Dialog>
  );
}

export function InfoTab({ service, agent, onChanged }: TabProps) {
  const { t } = useTranslation("agents");
  const navigate = useNavigate();
  const track = useTrackJob();
  const [name, setName] = useState(agent.name);
  const emoji = agent.avatar.emoji;
  const [color, setColor] = useState(agent.avatar.color);
  const [description, setDescription] = useState(agent.description);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  return (
    <form className="builder-form" onSubmit={async (e) => {
      e.preventDefault();
      const r = await service.updateAgent(agent.id, { name: name.trim(), avatar: { emoji, color }, description });
      setError(r.error?.code ?? null);
      setSaved(!r.error);
      if (!r.error) onChanged();
    }}>
      <FormField id="b-slug" label={t("slug")} description={agent.isLead ? t("leadFixed") : undefined}>
        <Input id="b-slug" value={agent.slug} readOnly />
      </FormField>
      <FormField id="b-name" label={t("name")}>
        <Input id="b-name" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
      </FormField>
      <fieldset className="builder-avatar-preview" style={{ borderColor: color }}>
        <legend>{t("robotIdentity")}</legend>
        <AgentFace name={name || agent.name} identity={agent.id} avatar={{ emoji, color }} size={66} status={agent.status} />
        <div className="builder-avatar-copy">
          <strong>{name || agent.name}</strong>
          <span className="muted">{t("robotIdentityHint")}</span>
        </div>
        <label className="builder-color-control" htmlFor="b-color">
          <span>{t("color")}</span>
          <span>
            <input id="b-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <output htmlFor="b-color">{color.toUpperCase()}</output>
          </span>
        </label>
      </fieldset>
      <FormField id="b-description" label={t("description")}>
        <textarea id="b-description" className="input" rows={3} maxLength={500} value={description}
                  onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      <ErrorText code={error} />
      {saved ? <p role="status" className="muted">{t("saved")}</p> : null}
      <div className="row builder-actions">
        <Button type="submit" variant="primary" disabled={!name.trim() || !emoji}>{t("save")}</Button>
        <Button onClick={() => setConfirm("reset")}>{t("reset")}</Button>
        {!agent.isLead ? <Button variant="danger" onClick={() => setConfirm("delete")}>{t("remove")}</Button> : null}
      </div>
      <Confirm
        open={confirm !== null}
        title={confirm === "delete" ? t("remove") : t("reset")}
        body={confirm === "delete" ? t("removeBody") : t("resetBody")}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === "delete") {
            const r = await service.deleteAgent(agent.id);
            setError(r.error?.code ?? null);
            setConfirm(null);
            if (!r.error) navigate("/agents");
            return;
          }
          const r = await service.reset(agent.id);
          setError(r.error?.code ?? null);
          setConfirm(null);
          if (r.data) track(r.data, "agent_reset", onChanged);
        }}
      />
    </form>
  );
}

export function RoleTab({ service, agent }: TabProps) {
  const { t } = useTranslation(["agents", "app"]);
  const prompt = useLoad((s) => service.prompt(agent.id, s), [service, agent.id]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  if (prompt.loading && !prompt.data) return <Skeleton label={t("app:loading")} />;
  if (prompt.error) return <ErrorText code={prompt.error} />;
  const value = text ?? prompt.data?.text ?? "";
  return (
    <form className="builder-form" onSubmit={async (e) => {
      e.preventDefault();
      setPending(true);
      const r = await service.savePrompt(agent.id, value);
      setPending(false);
      setError(r.error?.code ?? null);
      setSaved(!r.error);
    }}>
      {agent.isLead ? <p className="muted">{t("leadRules")}</p> : null}
      <FormField id="b-role" label={t("tab-role")} description={t("roleHint")}>
        <textarea id="b-role" className="input builder-role" rows={18} maxLength={100000} value={value}
                  onChange={(e) => { setText(e.target.value); setSaved(false); }} />
      </FormField>
      {value.length > 8000 ? <p className="warning" role="alert">{t("roleLong")}</p> : null}
      <ErrorText code={error} />
      {saved ? <p role="status" className="muted">{t("saved")}</p> : null}
      <Button type="submit" variant="primary" pending={pending} disabled={text === null}>{t("save")}</Button>
    </form>
  );
}

function SkillPreviewDialog({ service, skill, installed, onClose, onInstall }: {
  service: AgentBuilderService; skill: CatalogSkill; installed: boolean; onClose(): void; onInstall(): void;
}) {
  const { t } = useTranslation(["agents", "app"]);
  const preview = useLoad((s) => service.skillPreview(skill.id, s), [service, skill.id]);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={skill.title || skill.name}
            description={skill.description} closeLabel={t("app:close")} className="builder-preview">
      {preview.loading ? <Skeleton label={t("app:loading")} /> : null}
      <ErrorText code={preview.error} />
      {preview.data ? (
        <>
          {preview.data.hasCode ? <p className="warning" role="alert">{t("hasCode")}</p> : null}
          <div className="builder-skill-md"><MarkdownContent body={preview.data.skillMd} /></div>
          <h4>{t("files")}</h4>
          <ul className="builder-files">{preview.data.files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </>
      ) : null}
      <Button variant="primary" disabled={installed} onClick={onInstall}>{installed ? t("installed") : t("install")}</Button>
    </Dialog>
  );
}

export function SkillsTab({ service, agent }: TabProps) {
  const { t } = useTranslation(["agents", "app"]);
  const track = useTrackJob();
  const installed = useLoad((s) => service.skills(agent.id, s), [service, agent.id]);
  const catalog = useLoad((s) => service.catalogSkills(s), [service]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState<CatalogSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tags = useMemo(() => [...new Set((catalog.data ?? []).flatMap((s) => s.tags))].sort(), [catalog.data]);
  const names = new Set((installed.data ?? []).map((s) => s.name));
  const shown = (catalog.data ?? []).filter((s) => (!tag || s.tags.includes(tag))
    && (!query.trim() || `${s.title} ${s.name} ${s.description}`.toLowerCase().includes(query.trim().toLowerCase())));
  const job = async (p: ReturnType<AgentBuilderService["installSkill"]>, kind: string) => {
    const r = await p;
    setError(r.error?.code ?? null);
    if (r.data) track(r.data, kind, installed.reload);
    return !r.error;
  };
  return (
    <div className="builder-section">
      <h3>{t("catalog")}</h3>
      <div className="row builder-filters">
        <Input aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label={t("allTags")} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">{t("allTags")}</option>
          {tags.map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
      </div>
      {catalog.loading && !catalog.data ? <Skeleton label={t("app:loading")} /> : null}
      <ErrorText code={catalog.error} />
      <div className="builder-grid">
        {shown.map((s) => (
          <button key={s.id} type="button" className="builder-card" onClick={() => setOpen(s)}>
            <strong>{s.title || s.name}</strong>
            {names.has(s.name) ? <span className="badge">{t("installed")}</span> : null}
            <span className="muted">{s.description}</span>
            <span className="builder-tags">{s.tags.map((x) => <span key={x} className="badge">{x}</span>)}</span>
          </button>
        ))}
      </div>
      <form className="row builder-inline" onSubmit={async (e) => {
        e.preventDefault();
        if (await job(service.installSkill(agent.id, { url: url.trim() }), "skill_install")) setUrl("");
      }}>
        <FormField id="b-github" label={t("fromGithub")}>
          <Input id="b-github" type="url" placeholder="https://github.com/owner/repo/tree/main/skills/name"
                 value={url} onChange={(e) => setUrl(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={!url.trim()}>{t("install")}</Button>
      </form>
      <ErrorText code={error} />
      <h3>{t("currentSkills")}</h3>
      {installed.data?.length === 0 ? <p className="muted">{t("noSkills")}</p> : null}
      <ul className="builder-list">
        {installed.data?.map((s) => (
          <li key={s.name}>
            <div><strong>{s.name}</strong><span className="muted">{s.description}</span>
              {s.author ? <small className="muted">{s.author}</small> : null}</div>
            <Button onClick={() => void job(service.removeSkill(agent.id, s.name), "skill_remove")}>
              <Trash2 size={14} />{t("uninstall")}
            </Button>
          </li>
        ))}
      </ul>
      {open ? (
        <SkillPreviewDialog service={service} skill={open} installed={names.has(open.name)} onClose={() => setOpen(null)}
                            onInstall={async () => {
                              if (await job(service.installSkill(agent.id, { catalogId: open.id }), "skill_install")) setOpen(null);
                            }} />
      ) : null}
    </div>
  );
}

export function LibrariesTab({ service, agent }: TabProps) {
  const { t } = useTranslation(["agents", "app"]);
  const track = useTrackJob();
  const presets = useLoad((s) => service.presets(s), [service]);
  const packages = useLoad((s) => service.packages(agent.id, s), [service, agent.id]);
  const [spec, setSpec] = useState("");
  const [error, setError] = useState<string | null>(null);
  const job = async (p: ReturnType<AgentBuilderService["addPackages"]>, kind: string) => {
    const r = await p;
    setError(r.error?.code ?? null);
    if (r.data) track(r.data, kind, packages.reload);
    return !r.error;
  };
  return (
    <div className="builder-section">
      <h3>{t("presets")}</h3>
      <ErrorText code={presets.error} />
      <div className="builder-grid">
        {presets.data?.map((p) => (
          <div key={p.id} className="builder-card">
            <strong>{p.title}</strong>
            <span className="muted">{p.description}</span>
            <code className="builder-packages">{p.packages.join(", ")}</code>
            <Button onClick={() => void job(service.addPackages(agent.id, { presetId: p.id }), "preset_apply")}>{t("apply")}</Button>
          </div>
        ))}
      </div>
      <h3>{t("packagesInstalled")}</h3>
      {packages.loading && !packages.data ? <Skeleton label={t("app:loading")} /> : null}
      {packages.data?.length === 0 ? <p className="muted">{t("noPackages")}</p> : null}
      {packages.data?.length ? (
        <table className="builder-table">
          <tbody>
            {packages.data.map((p) => (
              <tr key={p.name}>
                <td><strong>{p.name}</strong></td>
                <td><code>{p.spec}</code></td>
                <td><Button onClick={() => void job(service.removePackage(agent.id, p.name), "package_remove")}>
                  <Trash2 size={14} />{t("uninstall")}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <form className="row builder-inline" onSubmit={async (e) => {
        e.preventDefault();
        if (await job(service.addPackages(agent.id, { spec: spec.trim() }), "package_add")) setSpec("");
      }}>
        <FormField id="b-package" label={t("addPackage")}>
          <Input id="b-package" placeholder={t("packageSpec")} maxLength={300} value={spec} onChange={(e) => setSpec(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={!spec.trim()}><Plus size={14} />{t("addPackage")}</Button>
      </form>
      <ErrorText code={error} />
    </div>
  );
}

function RoutineDialog({ initial, onClose, onSave }: {
  initial: Routine | null; onClose(): void;
  onSave(name: string, routine: { prompt: string; cron: string; enabled: boolean }): Promise<string | null>;
}) {
  const { t } = useTranslation(["agents", "app"]);
  const { preferences } = usePreferences();
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [schedule, setSchedule] = useState<Schedule>(initial ? parseSchedule(initial.cron) : { kind: "daily", time: "08:00" });
  const [error, setError] = useState<string | null>(null);
  const time = "time" in schedule ? schedule.time : "08:00";
  const setKind = (kind: Schedule["kind"]) => setSchedule(
    kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, time, days: [1] }
      : kind === "hourly" ? { kind, hours: 1 } : { kind: "cron", cron: toCron(schedule) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={initial ? initial.name : t("newRoutine")} closeLabel={t("app:close")}>
      <form className="builder-form" onSubmit={async (e) => {
        e.preventDefault();
        const code = await onSave(name, { prompt, cron: toCron(schedule), enabled });
        if (code) setError(code);
      }}>
        {!initial ? (
          <FormField id="r-name" label={t("routineName")}>
            <Input id="r-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </FormField>
        ) : null}
        <FormField id="r-prompt" label={t("prompt")}>
          <textarea id="r-prompt" className="input" rows={5} maxLength={20000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </FormField>
        <FormField id="r-kind" label={t("schedule")} description={t("timezoneNote")}>
          <Select id="r-kind" value={schedule.kind} onChange={(e) => setKind(e.target.value as Schedule["kind"])}>
            <option value="daily">{t("daily")}</option>
            <option value="weekly">{t("weekly")}</option>
            <option value="hourly">{t("hourly")}</option>
            <option value="cron">{t("advanced")}</option>
          </Select>
        </FormField>
        {schedule.kind === "cron" ? (
          <FormField id="r-cron" label="cron">
            <Input id="r-cron" value={schedule.cron} onChange={(e) => setSchedule({ kind: "cron", cron: e.target.value })} />
          </FormField>
        ) : schedule.kind === "hourly" ? (
          <FormField id="r-hours" label={t("hours")}>
            <Input id="r-hours" type="number" min={1} max={23} value={schedule.hours}
                   onChange={(e) => setSchedule({ kind: "hourly", hours: Number(e.target.value) })} />
          </FormField>
        ) : (
          <div className="row">
            <FormField id="r-time" label={t("time")}>
              <Input id="r-time" type="time" value={schedule.time} required
                     onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
            </FormField>
            {schedule.kind === "weekly" ? (
              <fieldset className="field">
                <legend>{t("weekdays")}</legend>
                <div className="row">
                  {weekdayNames(preferences.locale).map((d, i) => (
                    <label key={d} className="check">
                      <input type="checkbox" checked={schedule.days.includes(i)}
                             onChange={(e) => setSchedule({ ...schedule, days: e.target.checked
                               ? [...schedule.days, i] : schedule.days.filter((x) => x !== i) })} />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
        )}
        <p className="muted">{describeCron(toCron(schedule), preferences.locale)}</p>
        <Switch label={t("enabled")} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <ErrorText code={error} />
        <Button type="submit" variant="primary" disabled={!validRoutineName(name) || !prompt.trim()
          || (schedule.kind === "weekly" && !schedule.days.length)}>{t("save")}</Button>
      </form>
    </Dialog>
  );
}

export function RoutinesTab({ service, agent }: TabProps) {
  const { t } = useTranslation(["agents", "app"]);
  const { preferences } = usePreferences();
  const routines = useLoad((s) => service.routines(agent.id, s), [service, agent.id]);
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string | null | undefined) =>
    iso ? formatDate(iso, preferences.locale, preferences.timezone) : "—";
  return (
    <div className="builder-section">
      <div className="row builder-head">
        <h3>{t("routines")}</h3>
        <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />{t("newRoutine")}</Button>
      </div>
      {routines.loading && !routines.data ? <Skeleton label={t("app:loading")} /> : null}
      <ErrorText code={routines.error ?? error} />
      {routines.data?.length === 0 ? <p className="muted">{t("noRoutines")}</p> : null}
      <ul className="builder-list">
        {routines.data?.map((r) => (
          <li key={r.name}>
            <div>
              <strong>{r.name}</strong>
              <span>{describeCron(r.cron, preferences.locale)}</span>
              {r.error ? <span className="error">{r.error}</span> : (
                <small className="muted">{t("nextFire")}: {when(r.nextFires[0])} · {t("lastRun")}: {when(r.lastStartedAt)}</small>
              )}
            </div>
            <Switch label={t("enabled")} checked={r.enabled} onChange={async (e) => {
              const res = await service.saveRoutine(agent.id, r.name, { prompt: r.prompt, cron: r.cron, enabled: e.target.checked });
              setError(res.error?.code ?? null);
              routines.reload();
            }} />
            <Button onClick={() => setEditing(r)}>{t("edit")}</Button>
            <Button onClick={async () => {
              const res = await service.deleteRoutine(agent.id, r.name);
              setError(res.error?.code ?? null);
              routines.reload();
            }}><Trash2 size={14} />{t("delete")}</Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <RoutineDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={async (name, r) => {
          const res = await service.saveRoutine(agent.id, name, r);
          if (res.error) return res.error.code;
          setEditing(null);
          routines.reload();
          return null;
        }} />
      ) : null}
    </div>
  );
}

export function DataTab({ service, agent }: TabProps) {
  const { t } = useTranslation(["agents", "app"]);
  const sets = useLoad((s) => service.credentialSets(s), [service]);
  const attached = useLoad((s) => service.credentials(agent.id, s), [service, agent.id]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if ((sets.loading && !sets.data) || (attached.loading && !attached.data)) return <Skeleton label={t("app:loading")} />;
  const on = new Set((attached.data ?? []).map((x) => x.set));
  return (
    <div className="builder-section">
      <p className="muted">{t("dataHint")}</p>
      <ErrorText code={sets.error ?? attached.error ?? error} />
      {sets.data?.length === 0 ? <p className="muted">{t("noSets")}</p> : null}
      <ul className="builder-list">
        {sets.data?.map((s) => (
          <li key={s.set}>
            <div>
              <strong>{s.set}</strong>
              {s.description ? <span className="muted">{s.description}</span> : null}
              <code className="builder-packages">{s.keys.join(", ")}</code>
            </div>
            <Switch label={s.set} checked={on.has(s.set)} disabled={pending} onChange={async (e) => {
              const next = e.target.checked ? [...on, s.set] : [...on].filter((x) => x !== s.set);
              setPending(true);
              const r = await service.saveCredentials(agent.id, next);
              setPending(false);
              setError(r.error?.code ?? null);
              attached.reload();
            }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
