import type { ChatService } from "../../features/chat/services/chat-service";
import {
  applyMessage,
  type ChatBundle,
  type Message,
} from "../../features/chat/model/types";
import { failure } from "../../shared/contracts/service-result";
import type { MockContext } from "../core/scenarios";
import { seededId } from "../core/scenarios";
import { agents, makeBundle, answerFor } from "./fixtures";
import { createChatRepository } from "./repository";
import { createStorage } from "../core/storage";
import { withRiversideConversations } from "./riverside-scenario";
import { resolveMockCommand } from "../../features/chat/model/commands";
export function createChatMockService(ctx: MockContext): ChatService {
  const repo = createChatRepository(ctx.scenario === "storage-unavailable");
  const viewStorage = createStorage(
    "sessionStorage",
    ctx.scenario === "storage-unavailable",
  );
  const bundles = new Map<string, ChatBundle>();
  const inflight = new Map<
    string,
    { abort: AbortController; cancelled: boolean }
  >();
  let sequence = 0;
  const load = async (id: string) => {
    let b = bundles.get(id);
    if (!b) {
      b = (await repo.read(id)) ?? makeBundle(ctx.scenario);
      if (ctx.scenario === "success") b = withRiversideConversations(b);
      bundles.set(id, b);
    }
    return b;
  };
  return {
    sourceMode: "mock",
    delivery:
      ctx.scenario === "demo-replay" || ctx.scenario === "interrupted"
        ? "replay"
        : "complete",
    connection: ctx.scenario === "offline" ? "offline" : "online",
    inspectorOpen: (id) =>
      viewStorage.get(
        id,
        "inspector-open",
        (v): v is boolean => typeof v === "boolean",
      ) ?? true,
    saveInspector: (id, open) => {
      viewStorage.set(id, "inspector-open", open);
    },
    allocateId: (prefix) =>
      `${seededId(ctx.seed, prefix, ++sequence)}-${ctx.clock.now().getTime()}`,
    get degraded() {
      return repo.degraded;
    },
    catalog: () =>
      agents.map((a) =>
        ctx.scenario === "unsupported-capability"
          ? {
              ...a,
              capabilities: {
                group: "unknown",
                mention: "unknown",
                attachments: "unsupported",
                retry: "unsupported",
                cancel: "unsupported",
              },
            }
          : ctx.scenario === "demo-replay"
            ? { ...a, capabilities: { ...a.capabilities, cancel: "demo" } }
            : a,
      ),
    async load(id) {
      await ctx.clock.sleep(ctx.scenario === "loading" ? 1400 : 30);
      if (ctx.scenario === "error") return failure("unavailable");
      return { data: structuredClone(await load(id)) };
    },
    async saveDraft(id, cid, draft, attachments) {
      const b = await load(id);
      const c = b.conversations.find((c) => c.id === cid);
      if (c) {
        c.draft = draft;
        c.attachments = attachments;
        await repo.write(id, b);
      }
    },
    async create(id, participants) {
      const b = await load(id);
      if (!participants.length) return structuredClone(b);
      if (ctx.scenario === "unsupported-capability" && participants.length > 1)
        return structuredClone(b);
      let conversationId = this.allocateId("conversation");
      while (b.conversations.some((c) => c.id === conversationId))
        conversationId = this.allocateId("conversation");
      b.conversations.push({
        id: conversationId,
        title:
          participants.length > 1
            ? "Nhóm minh họa"
            : `${agents.find((a) => a.id === participants[0])?.name} · New research`,
        participants,
        kind: participants.length > 1 ? "group" : "direct",
        updatedAt: ctx.clock.now().toISOString(),
        messages: [],
        draft: "",
        attachments: [],
      });
      await repo.write(id, b);
      return structuredClone(b);
    },
    async send(id, cid, body, attachments, requestId, signal, onUpdate) {
      const key = `${id}:${requestId}`;
      const b = await load(id);
      const c = b.conversations.find((c) => c.id === cid);
      if (!c) return failure("invalid", false);
      // Completed Riverside projections never invoke the generic prerecorded reply path.
      if (c.scenarioId || /^\/report(?:\s|$)/i.test(body.trim()))
        return resolveMockCommand(c, body) === "report"
          ? { data: structuredClone(b) }
          : failure("unsupported", false);
      if (
        c.messages.some((m) => m.requestId === requestId) ||
        inflight.has(key)
      )
        return { data: structuredClone(b) };
      if (!body.trim() || attachments.some((a) => a.presence !== "memory"))
        return failure("invalid", false);
      if (ctx.scenario === "offline") return failure("offline");
      const work = { abort: new AbortController(), cancelled: false };
      inflight.set(key, work);
      const abort = () => work.abort.abort();
      signal.addEventListener("abort", abort, { once: true });
      const question: Message = {
        id: `${requestId}-user`,
        requestId,
        author: "user",
        body,
        attachments,
        createdAt: ctx.clock.now().toISOString(),
        state: "local-pending",
        sequence: 0,
      };
      c.messages.push(question);
      const publish = async () => {
        await repo.write(id, b);
        if (!signal.aborted) onUpdate(structuredClone(b));
      };
      await publish();
      try {
        await ctx.clock.sleep(180, work.abort.signal);
        if (ctx.scenario === "unknown-ack") {
          question.state = "response-interrupted";
          await publish();
          return { data: structuredClone(b) };
        }
        question.state = "accepted";
        c.draft = "";
        c.attachments = [];
        let answer: Message = {
          id: `${requestId}-reply`,
          author: c.participants[0],
          body: answerFor(c.participants[0]),
          createdAt: ctx.clock.now().toISOString(),
          state: "complete",
          sequence: 1,
        };
        if (ctx.scenario === "demo-replay" || ctx.scenario === "interrupted") {
          const full = answer.body;
          answer = { ...answer, body: "", state: "responding" };
          for (let i = 0; i < 6; i++) {
            await ctx.clock.sleep(300, work.abort.signal);
            answer = {
              ...answer,
              body: full.slice(0, Math.ceil((full.length * (i + 1)) / 6)),
              sequence: i + 1,
            };
            c.messages = applyMessage(c.messages, answer);
            await publish();
            if (ctx.scenario === "interrupted" && i === 2) {
              answer = {
                ...answer,
                state: "response-interrupted",
                sequence: 10,
              };
              c.messages = applyMessage(c.messages, answer);
              await publish();
              return { data: structuredClone(b) };
            }
          }
          answer = { ...answer, state: "complete", sequence: 10 };
        }
        c.messages = applyMessage(c.messages, answer);
        if (ctx.scenario === "duplicate-delivery")
          c.messages = applyMessage(c.messages, answer);
        if (ctx.scenario === "out-of-order")
          c.messages = applyMessage(c.messages, {
            ...answer,
            sequence: 0,
            body: "Old update",
          });
        question.state = "complete";
        c.updatedAt = ctx.clock.now().toISOString();
        await publish();
        return { data: structuredClone(b) };
      } catch {
        const reply = c.messages.find((m) => m.id === `${requestId}-reply`);
        if (reply)
          reply.state = work.cancelled ? "cancelled" : "response-interrupted";
        else question.state = work.cancelled ? "cancelled" : "send-rejected";
        await publish();
        return work.cancelled
          ? { data: structuredClone(b) }
          : failure("unavailable");
      } finally {
        signal.removeEventListener("abort", abort);
        inflight.delete(key);
        if (signal.aborted) repo.release(id);
      }
    },
    async cancel(id, requestId) {
      if (ctx.scenario !== "demo-replay") return false;
      const work = inflight.get(`${id}:${requestId}`);
      if (!work) return false;
      await ctx.clock.sleep(50);
      work.cancelled = true;
      work.abort.abort();
      return true;
    },
    async reset(id) {
      for (const [key, work] of inflight)
        if (key.startsWith(`${id}:`)) work.abort.abort();
      bundles.delete(id);
      await repo.reset(id);
    },
    release(id) {
      for (const [key, work] of inflight)
        if (key.startsWith(`${id}:`)) work.abort.abort();
      bundles.delete(id);
      repo.release(id);
    },
  };
}
