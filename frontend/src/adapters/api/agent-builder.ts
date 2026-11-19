import type { ServiceResult } from "../../shared/contracts/service-result";
import { failure } from "../../shared/contracts/service-result";
import type {
  AgentBuilderService, BuilderAgent, BuilderJob, Commit, Routine, TreeEntry,
} from "../../features/agents/services/builder-service";
import { ApiRequestError, withQuery, type ApiClient } from "./http";
import type { Realtime } from "./realtime";
import { call } from "./result";

/** The builder routes, catalogs and folder viewer (docs 05, 04, 15). */
type AgentDto = { id: string; slug: string; display_name: string; avatar: BuilderAgent["avatar"];
  description: string; origin: string; is_lead: boolean; status: BuilderAgent["status"];
  status_detail: string | null; created_at: string };
type RoutineDto = { name: string; prompt: string; cron: string; enabled: boolean; next_fires: string[];
  last_started_at: string | null; last_ended_at: string | null; error: string | null };
type TreeDto = { name: string; type: TreeEntry["type"]; size: number | null; mtime: string | null;
  items: number | null; symlink_target: string | null };

const camel = (code: string) => code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Builder errors carry specific codes (`slug_taken`, `agent_limit`, `job_running`, …); the page
 * shows its own text per code, never the server's message. */
export async function run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<ServiceResult<T>> {
  try {
    return { data: await operation() };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ApiRequestError && error.serverCode
        && ([400, 409, 413, 422].includes(error.status) || error.serverCode === "marketplace_disabled"))
      return failure(camel(error.serverCode), false);
    return call(() => Promise.reject(error));
  }
}

export type { AgentDto };
export const builderAgent = (a: AgentDto): BuilderAgent => ({
    id: a.id, slug: a.slug, name: a.display_name, avatar: a.avatar, description: a.description, origin: a.origin,
    isLead: a.is_lead, status: a.status, statusDetail: a.status_detail, createdAt: a.created_at,
  });

