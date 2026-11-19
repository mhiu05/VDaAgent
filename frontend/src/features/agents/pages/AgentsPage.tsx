import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { PageFrame, PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { FormField, Input, Select } from "../../../shared/ui/form";
import { Skeleton } from "../../../shared/ui/feedback";
import { AgentFace } from "../../chat/components/AgentChatList";
import type { AgentBuilderService, BuilderAgent } from "../services/builder-service";
import { ErrorText, JobToasts, useBuilder, useLoad, useStatusText, useTrackJob } from "../components/common";
import { DataTab, InfoTab, LibrariesTab, RoleTab, RoutinesTab, SkillsTab } from "../components/BuilderTabs";
import { FolderViewer } from "../components/FolderViewer";
import "./agents.css";

export const TABS = ["info", "role", "skills", "libraries", "routines", "data", "folder"] as const;
type Tab = (typeof TABS)[number];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** `/agents`, `/agents/new` and `/agents/:id/:tab` (docs 05, 14 "Builder screens"). */
export default function AgentsPage() {
  const { t } = useTranslation("agents");
  const service = useBuilder();
  const location = useLocation();
  const { id, tab } = useParams();
  if (!service) return <PageFrame title={t("title")}><PageState kind="empty" title={t("unavailable")} /></PageFrame>;
  return (
    <JobToasts service={service}>
      {location.pathname === "/agents/new" ? <CreateAgent service={service} />
        : id ? <Builder service={service} id={id} tab={(TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "info"} />
          : <AgentList service={service} />}
    </JobToasts>
  );
}

function AgentRow({ agent }: { agent: BuilderAgent }) {
  const { t } = useTranslation("agents");
  const status = useStatusText();
  return (
    <Link to={`/agents/${agent.id}/info`} className="agent-tile">
      <AgentFace name={agent.name} identity={agent.id} avatar={agent.avatar} size={44} status={agent.status} />
      <span>
        <strong>{agent.name}</strong> {agent.isLead ? <span className="badge">{t("lead")}</span> : null}
        <small className="muted">@{agent.slug} · {status(agent.status, agent.statusDetail)}</small>
        <span className="muted">{agent.description}</span>
      </span>
    </Link>
  );
}

function AgentList({ service }: { service: AgentBuilderService }) {
  const { t } = useTranslation(["agents", "app"]);
  const agents = useLoad((s) => service.agents(s), [service]);
  return (
    <PageFrame title={t("title")} actions={<Link className="button button-primary" to="/agents/new"><Plus size={16} />{t("create")}</Link>}>
      {agents.loading && !agents.data ? <Skeleton label={t("app:loading")} /> : null}
      <ErrorText code={agents.error} />
      <div className="agent-tiles">{agents.data?.map((a) => <AgentRow key={a.id} agent={a} />)}</div>
    </PageFrame>
  );
}

function CreateAgent({ service }: { service: AgentBuilderService }) {
  const { t } = useTranslation(["agents", "app"]);
  const navigate = useNavigate();
  const track = useTrackJob();
  const starters = useLoad((s) => service.starters(s), [service]);
  const presets = useLoad((s) => service.presets(s), [service]);
  const sets = useLoad((s) => service.credentialSets(s), [service]);
  const [mode, setMode] = useState<"starter" | "blank">("starter");
  const [starter, setStarter] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [color, setColor] = useState("#64748B");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pickStarter = (value: string) => {
    setStarter(value);
    const s = starters.data?.find((x) => x.slug === value);
    if (!s) return;
    setName((n) => n || s.name);
    setEmoji(s.avatar.emoji);
    setColor(s.avatar.color);
    setDescription((d) => d || s.description);
  };
  const toggle = (list: string[], set: (v: string[]) => void, value: string, on: boolean) =>
    set(on ? [...list, value] : list.filter((x) => x !== value));
  const valid = SLUG_RE.test(slug) && name.trim() && emoji && (mode === "blank" || starter);
  return (
    <PageFrame title={t("create")}>
      <form className="builder-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setPending(true);
        const r = await service.create({
          slug, name: name.trim(), avatar: { emoji, color }, description,
          ...(mode === "starter" ? { starter, presets: [], credentials: [] } : { presets: picked, credentials }),
        });
        setPending(false);
        setError(r.error?.code ?? null);
        if (r.data) track(r.data, "agent_create", async (job) => {
          if (job.status !== "done") return;
          // the event may predate the job row learning its agent id
          const agentId = job.agentId ?? (await service.job(job.id)).data?.agentId;
          navigate(agentId ? `/agents/${agentId}/info` : "/agents");
        });
      }}>
        <FormField id="c-slug" label={t("slug")} description={t("slugHint")}>
          <Input id="c-slug" value={slug} maxLength={32} required onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </FormField>
        <div className="row">
          <label><input type="radio" name="mode" checked={mode === "starter"} onChange={() => setMode("starter")} /> {t("fromStarter")}</label>
          <label><input type="radio" name="mode" checked={mode === "blank"} onChange={() => setMode("blank")} /> {t("blank")}</label>
        </div>
        {mode === "starter" ? (
          <FormField id="c-starter" label={t("starter")}>
            <Select id="c-starter" value={starter} onChange={(e) => pickStarter(e.target.value)}>
              <option value="">—</option>
              {starters.data?.map((s) => <option key={s.slug} value={s.slug}>{s.avatar.emoji} {s.name} — {s.description}</option>)}
            </Select>
          </FormField>
        ) : (
          <>
            <fieldset className="builder-checks">
              <legend>{t("presets")}</legend>
              {presets.data?.map((p) => (
                <label key={p.id}><input type="checkbox" checked={picked.includes(p.id)}
                                         onChange={(e) => toggle(picked, setPicked, p.id, e.target.checked)} /> {p.title}</label>
              ))}
            </fieldset>
            <fieldset className="builder-checks">
              <legend>{t("credentials")}</legend>
              {sets.data?.map((s) => (
                <label key={s.set}><input type="checkbox" checked={credentials.includes(s.set)}
                                          onChange={(e) => toggle(credentials, setCredentials, s.set, e.target.checked)} /> {s.set}</label>
              ))}
            </fieldset>
          </>
        )}
        <FormField id="c-name" label={t("name")}>
          <Input id="c-name" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
        </FormField>
        <div className="row">
          <FormField id="c-emoji" label={t("emoji")}>
            <Input id="c-emoji" value={emoji} maxLength={16} required onChange={(e) => setEmoji(e.target.value)} />
          </FormField>
          <FormField id="c-color" label={t("color")}>
            <input id="c-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </FormField>
        </div>
        <FormField id="c-description" label={t("description")}>
          <textarea id="c-description" className="input" rows={3} maxLength={500} value={description}
                    onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <ErrorText code={error} />
        <Button type="submit" variant="primary" pending={pending} disabled={!valid}>{t("createSubmit")}</Button>
      </form>
    </PageFrame>
  );
}

