// The builder and folder viewer adapter (docs 05, 04 "Folder viewer", 15).
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/adapters/api/http";
import { createApiAgentBuilder } from "../../src/adapters/api/agent-builder";
import { createRealtime, type EventSourceLike } from "../../src/adapters/api/realtime";
import type { BuilderJob } from "../../src/features/agents/services/builder-service";

type Call = { url: string; method: string; body: unknown };

function setup(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });
    const handler = routes[`${method} ${url.split("?")[0]}`];
    return handler ? handler({ url, method, body }) : json({ error: "not_found", message: "x" }, 404);
  }) as unknown as typeof globalThis.fetch;
  const listeners = new Map<string, (e: MessageEvent) => void>();
  const source: EventSourceLike = { addEventListener: (t, l) => listeners.set(t, l), close: vi.fn(), readyState: 1 };
  const builder = createApiAgentBuilder(createApiClient({ fetch }), createRealtime("/api/stream", () => source), "");
  const emit = (type: string, data: unknown) => listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  return { builder, calls, emit };
}

const json = (body: unknown, status = 200, type = "application/json") =>
  new Response(body === null ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { "Content-Type": type },
  });

const AGENT = {
  id: "a1", slug: "data", display_name: "Data", avatar: { emoji: "D", color: "#2563EB" },
  description: "Số liệu", origin: "starter", is_lead: false, status: "idle", status_detail: null,
  created_at: "2026-10-01T00:00:00+00:00",
};

