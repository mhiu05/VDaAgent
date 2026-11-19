import type {
  AdminConsoleService, AdminUser, DomainDetail, DomainStatus, OverviewAgent, StarterInput, TraceEvent,
} from "../../features/admin/services/admin-service";
import { builderAgent, run, type AgentDto } from "./agent-builder";
import { chatMappers, type MessageDto, type ThreadDto } from "./agent-chat";
import type { ApiClient } from "./http";
import type { EventSourceFactory } from "./realtime";

/** `/api/admin/*` (docs 12, 13, 15 "Admin API"). The trace stream is one EventSource per watched
 * agent, separate from the user stream. */
type DomainDto = { id: string; name: string; status: string; status_reason?: string | null };
type ProgressDto = { job_status: "queued" | "running" | null; step: string | null; agent: string | null;
  done: number; total: number };
type UserDto = { id: string; username: string; display_name: string; domain: DomainDto | null;
  status: AdminUser["status"]; status_detail: string | null; created_at: string; provisioning?: ProgressDto | null };
type EventDto = { seq: number; epoch: number; kind: TraceEvent["kind"]; payload: Record<string, unknown>;
  trace_id: string | null; activation_kind: string | null; task_id: number | null; created_at: string };

const domain = (d: DomainDto): DomainStatus => ({ id: d.id, name: d.name, status: d.status, statusReason: d.status_reason ?? null });
const user = (u: UserDto): AdminUser => ({ id: u.id, username: u.username, displayName: u.display_name,
  domain: u.domain ? domain(u.domain) : null, status: u.status, statusDetail: u.status_detail, createdAt: u.created_at,
  provisioning: u.provisioning ? { jobStatus: u.provisioning.job_status, step: u.provisioning.step,
    agent: u.provisioning.agent, done: u.provisioning.done, total: u.provisioning.total } : null });

type SetDto = { name: string; description: string; keys: { key: string; filled: boolean }[] };
type StarterDto = {
  slug: string; display_name: string; description: string; avatar: { emoji: string; color: string };
  presets: string[]; credentials: string[]; prompt: string; is_lead: boolean;
};
type DomainDetailDto = DomainDto & { credential_sets: SetDto[]; starters: StarterDto[] };

const domainDetail = (d: DomainDetailDto): DomainDetail => ({
  ...domain(d),
  credentialSets: d.credential_sets.map((s) => ({ name: s.name, description: s.description, keys: s.keys })),
  starters: d.starters.map((s) => ({
    slug: s.slug, displayName: s.display_name, description: s.description, avatar: s.avatar,
    presets: s.presets, credentials: s.credentials, prompt: s.prompt, isLead: s.is_lead,
  })),
});
const starterBody = (s: StarterInput) => ({
  slug: s.slug, display_name: s.displayName, description: s.description, avatar: s.avatar,
  presets: s.presets, credentials: s.credentials, prompt: s.prompt,
});