function Builder({ service, id, tab }: { service: AgentBuilderService; id: string; tab: Tab }) {
  const { t } = useTranslation(["agents", "app"]);
  const agents = useLoad((s) => service.agents(s), [service]);
  const agent = agents.data?.find((a) => a.id === id);
  const status = useStatusText();
  if (agents.loading && !agents.data) return <PageFrame title={t("title")}><Skeleton label={t("app:loading")} /></PageFrame>;
  if (agents.error || !agent)
    return <PageFrame title={t("title")}><PageState kind="error" title={t("loadError")} /></PageFrame>;
  const props = { service, agent, onChanged: agents.reload };
  return (
    <div className="builder-layout">
      <nav className="builder-agents" aria-label={t("title")}>
        <ul>
          {agents.data?.map((a) => (
            <li key={a.id}>
              <NavLink to={`/agents/${a.id}/${tab}`} className={a.id === id ? "selected" : ""}>
                <AgentFace name={a.name} identity={a.id} avatar={a.avatar} size={30} status={a.status} />
                <span><strong>{a.name}</strong><small className="muted">{status(a.status, a.statusDetail)}</small></span>
              </NavLink>
            </li>
          ))}
        </ul>
        <Link className="button button-secondary" to="/agents/new"><Plus size={14} />{t("create")}</Link>
      </nav>
      <section className="builder-main">
        <header className="builder-header">
          <AgentFace name={agent.name} identity={agent.id} avatar={agent.avatar} size={40} status={agent.status} />
          <h1 tabIndex={-1}>{agent.name}</h1>
          {agent.isLead ? <span className="badge">{t("lead")}</span> : null}
          <Link className="button button-secondary" to={`/chat?agent=${encodeURIComponent(agent.id)}`}>{t("chat")}</Link>
        </header>
        <nav className="builder-tabs" aria-label={t("tabs")}>
          {TABS.map((x) => (
            <NavLink key={x} to={`/agents/${id}/${x}`} className={x === tab ? "active" : ""} aria-current={x === tab ? "page" : undefined}>
              {t(`tab-${x}`)}
            </NavLink>
          ))}
        </nav>
        <div className="builder-body" key={`${id}-${tab}`}>
          {tab === "info" ? <InfoTab {...props} />
            : tab === "role" ? <RoleTab {...props} />
              : tab === "skills" ? <SkillsTab {...props} />
                : tab === "libraries" ? <LibrariesTab {...props} />
                  : tab === "routines" ? <RoutinesTab {...props} />
                    : tab === "data" ? <DataTab {...props} />
                      : <FolderViewer service={service} agentId={agent.id} />}
        </div>
      </section>
    </div>
  );
}
