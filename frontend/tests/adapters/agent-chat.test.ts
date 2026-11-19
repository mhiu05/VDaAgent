// The target chat adapter (docs 14, 15 "Threads and messages", "Tasks, presence and stream").
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/adapters/api/http";
import { createApiAgentChat } from "../../src/adapters/api/agent-chat";
import { createRealtime, type EventSourceLike } from "../../src/adapters/api/realtime";
import type { AgentChatEvent } from "../../src/features/chat/services/agent-chat-service";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body: unknown = init.body;
    if (typeof body === "string") body = JSON.parse(body);
    const call = { url, method, headers, body };
    calls.push(call);
    const handler = routes[`${method} ${url.split("?")[0]}`];
    return handler ? handler(call) : json({ error: "not_found", message: "x" }, 404);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

const LEAD = { emoji: "★", color: "#0F766E" };
const MESSAGE = {
  id: 7, thread_id: "t1",
  sender: { type: "agent", id: "a1", slug: "lead", display_name: "Điều phối", avatar: LEAD },
  text: "Chọn định dạng", choices: [{ id: "pdf", label: "PDF" }], reply_to: null, choice_id: null,
  attachments: [{ id: "f1", filename: "q3.csv", mime: "text/csv", size: 120 }],
  report_refs: [{ report_id: "R7", version_id: "R7-v1", title: "Tồn kho" }],
  created_at: "2026-10-17T02:00:00+00:00",
};
const THREAD = {
  id: "t1", kind: "direct", name: null,
  members: [
    { type: "user", id: "u1", display_name: "alice", avatar: null },
    { type: "agent", id: "a1", slug: "lead", display_name: "Điều phối", avatar: LEAD, is_lead: true },
  ],
  last_message: MESSAGE, unread: 2, read_only: false, last_message_at: "2026-10-17T02:00:00+00:00",
};
const TASK = {
  id: 42, description: "Báo cáo Q3", status: "running", outcome: null, ended_by: null,
  source_message_id: 3, created_at: "2026-10-17T01:00:00+00:00",
  started_at: "2026-10-17T01:00:01+00:00", ended_at: null,
};

function setup(routes: Record<string, (call: Call) => Response> = {}) {
  const f = fakeFetch(routes);
  const listeners = new Map<string, (event: MessageEvent) => void>();
  const source: EventSourceLike = {
    addEventListener: (type, l) => listeners.set(type, l),
    close: vi.fn(),
    readyState: 1,
  };
  const realtime = createRealtime("/api/stream", () => source);
  const chat = createApiAgentChat(createApiClient({ fetch: f.fn }), realtime, "");
  const emit = (type: string, data?: unknown) =>
    listeners.get(type)?.({ data: data === undefined ? undefined : JSON.stringify(data) } as MessageEvent);
  return { f, chat, emit };
}