describe("agent builder adapter", () => {
  it("maps agents and patches with snake_case bodies", async () => {
    const { builder, calls } = setup({
      "GET /api/agents": () => json([AGENT]),
      "PATCH /api/agents/a1": () => json({ ...AGENT, display_name: "Dữ liệu" }),
      "DELETE /api/agents/a1": () => json(null, 204),
    });
    expect((await builder.agents()).data![0]).toEqual({
      id: "a1", slug: "data", name: "Data", avatar: { emoji: "D", color: "#2563EB" }, description: "Số liệu",
      origin: "starter", isLead: false, status: "idle", statusDetail: null, createdAt: AGENT.created_at,
    });
    expect((await builder.updateAgent("a1", { name: "Dữ liệu" })).data!.name).toBe("Dữ liệu");
    expect(calls[1].body).toEqual({ display_name: "Dữ liệu" });
    expect((await builder.deleteAgent("a1")).data).toBeNull();
  });

  it("creates agents and runs jobs, passing server codes through", async () => {
    const { builder, calls } = setup({
      "POST /api/agents": (c) => (c.body as { slug: string }).slug === "taken"
        ? json({ error: "slug_taken", message: "x" }, 409) : json({ job_id: "j1" }, 202),
      "GET /api/jobs/j1": () => json({ id: "j1", kind: "agent_create", status: "done", output: "ok",
        agent_id: "a9", created_at: "x", finished_at: "y" }),
      "POST /api/agents/a1/reset": () => json({ job_id: "j2" }, 202),
    });
    const agent = { slug: "chart2", name: "Chart 2", avatar: { emoji: "C", color: "#000" }, description: "",
      starter: "chart", presets: [], credentials: ["warehouse"] };
    expect((await builder.create(agent)).data).toBe("j1");
    expect(calls[0].body).toEqual({ slug: "chart2", display_name: "Chart 2", avatar: agent.avatar,
      description: "", starter: "chart", presets: [], credentials: ["warehouse"] });
    expect((await builder.create({ ...agent, slug: "taken" })).error?.code).toBe("slugTaken");
    expect((await builder.job("j1")).data).toEqual({ id: "j1", agentId: "a9", kind: "agent_create", status: "done", output: "ok" });
    expect((await builder.reset("a1")).data).toBe("j2");
  });

  it("follows builder.job events", () => {
    const { builder, emit } = setup({});
    const jobs: BuilderJob[] = [];
    const stop = builder.onJob((j) => jobs.push(j));
    emit("builder.job", { job_id: "j1", agent_id: "a1", kind: "skill_install", status: "failed", output_tail: "boom" });
    expect(jobs).toEqual([{ id: "j1", agentId: "a1", kind: "skill_install", status: "failed", output: "boom" }]);
    stop();
  });

  it("covers prompt, skills, catalog, packages, routines, credentials and starters", async () => {
    const routine = { name: "sang", prompt: "p", cron: "0 8 * * *", enabled: true, next_fires: ["n1"],
      last_started_at: null, last_ended_at: null, error: null };
    const { builder, calls } = setup({
      "GET /api/agents/a1/prompt": () => json({ text: "role", commit: "abc" }),
      "PUT /api/agents/a1/prompt": (c) => json({ text: (c.body as { text: string }).text, commit: "def" }),
      "GET /api/agents/a1/skills": () => json([{ name: "xlsx", description: "d", catalog_id: "c1", commit_author: "user:alice" }]),
      "GET /api/catalog/skills": () => json([{ id: "c1", name: "xlsx", title_vi: "Excel", description_vi: "d", tags: ["office"] }]),
      "GET /api/catalog/skills/c1/preview": () => json({ skill_md: "# x", files: ["SKILL.md"], has_code: true }),
      "POST /api/agents/a1/skills": () => json({ job_id: "j3" }, 202),
      "DELETE /api/agents/a1/skills/xlsx": () => json({ job_id: "j4" }, 202),
      "GET /api/catalog/presets": () => json([{ id: "data", title_vi: "Dữ liệu", description_vi: "d", packages: ["pandas"] }]),
      "GET /api/agents/a1/packages": () => json([{ name: "pandas", spec: "pandas>=2" }]),
      "POST /api/agents/a1/packages": () => json({ job_id: "j5" }, 202),
      "DELETE /api/agents/a1/packages/pandas": () => json({ job_id: "j6" }, 202),
      "GET /api/agents/a1/routines": () => json([routine]),
      "PUT /api/agents/a1/routines/sang": () => json(routine),
      "DELETE /api/agents/a1/routines/sang": () => json(null, 204),
      "GET /api/catalog/credential-sets": () => json([{ set: "warehouse", description: "Kho", keys: ["DSN"] }]),
      "GET /api/agents/a1/credentials": () => json([{ set: "warehouse", keys: ["DSN"] }]),
      "PUT /api/agents/a1/credentials": () => json([]),
      "GET /api/catalog/starters": () => json([{ slug: "data", display_name: "Data", avatar: AGENT.avatar,
        description: "d", presets: ["data"], credentials: ["warehouse"] }]),
    });
    expect((await builder.savePrompt("a1", "new")).data).toEqual({ text: "new", commit: "def" });
    expect((await builder.skills("a1")).data).toEqual([{ name: "xlsx", description: "d", catalogId: "c1", author: "user:alice" }]);
    expect((await builder.catalogSkills()).data![0]).toEqual({ id: "c1", name: "xlsx", title: "Excel", description: "d", tags: ["office"] });
    expect((await builder.skillPreview("c1")).data).toEqual({ skillMd: "# x", files: ["SKILL.md"], hasCode: true });
    await builder.installSkill("a1", { url: "https://github.com/o/r/tree/main/s" });
    expect(calls.at(-1)!.body).toEqual({ url: "https://github.com/o/r/tree/main/s" });
    await builder.installSkill("a1", { catalogId: "c1" });
    expect(calls.at(-1)!.body).toEqual({ catalog_id: "c1" });
    expect((await builder.removeSkill("a1", "xlsx")).data).toBe("j4");
    expect((await builder.presets()).data![0].title).toBe("Dữ liệu");
    await builder.addPackages("a1", { presetId: "data" });
    expect(calls.at(-1)!.body).toEqual({ preset_id: "data" });
    await builder.addPackages("a1", { spec: "polars" });
    expect(calls.at(-1)!.body).toEqual({ package: "polars" });
    expect((await builder.removePackage("a1", "pandas")).data).toBe("j6");
    expect((await builder.routines("a1")).data![0]).toMatchObject({ name: "sang", nextFires: ["n1"], lastStartedAt: null });
    await builder.saveRoutine("a1", "sang", { prompt: "p", cron: "0 8 * * *", enabled: false });
    expect(calls.at(-1)!.body).toEqual({ prompt: "p", cron: "0 8 * * *", enabled: false });
    expect((await builder.deleteRoutine("a1", "sang")).data).toBeNull();
    await builder.saveCredentials("a1", ["warehouse"]);
    expect(calls.at(-1)!.body).toEqual({ sets: ["warehouse"] });
    expect((await builder.starters()).data![0]).toMatchObject({ slug: "data", name: "Data", presets: ["data"] });
  });

  it("reads the folder: tree, text and image files, log, diff and archive links", async () => {
    const { builder, calls } = setup({
      "GET /api/agents/a1/tree": () => json([{ name: ".venv", type: "dir", size: null, mtime: null, items: null, symlink_target: null }]),
      "GET /api/agents/a1/file": (c) => c.url.includes("logo.png")
        ? json("PNG", 200, "image/png") : json("# Vai trò", 200, "text/plain; charset=utf-8"),
      "GET /api/agents/a1/log": () => json([{ commit: "abc1234", author: "contoso-harness", message: "m", at: "t", exec_id: null }]),
      "GET /api/agents/a1/diff": () => json("diff --git", 200, "text/plain"),
    });
    expect((await builder.tree("a1", "", "abc1234")).data![0]).toEqual({
      name: ".venv", type: "dir", size: null, mtime: null, items: null, symlinkTarget: null });
    expect(calls[0].url).toBe("/api/agents/a1/tree?at=abc1234");
    expect((await builder.file("a1", "prompts/system.md")).data).toEqual({ kind: "text", text: "# Vai trò", mediaType: "text/plain; charset=utf-8" });
    expect((await builder.file("a1", "logo.png")).data).toEqual({ kind: "image", url: "/api/agents/a1/file?path=logo.png" });
    expect((await builder.log("a1", "skills")).data![0]).toEqual({ commit: "abc1234", author: "contoso-harness", message: "m", at: "t", execId: null });
    expect((await builder.diff("a1", "abc1234")).data).toBe("diff --git");
    expect(builder.archiveUrl("a1", "skills", "abc1234")).toBe("/api/agents/a1/archive?path=skills&at=abc1234");
  });
});
