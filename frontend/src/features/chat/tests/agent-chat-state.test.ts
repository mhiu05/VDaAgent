// Target chat state (doc 14 "Chat app layout", "Realtime").
import { describe, expect, it } from "vitest";
import {
  applyEvent, choiceState, emptyState, mergeMessages, orderThreads, taskBanner, threadTitle,
  threadPreview, type AgentChatState,
} from "../model/agent-chat-state";
import type { ChatMessage, ChatThread, TeamAgent } from "../services/agent-chat-service";

const agent = (id: string, isLead = false): TeamAgent => ({
  id, slug: id, name: id.toUpperCase(), avatar: null, description: "", isLead, status: "idle",
  statusDetail: null,
});
const msg = (id: number, threadId = "t1", patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id, threadId, sender: { type: "agent", id: "lead", name: "LEAD", avatar: null }, text: `m${id}`,
  choices: [], replyTo: null, choiceId: null, attachments: [], reportRefs: [],
  createdAt: `2026-10-17T0${id % 10}:00:00Z`, ...patch,
});
const thread = (id: string, agentIds: string[], at: string, patch: Partial<ChatThread> = {}): ChatThread => ({
  id, kind: agentIds.length > 1 ? "group" : "direct", name: agentIds.length > 1 ? "Nhóm" : null,
  members: [
    { type: "user", id: "u1", name: "alice", avatar: null },
    ...agentIds.map((a) => ({ type: "agent" as const, id: a, slug: a, name: a.toUpperCase(), avatar: null })),
  ],
  lastMessage: null, unread: 0, readOnly: false, lastMessageAt: at, ...patch,
});

describe("agent chat state", () => {
  it("pins the lead's direct thread first, then newest first", () => {
    const agents = [agent("lead", true), agent("data"), agent("chart")];
    const threads = [
      thread("tl", ["lead"], "2026-10-01T00:00:00Z"),
      thread("td", ["data"], "2026-10-03T00:00:00Z"),
      thread("tg", ["data", "chart"], "2026-10-05T00:00:00Z"),
    ];
    expect(orderThreads(threads, agents).map((t) => t.id)).toEqual(["tl", "tg", "td"]);
  });

  it("titles and previews threads", () => {
    const direct = thread("td", ["data"], "x");
    const group = thread("tg", ["data", "chart"], "x", { lastMessage: msg(1, "tg") });
    expect(threadTitle(direct)).toBe("DATA");
    expect(threadTitle(group)).toBe("Nhóm");
    expect(threadPreview(group)).toBe("LEAD: m1");
    expect(threadPreview({ ...direct, lastMessage: msg(2) })).toBe("m2");
    expect(threadPreview({ ...direct, lastMessage: msg(3, "td", { text: "", attachments: [
      { id: "f", filename: "a.csv", mime: "text/csv", size: 1, url: "" }] }) })).toBe("📎 a.csv");
  });

  it("merges pages without duplicates in id order", () => {
    expect(mergeMessages([msg(3), msg(4)], [msg(1), msg(3), msg(2)]).map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it("applies message.created: appends once, bumps the thread, counts unread unless open", () => {
    let state: AgentChatState = { ...emptyState(), threads: [thread("t1", ["lead"], "2026-10-01T00:00:00Z")],
      messages: { t1: { items: [msg(1)], complete: true } } };
    state = applyEvent(state, { type: "message", message: msg(2) }, null);
    state = applyEvent(state, { type: "message", message: msg(2) }, null);
    expect(state.messages.t1.items.map((m) => m.id)).toEqual([1, 2]);
    expect(state.threads[0]).toMatchObject({ unread: 1, lastMessageAt: msg(2).createdAt });
    expect(state.threads[0].lastMessage?.id).toBe(2);
    state = applyEvent(state, { type: "message", message: msg(3) }, "t1");
    expect(state.threads[0].unread).toBe(1);
    const mine = msg(4, "t1", { sender: { type: "user", id: "u1", name: "alice", avatar: null } });
    expect(applyEvent(state, { type: "message", message: mine }, null).threads[0].unread).toBe(1);
  });

  it("applies agent.status, task.updated and thread.updated", () => {
    let state = { ...emptyState(), agents: [agent("lead", true)] };
    state = applyEvent(state, { type: "status", agentId: "lead", status: "routine", statusDetail: "Sáng" }, null);
    expect(state.agents[0]).toMatchObject({ status: "routine", statusDetail: "Sáng" });
    const task = { id: 1, description: "Q3", status: "running" as const, createdAt: "x", startedAt: "x", endedAt: null };
    state = applyEvent(state, { type: "task", task }, null);
    state = applyEvent(state, { type: "task", task: { ...task, id: 2, status: "queued" } }, null);
    expect(taskBanner(state.tasks)).toEqual({ running: task, queued: 1 });
    state = applyEvent(state, { type: "task", task: { ...task, status: "done" } }, null);
    expect(taskBanner(state.tasks)).toEqual({ running: null, queued: 1 });
    state = applyEvent(state, { type: "thread", thread: thread("g", ["a", "b"], "x") }, null);
    state = applyEvent(state, { type: "thread", thread: thread("g", ["a", "b"], "x", { name: "Mới" }) }, null);
    expect(state.threads.map((t) => t.name)).toEqual(["Mới"]);
  });

  it("keeps personal and group task banners separate", () => {
    const base = { description: "work", status: "running" as const, createdAt: "x", startedAt: "x", endedAt: null };
    const tasks = [
      { ...base, id: 1, groupId: null },
      { ...base, id: 2, groupId: "group-1" },
      { ...base, id: 3, groupId: "group-2", status: "queued" as const },
    ];
    expect(taskBanner(tasks, null).running?.id).toBe(1);
    expect(taskBanner(tasks, "group-1").running?.id).toBe(2);
    expect(taskBanner(tasks, "group-1").queued).toBe(0);
    expect(taskBanner(tasks, "group-2").queued).toBe(1);
  });

  it("locks choices once the message has a reply and marks the chosen one", () => {
    const ask = msg(1, "t1", { choices: [{ id: "pdf", label: "PDF" }, { id: "xlsx", label: "Excel" }] });
    expect(choiceState(ask, [ask])).toEqual({ locked: false, chosen: null });
    const reply = msg(2, "t1", { sender: { type: "user", id: "u1", name: "a", avatar: null },
      replyTo: 1, choiceId: "xlsx" });
    expect(choiceState(ask, [ask, reply])).toEqual({ locked: true, chosen: "xlsx" });
  });
});