describe("agent chat adapter", () => {
  it("maps threads, members and the last message to the camelCase contract", async () => {
    const { chat } = setup({ "GET /api/threads": () => json([THREAD]) });
    const result = await chat.threads();
    const thread = result.data![0];
    expect(thread).toMatchObject({ id: "t1", kind: "direct", unread: 2, readOnly: false });
    expect(thread.members[1]).toEqual({
      type: "agent", id: "a1", slug: "lead", name: "Điều phối", avatar: LEAD, isLead: true,
    });
    expect(thread.lastMessage).toMatchObject({
      id: 7, threadId: "t1", text: "Chọn định dạng", choices: [{ id: "pdf", label: "PDF" }],
      sender: { type: "agent", name: "Điều phối", slug: "lead" },
      attachments: [{ id: "f1", filename: "q3.csv", mime: "text/csv", size: 120, url: "/api/attachments/f1" }],
      reportRefs: [{ reportId: "R7", versionId: "R7-v1", title: "Tồn kho" }],
    });
  });

  it("maps agents and their status", async () => {
    const { chat } = setup({
      "GET /api/agents": () => json([{
        id: "a1", slug: "lead", display_name: "Điều phối", avatar: LEAD, description: "Điều phối",
        origin: "builtin", is_lead: true, status: "routine", status_detail: "Báo cáo sáng",
        created_at: "2026-10-01T00:00:00+00:00",
      }]),
    });
    expect((await chat.agents()).data).toEqual([{
      id: "a1", slug: "lead", name: "Điều phối", avatar: LEAD, description: "Điều phối",
      isLead: true, status: "routine", statusDetail: "Báo cáo sáng",
    }]);
  });

  it("pages messages with before= and limit", async () => {
    const { chat, f } = setup({ "GET /api/threads/t1/messages": () => json([MESSAGE]) });
    expect((await chat.messages("t1", 50)).data![0].id).toBe(7);
    expect(f.calls[0].url).toBe("/api/threads/t1/messages?before=50&limit=50");
    await chat.messages("t1");
    expect(f.calls[1].url).toBe("/api/threads/t1/messages?limit=50");
  });

  it("sends multipart text, files and choice id", async () => {
    const { chat, f } = setup({ "POST /api/threads/t1/messages": () => json(MESSAGE, 201) });
    const file = new File(["a,b"], "x.csv", { type: "text/csv" });
    const sent = await chat.send("t1", { text: "PDF", files: [file], choiceId: "pdf", replyTo: 7 });
    expect(sent.data!.id).toBe(7);
    const form = f.calls[0].body as FormData;
    expect(form.get("text")).toBe("PDF");
    expect(form.get("choice_id")).toBe("pdf");
    expect(form.get("reply_to")).toBe("7");
    expect((form.getAll("files")[0] as File).name).toBe("x.csv");
    expect(f.calls[0].headers["x-contoso-client"]).toBe("web");
  });

  it("maps room metadata and sends an explicit AI target", async () => {
    const room = { ...THREAD, id: "room", kind: "group", group: { id: "group", name: "Sales Team", status: "active" } };
    const { chat, f } = setup({
      "GET /api/threads": () => json([room]),
      "POST /api/threads/room/messages": () => json({ ...MESSAGE, target: "lead" }, 201),
      "GET /api/tasks": () => json([{ ...TASK, group_id: "group" }]),
    });
    expect((await chat.threads()).data?.[0].group?.id).toBe("group");
    expect((await chat.tasks()).data?.[0].groupId).toBe("group");
    expect((await chat.send("room", { text: "Analyze", files: [], target: "lead" })).data?.target).toBe("lead");
    expect((f.calls[2].body as FormData).get("target")).toBe("lead");
  });

  it("rejects too many or too large files before uploading", async () => {
    const { chat, f } = setup();
    const many = Array.from({ length: 11 }, (_, i) => new File(["x"], `${i}.txt`));
    expect((await chat.send("t1", { text: "", files: many })).error?.code).toBe("validation");
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 + 1 });
    expect((await chat.send("t1", { text: "", files: [big] })).error?.code).toBe("validation");
    expect(f.calls).toHaveLength(0);
  });

  it("maps a read-only thread and an oversized upload to stable codes", async () => {
    const { chat } = setup({
      "POST /api/threads/t1/messages": () => json({ error: "thread_read_only", message: "x" }, 409),
      "POST /api/threads/t2/messages": () => json({ error: "file_too_large", message: "x" }, 413),
    });
    expect((await chat.send("t1", { text: "hi", files: [] })).error?.code).toBe("readOnly");
    expect((await chat.send("t2", { text: "hi", files: [] })).error?.code).toBe("tooLarge");
  });

  it("creates and patches groups, marks read, cancels tasks and sends presence", async () => {
    const group = { ...THREAD, id: "g1", kind: "group", name: "Nhóm Q3" };
    const { chat, f } = setup({
      "POST /api/threads": () => json(group, 201),
      "PATCH /api/threads/g1": () => json(group),
      "POST /api/threads/t1/read": () => json(null, 204),
      "GET /api/tasks": () => json([TASK]),
      "POST /api/tasks/42/cancel": () => json({ ...TASK, status: "cancelled" }),
      "POST /api/presence": () => json(null, 204),
    });
    expect((await chat.createGroup("Nhóm Q3", ["a2", "a3"])).data!.name).toBe("Nhóm Q3");
    expect(f.calls[0].body).toEqual({ name: "Nhóm Q3", agent_ids: ["a2", "a3"] });
    await chat.updateGroup("g1", { name: "Q3", add: ["a4"], remove: ["a2"] });
    expect(f.calls[1].body).toEqual({ name: "Q3", add_agent_ids: ["a4"], remove_agent_ids: ["a2"] });
    await chat.markRead("t1", 7);
    expect(f.calls[2].body).toEqual({ message_id: 7 });
    expect((await chat.tasks()).data![0]).toEqual({
      id: 42, description: "Báo cáo Q3", status: "running", createdAt: TASK.created_at,
      startedAt: TASK.started_at, endedAt: null, groupId: null,
    });
    expect(f.calls[3].url).toBe("/api/tasks?status=queued%2Crunning");
    expect((await chat.cancelTask(42)).data!.status).toBe("cancelled");
    await chat.presence();
    expect(f.calls.map((c) => c.url).at(-1)).toBe("/api/presence");
  });

  it("turns SSE events into chat events and every stream open into a re-read", () => {
    const { chat, emit } = setup();
    const events: AgentChatEvent[] = [];
    const stop = chat.subscribe((e) => events.push(e));
    emit("message.created", MESSAGE);
    emit("agent.status", { agent_id: "a1", slug: "lead", status: "busy", status_detail: null });
    emit("task.updated", TASK);
    emit("thread.updated", THREAD);
    emit("open");
    emit("open");
    emit("groups.changed", { group_id: "g1" });
    emit("open");
    expect(events.map((e) => e.type)).toEqual([
      "message", "status", "task", "thread", "reconnect", "reconnect", "reconnect",
    ]);
    expect(events[1]).toEqual({ type: "status", agentId: "a1", status: "busy", statusDetail: null });
    stop();
    emit("message.created", MESSAGE);
    expect(events).toHaveLength(7);
  });

  it("re-reads the lists when a new agent is created, not on other builder jobs", () => {
    const { chat, emit } = setup();
    const events: AgentChatEvent[] = [];
    chat.subscribe((e) => events.push(e));
    emit("builder.job", { job_id: "j1", kind: "agent_create", status: "running" });
    emit("builder.job", { job_id: "j2", kind: "skill_install", status: "done" });
    emit("builder.job", { job_id: "j1", kind: "agent_create", status: "done" });
    expect(events.map((e) => e.type)).toEqual(["reconnect"]);
  });
});
