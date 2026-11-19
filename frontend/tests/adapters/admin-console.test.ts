// The admin console adapter (docs 12, 13, 15 "Admin API").
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/adapters/api/http";
import { createApiAdminConsole } from "../../src/adapters/api/admin-console";
import type { EventSourceLike } from "../../src/adapters/api/realtime";
import type { TraceStreamEvent } from "../../src/features/admin/services/admin-service";

type Call = { url: string; method: string; body: unknown };
const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });
    const h = routes[`${method} ${url.split("?")[0]}`];
    return h ? h({ url, method, body }) : json({ error: "not_found", message: "x" }, 404);
  }) as unknown as typeof globalThis.fetch;
  const sources: { url: string; listeners: Map<string, (e: MessageEvent) => void>; close: () => void }[] = [];
  const factory = (url: string): EventSourceLike => {
    const s = { url, listeners: new Map<string, (e: MessageEvent) => void>(), close: vi.fn() };
    sources.push(s);
    return { addEventListener: (t, l) => s.listeners.set(t, l), close: s.close, readyState: 1 };
  };
  return { admin: createApiAdminConsole(createApiClient({ fetch }), factory, ""), calls, sources };
}

const AGENT = { id: "a1", slug: "lead", display_name: "Điều phối", avatar: { emoji: "★", color: "#000" }, description: "",
  origin: "lead", is_lead: true, status: "busy", status_detail: null, created_at: "2026-10-01T00:00:00+00:00" };
const USER = { id: "u1", username: "alice", display_name: "", role: "user",
  domain: { id: "fabrikam", name: "Fabrikam", status: "available" }, status: "failed",
  status_detail: "provisioning did not finish", created_at: "2026-10-01T00:00:00+00:00" };