export function createApiAgentBuilder(client: ApiClient, realtime: Realtime, base: string): AgentBuilderService {
  const agent = builderAgent;
  const routine = (r: RoutineDto): Routine => ({
    name: r.name, prompt: r.prompt, cron: r.cron, enabled: r.enabled, nextFires: r.next_fires,
    lastStartedAt: r.last_started_at, lastEndedAt: r.last_ended_at, error: r.error,
  });
  const a = (id: string) => `/api/agents/${encodeURIComponent(id)}`;
  const job = async (p: Promise<{ job_id: string }>) => (await p).job_id;
  const fileUrl = (id: string, path: string, at?: string) => `${base}${withQuery(`${a(id)}/file`, { path, at })}`;

  return {
    agents: (signal) => run(async () => (await client.get<AgentDto[]>("/api/agents", undefined, signal)).map(agent), signal),
    agent: (id, signal) => run(async () => agent(await client.get<AgentDto>(a(id), undefined, signal)), signal),
    updateAgent: (id, patch) => run(async () => agent(await client.patch<AgentDto>(a(id), {
      ...(patch.name !== undefined ? { display_name: patch.name } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    }))),
    deleteAgent: (id) => run(async () => { await client.delete(a(id)); return null; }),
    create: (n) => run(() => job(client.post("/api/agents", {
      slug: n.slug, display_name: n.name, avatar: n.avatar, description: n.description,
      ...(n.starter ? { starter: n.starter } : {}), presets: n.presets, credentials: n.credentials,
    }))),
    reset: (id) => run(() => job(client.post(`${a(id)}/reset`))),
    job: (id, signal) => run(async () => {
      const j = await client.get<{ id: string; kind: string; status: BuilderJob["status"]; output: string;
        agent_id: string | null }>(`/api/jobs/${encodeURIComponent(id)}`, undefined, signal);
      return { id: j.id, agentId: j.agent_id, kind: j.kind, status: j.status, output: j.output };
    }, signal),
    onJob: (listener) => realtime.on("builder.job", (d) => {
      const j = d as { job_id: string; agent_id: string | null; kind: string; status: BuilderJob["status"]; output_tail: string };
      listener({ id: j.job_id, agentId: j.agent_id, kind: j.kind, status: j.status, output: j.output_tail });
    }),

    prompt: (id, signal) => run(() => client.get(`${a(id)}/prompt`, undefined, signal), signal),
    savePrompt: (id, text) => run(() => client.put(`${a(id)}/prompt`, { text })),

    skills: (id, signal) => run(async () => (await client.get<{ name: string; description: string;
      catalog_id: string | null; commit_author: string | null }[]>(`${a(id)}/skills`, undefined, signal))
      .map((s) => ({ name: s.name, description: s.description, catalogId: s.catalog_id ?? null, author: s.commit_author })), signal),
    catalogSkills: (signal) => run(async () => (await client.get<{ id: string; name: string; title_vi: string;
      description_vi: string; tags: string[] }[]>("/api/catalog/skills", undefined, signal))
      .map((s) => ({ id: s.id, name: s.name, title: s.title_vi, description: s.description_vi, tags: s.tags })), signal),
    skillPreview: (skillId, signal) => run(async () => {
      const p = await client.get<{ skill_md: string; files: string[]; has_code: boolean }>(
        `/api/catalog/skills/${encodeURIComponent(skillId)}/preview`, undefined, signal);
      return { skillMd: p.skill_md, files: p.files, hasCode: p.has_code };
    }, signal),
    installSkill: (id, source) => run(() => job(client.post(`${a(id)}/skills`,
      "url" in source ? { url: source.url } : { catalog_id: source.catalogId }))),
    removeSkill: (id, name) => run(() => job(client.delete(`${a(id)}/skills/${encodeURIComponent(name)}`))),

    presets: (signal) => run(async () => (await client.get<{ id: string; title_vi: string; description_vi: string;
      packages: string[] }[]>("/api/catalog/presets", undefined, signal))
      .map((p) => ({ id: p.id, title: p.title_vi, description: p.description_vi, packages: p.packages })), signal),
    packages: (id, signal) => run(() => client.get(`${a(id)}/packages`, undefined, signal), signal),
    addPackages: (id, source) => run(() => job(client.post(`${a(id)}/packages`,
      "presetId" in source ? { preset_id: source.presetId } : { package: source.spec }))),
    removePackage: (id, name) => run(() => job(client.delete(`${a(id)}/packages/${encodeURIComponent(name)}`))),

    routines: (id, signal) => run(async () => (await client.get<RoutineDto[]>(`${a(id)}/routines`, undefined, signal)).map(routine), signal),
    saveRoutine: (id, name, r) => run(async () => routine(await client.put<RoutineDto>(`${a(id)}/routines/${encodeURIComponent(name)}`, r))),
    deleteRoutine: (id, name) => run(async () => { await client.delete(`${a(id)}/routines/${encodeURIComponent(name)}`); return null; }),

    credentialSets: (signal) => run(() => client.get("/api/catalog/credential-sets", undefined, signal), signal),
    credentials: (id, signal) => run(() => client.get(`${a(id)}/credentials`, undefined, signal), signal),
    saveCredentials: (id, sets) => run(() => client.put(`${a(id)}/credentials`, { sets })),
    starters: (signal) => run(async () => (await client.get<{ slug: string; display_name: string;
      avatar: BuilderAgent["avatar"]; description: string; presets: string[]; credentials: string[] }[]>(
      "/api/catalog/starters", undefined, signal)).map((s) => ({ slug: s.slug, name: s.display_name,
      avatar: s.avatar, description: s.description, presets: s.presets, credentials: s.credentials })), signal),

    tree: (id, path, at, signal) => run(async () => (await client.get<TreeDto[]>(`${a(id)}/tree`,
      { path, at }, signal)).map((e) => ({ name: e.name, type: e.type, size: e.size, mtime: e.mtime,
      items: e.items, symlinkTarget: e.symlink_target })), signal),
    file: (id, path, at, signal) => run(async () => {
      const url = fileUrl(id, path, at);
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return { kind: "image" as const, url };
      const { blob, type } = await client.blob(withQuery(`${a(id)}/file`, { path, at }), signal);
      if (type.startsWith("image/")) return { kind: "image" as const, url };
      if (type.startsWith("text/") || type.includes("json"))
        return { kind: "text" as const, text: await blob.text(), mediaType: type };
      return { kind: "binary" as const, url };
    }, signal),
    log: (id, path, signal) => run(async () => (await client.get<{ commit: string; author: string; message: string;
      at: string; exec_id: string | null }[]>(`${a(id)}/log`, { path }, signal))
      .map((c): Commit => ({ commit: c.commit, author: c.author, message: c.message, at: c.at, execId: c.exec_id })), signal),
    diff: (id, commit, signal) => run(async () => (await client.blob(withQuery(`${a(id)}/diff`, { commit }), signal)).blob.text(), signal),
    archiveUrl: (id, path, at) => `${base}${withQuery(`${a(id)}/archive`, { path, at })}`,
  };
}