export function createApiAdminConsole(client: ApiClient, eventSource: EventSourceFactory, base: string): AdminConsoleService {
  const { message, thread } = chatMappers(base);
  const users = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;
  const agents = (id: string) => `/api/admin/agents/${encodeURIComponent(id)}`;
  const domains = (id: string) => `/api/admin/domains/${encodeURIComponent(id)}`;
  return {
    config: (signal) => run(async () => {
      const c = await client.get<{ langfuse_url: string; langfuse_project_id: string }>("/api/admin/config", undefined, signal);
      return { langfuseUrl: c.langfuse_url, projectId: c.langfuse_project_id };
    }, signal),
    overview: (signal) => run(async () => {
      const o = await client.get<{ domains: DomainDto[]; agents: (AgentDto & { user: { id: string; username: string };
        domain: string | null; current_task: { id: number; description: string } | null; queue_len: number | null;
        pending: number; cost_today: number; last_error_at: string | null; compaction_failed: boolean;
        compaction_pending: boolean })[] }>("/api/admin/overview", undefined, signal);
      return {
        domains: o.domains.map(domain),
        agents: o.agents.map((a): OverviewAgent => ({ ...builderAgent(a), user: a.user, domain: a.domain,
          currentTask: a.current_task, queueLen: a.queue_len, pending: a.pending, costToday: a.cost_today,
          lastErrorAt: a.last_error_at, compactionFailed: a.compaction_failed, compactionPending: a.compaction_pending })),
      };
    }, signal),
    users: (signal) => run(async () => (await client.get<UserDto[]>("/api/admin/users", undefined, signal)).map(user), signal),
    createUser: (u) => run(async () => user((await client.post<{ user: UserDto }>("/api/admin/users", {
      username: u.username, password: u.password, domain_id: u.domainId, display_name: u.displayName })).user)),
    retryProvisioning: (id) => run(async () => (await client.post<{ job_id: string }>(`${users(id)}/retry`)).job_id),
    setDisabled: (id, disabled) => run(async () => user(await client.patch<UserDto>(users(id), { disabled }))),
    resetPassword: (id, password) => run(async () => user(await client.patch<UserDto>(users(id), { password }))),
    resetAgent: (id) => run(async () => (await client.post<{ job_id: string }>(`${agents(id)}/reset`)).job_id),
    userAgents: (id, signal) => run(async () => (await client.get<(AgentDto & { state: string })[]>(`${users(id)}/agents`, undefined, signal))
      .map((a) => ({ ...builderAgent(a), state: a.state })), signal),
    userThreads: (id, signal) => run(async () => (await client.get<ThreadDto[]>(`${users(id)}/threads`, undefined, signal)).map(thread), signal),
    trace: (id, afterSeq, signal) => run(async () => {
      const r = await client.get<{ agent: AgentDto; events: EventDto[]; epochs: { epoch: number; start_seq: number; reason: string;
        summary: string | null; system_prompt: string; created_at: string }[]; jev: { id: number; message_id: number;
        label: "task" | "side_question"; fallback: boolean; observed: "task" | "side_question" | null }[] }>(
        `${agents(id)}/events`, { after_seq: afterSeq ?? 0, limit: 200 }, signal);
      return {
        agent: builderAgent(r.agent),
        events: r.events.map((e) => ({ seq: e.seq, epoch: e.epoch, kind: e.kind, payload: e.payload, traceId: e.trace_id,
          activationKind: e.activation_kind, taskId: e.task_id, createdAt: e.created_at })),
        epochs: r.epochs.map((e) => ({ epoch: e.epoch, startSeq: e.start_seq, reason: e.reason, summary: e.summary,
          systemPrompt: e.system_prompt, createdAt: e.created_at })),
        jev: r.jev.map((j) => ({ id: j.id, messageId: j.message_id, label: j.label,
          fallback: j.fallback, observed: j.observed })),
      };
    }, signal),
    watch(id, listener) {
      const source = eventSource(`${base}${agents(id)}/stream`);
      const parse = (e: MessageEvent) => { try { return JSON.parse(e.data); } catch { return null; } };
      source.addEventListener("event.appended", (e) => {
        const d = parse(e);
        if (d) listener({ type: "appended", seq: d.seq });
      });
      source.addEventListener("agent.status", (e) => {
        const d = parse(e);
        if (d) listener({ type: "status", status: d.status, statusDetail: d.status_detail });
      });
      return () => source.close();
    },
    compact: (id) => run(async () => { await client.post(`${agents(id)}/compact`); return null; }),
    thread: (id, signal) => run(async () => {
      const r = await client.get<{ thread: ThreadDto; messages: (MessageDto & { trace_id: string | null })[] }>(
        `/api/admin/threads/${encodeURIComponent(id)}`, undefined, signal);
      return { thread: thread(r.thread), messages: r.messages.map((m) => ({ ...message(m), traceId: m.trace_id })) };
    }, signal),
    markJev: (messageId, label) => run(async () => { await client.post(`/api/admin/jev/${messageId}/observed`, { label }); return null; }),
    listDomainsDetailed: (signal) => run(async () =>
      (await client.get<DomainDetailDto[]>("/api/admin/domains", undefined, signal)).map(domainDetail), signal),
    createDomain: (d) => run(async () => domain(await client.post<DomainDto>("/api/admin/domains", d))),
    renameDomain: (id, name) => run(async () => domain(await client.patch<DomainDto>(domains(id), { name }))),
    createCredentialSet: (id, set) => run(async () =>
      domain(await client.post<DomainDto>(`${domains(id)}/credential-sets`, set))),
    setCredentialValues: (id, name, values) => run(async () =>
      domain(await client.put<DomainDto>(`${domains(id)}/credential-sets/${encodeURIComponent(name)}/values`, { values }))),
    deleteCredentialSet: (id, name) => run(async () => {
      await client.delete(`${domains(id)}/credential-sets/${encodeURIComponent(name)}`);
      return null;
    }),
    createStarter: (id, s) => run(async () => domain(await client.post<DomainDto>(`${domains(id)}/starters`, starterBody(s)))),
    updateStarter: (id, slug, s) => run(async () =>
      domain(await client.patch<DomainDto>(`${domains(id)}/starters/${encodeURIComponent(slug)}`, starterBody(s)))),
    deleteStarter: (id, slug) => run(async () => {
      await client.delete(`${domains(id)}/starters/${encodeURIComponent(slug)}`);
      return null;
    }),
    setLeadPrompt: (id, prompt) => run(async () => domain(await client.put<DomainDto>(`${domains(id)}/lead`, { prompt }))),
  };
}