describe("admin console adapter", () => {
  it("maps the overview and config", async () => {
    const { admin } = setup({
      "GET /api/admin/overview": () => json({
        domains: [{ id: "fabrikam", name: "Fabrikam", status: "available", status_reason: null }],
        agents: [{ ...AGENT, user: { id: "u1", username: "alice" }, domain: "fabrikam",
          current_task: { id: 4, description: "Q3" }, queue_len: 2, pending: 1, cost_today: 0.5,
          last_error_at: null, compaction_failed: false, compaction_pending: true }],
      }),
      "GET /api/admin/config": () => json({ langfuse_url: "http://lf", langfuse_project_id: "contoso-poc" }),
    });
    const o = (await admin.overview()).data!;
    expect(o.domains[0]).toEqual({ id: "fabrikam", name: "Fabrikam", status: "available", statusReason: null });
    expect(o.agents[0]).toMatchObject({ name: "Điều phối", isLead: true, user: { username: "alice" }, currentTask: { id: 4 },
      queueLen: 2, pending: 1, costToday: 0.5, compactionPending: true, compactionFailed: false });
    expect((await admin.config()).data).toEqual({ langfuseUrl: "http://lf", projectId: "contoso-poc" });
  });

  it("manages users: create, retry, disable, password, reset agent", async () => {
    const { admin, calls } = setup({
      "GET /api/admin/users": () => json([USER]),
      "POST /api/admin/users": (c) => (c.body as { username: string }).username === "alice"
        ? json({ error: "username_taken", message: "x" }, 409) : json({ user: { ...USER, username: "bob" }, job_id: "j1" }, 202),
      "POST /api/admin/users/u1/retry": () => json({ job_id: "j2" }, 202),
      "PATCH /api/admin/users/u1": (c) => json({ ...USER, status: (c.body as { disabled?: boolean }).disabled ? "disabled" : "active" }),
      "POST /api/admin/agents/a1/reset": () => json({ error: "agent_busy_in_task", message: "x" }, 409),
    });
    expect((await admin.users()).data![0]).toEqual({ id: "u1", username: "alice", displayName: "",
      domain: { id: "fabrikam", name: "Fabrikam", status: "available", statusReason: null },
      status: "failed", statusDetail: "provisioning did not finish", createdAt: USER.created_at,
      provisioning: null });
    expect((await admin.createUser({ username: "bob", password: "pw", domainId: "fabrikam", displayName: "" })).data!.username).toBe("bob");
    expect(calls.at(-1)!.body).toEqual({ username: "bob", password: "pw", domain_id: "fabrikam", display_name: "" });
    expect((await admin.createUser({ username: "alice", password: "pw", domainId: "fabrikam", displayName: "" })).error?.code).toBe("usernameTaken");
    expect((await admin.retryProvisioning("u1")).data).toBe("j2");
    expect((await admin.setDisabled("u1", true)).data!.status).toBe("disabled");
    expect(calls.at(-1)!.body).toEqual({ disabled: true });
    await admin.resetPassword("u1", "new-pass");
    expect(calls.at(-1)!.body).toEqual({ password: "new-pass" });
    expect((await admin.resetAgent("a1")).error?.code).toBe("agentBusyInTask");
  });

  it("reads traces and threads, marks jev, compacts", async () => {
    const { admin, calls } = setup({
      "GET /api/admin/agents/a1/events": () => json({
        agent: AGENT,
        events: [{ seq: 1, epoch: 0, kind: "input", payload: { text: "x" }, trace_id: "t", activation_kind: "message", task_id: null, created_at: "c" }],
        epochs: [{ epoch: 0, start_seq: 0, reason: "initial", summary: null, system_prompt: "S", created_at: "c" }],
        jev: [{ id: 1, message_id: 3, label: "task", fallback: false, model: "m", latency_ms: 5, trace_id: "t", observed: null, created_at: "c" }],
      }),
      "GET /api/admin/threads/th1": () => json({
        thread: { id: "th1", kind: "agent", name: null, members: [], last_message: null, unread: 0, read_only: false, last_message_at: "c" },
        messages: [{ id: 3, thread_id: "th1", sender: { type: "agent", id: "a1", slug: "lead", display_name: "Điều phối", avatar: null },
          text: "hi", choices: null, reply_to: null, choice_id: null, attachments: [], report_refs: [], created_at: "c", trace_id: "t" }],
      }),
      "POST /api/admin/jev/3/observed": () => json(null, 204),
      "POST /api/admin/agents/a1/compact": () => json(null, 204),
    });
    const trace = (await admin.trace("a1", 0)).data!;
    expect(calls[0].url).toBe("/api/admin/agents/a1/events?after_seq=0&limit=200");
    expect(trace.events[0]).toEqual({ seq: 1, epoch: 0, kind: "input", payload: { text: "x" }, traceId: "t", activationKind: "message", taskId: null, createdAt: "c" });
    expect(trace.epochs[0]).toEqual({ epoch: 0, startSeq: 0, reason: "initial", summary: null, systemPrompt: "S", createdAt: "c" });
    expect(trace.jev[0]).toEqual({ id: 1, messageId: 3, label: "task", fallback: false, observed: null });
    const t = (await admin.thread("th1")).data!;
    expect(t.thread.kind).toBe("agent");
    expect(t.messages[0]).toMatchObject({ id: 3, text: "hi", traceId: "t", sender: { name: "Điều phối" } });
    await admin.markJev(3, "side_question");
    expect(calls.at(-1)!.body).toEqual({ label: "side_question" });
    expect((await admin.compact("a1")).data).toBeNull();
  });

  it("opens one SSE stream per watched agent and closes it", () => {
    const { admin, sources } = setup({});
    const got: TraceStreamEvent[] = [];
    const stop = admin.watch("a1", (e) => got.push(e));
    expect(sources[0].url).toBe("/api/admin/agents/a1/stream");
    sources[0].listeners.get("event.appended")!({ data: JSON.stringify({ agent_id: "a1", seq: 9, kind: "input" }) } as MessageEvent);
    sources[0].listeners.get("agent.status")!({ data: JSON.stringify({ agent_id: "a1", status: "busy", status_detail: null }) } as MessageEvent);
    expect(got).toEqual([{ type: "appended", seq: 9 }, { type: "status", status: "busy", statusDetail: null }]);
    stop();
    expect(sources[0].close).toHaveBeenCalled();
  });
});
