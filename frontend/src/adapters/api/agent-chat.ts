import type { ServiceResult } from "../../shared/contracts/service-result";
import { failure } from "../../shared/contracts/service-result";
import {
  ATTACHMENT_LIMITS,
  type AgentAvatar, type AgentChatEvent, type AgentChatService, type AgentStatus, type ChatMessage,
  type ChatTask, type ChatThread, type TeamAgent, type ThreadMember,
} from "../../features/chat/services/agent-chat-service";
import { ApiRequestError, type ApiClient } from "./http";
import type { Realtime } from "./realtime";
import { call } from "./result";

/** The target chat on `/api/threads*`, `/api/tasks`, `/api/presence` and SSE (docs 14, 15). */
type Sender = { type: ChatMessage["sender"]["type"]; id: string | null; slug?: string;
  display_name: string; avatar: AgentAvatar };
type MessageDto = {
  id: number; thread_id: string; sender: Sender; text: string | null;
  target?: "lead" | null;
  mention?: { slug: string; name: string } | null;
  choices: { id: string; label: string }[] | null; reply_to: number | null; choice_id: string | null;
  attachments: { id: string; filename: string; mime: string; size: number }[];
  report_refs: { report_id: string; version_id: string; title: string }[]; created_at: string;
};
type MemberDto = { type: "user" | "agent"; id: string; slug?: string; display_name: string;
  avatar: AgentAvatar; is_lead?: boolean };
type ThreadDto = { id: string; kind: ChatThread["kind"]; name: string | null; members: MemberDto[];
  group?: ChatThread["group"];
  last_message: MessageDto | null; unread: number; read_only: boolean; last_message_at: string };
type AgentDto = { id: string; slug: string; display_name: string; avatar: AgentAvatar;
  description: string; is_lead: boolean; status: AgentStatus; status_detail: string | null };
type TaskDto = { id: number; description: string; status: ChatTask["status"]; created_at: string;
  group_id?: string | null;
  started_at: string | null; ended_at: string | null };

const SERVER_CODES: Record<string, string> = {
  thread_read_only: "readOnly", file_too_large: "tooLarge", too_many_files: "tooLarge",
  domain_unavailable: "domainUnavailable", task_ended: "taskEnded",
  group_ai_unavailable: "groupAiUnavailable",
  invalid_agent_mention: "invalidMention",
};

async function run<T>(operation: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return { data: await operation() };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const code = (error.serverCode && SERVER_CODES[error.serverCode])
        ?? (error.status === 413 ? "tooLarge" : null);
      if (code) return failure(code, false);
    }
    return call(() => Promise.reject(error));
  }
}

/** DTO → contract mappers for messages and threads, shared with the admin console. */
export function chatMappers(base: string) {
  const message = (m: MessageDto): ChatMessage => ({
    id: m.id,
    threadId: m.thread_id,
    sender: {
      type: m.sender.type, id: m.sender.id, name: m.sender.display_name, avatar: m.sender.avatar,
      ...(m.sender.slug ? { slug: m.sender.slug } : {}),
    },
    text: m.text ?? "",
    target: m.target ?? null,
    mention: m.mention ?? null,
    choices: m.choices ?? [],
    replyTo: m.reply_to,
    choiceId: m.choice_id,
    attachments: m.attachments.map((a) => ({ ...a, url: `${base}/api/attachments/${encodeURIComponent(a.id)}` })),
    reportRefs: m.report_refs.map((r) => ({ reportId: r.report_id, versionId: r.version_id, title: r.title })),
    createdAt: m.created_at,
  });
  const member = (m: MemberDto): ThreadMember => ({
    type: m.type, id: m.id, name: m.display_name, avatar: m.avatar,
    ...(m.slug ? { slug: m.slug } : {}),
    ...(m.is_lead !== undefined ? { isLead: m.is_lead } : {}),
  });
  const thread = (t: ThreadDto): ChatThread => ({
    id: t.id, kind: t.kind, name: t.name, members: t.members.map(member),
    group: t.group ?? null,
    lastMessage: t.last_message ? message(t.last_message) : null, unread: t.unread,
    readOnly: t.read_only, lastMessageAt: t.last_message_at,
  });
  return { message, member, thread };
}

export type { MessageDto, ThreadDto };

export function createApiAgentChat(client: ApiClient, realtime: Realtime, base: string): AgentChatService {
  const { message, thread } = chatMappers(base);
  const agent = (a: AgentDto): TeamAgent => ({
    id: a.id, slug: a.slug, name: a.display_name, avatar: a.avatar, description: a.description,
    isLead: a.is_lead, status: a.status, statusDetail: a.status_detail,
  });
  const task = (t: TaskDto): ChatTask => ({
    id: t.id, description: t.description, status: t.status, groupId: t.group_id ?? null, createdAt: t.created_at,
    startedAt: t.started_at, endedAt: t.ended_at,
  });
  const path = (id: string) => `/api/threads/${encodeURIComponent(id)}`;

  return {
    agents: (signal) => call(async () => (await client.get<AgentDto[]>("/api/agents", undefined, signal)).map(agent), signal),
    threads: (signal) => call(async () => (await client.get<ThreadDto[]>("/api/threads", undefined, signal)).map(thread), signal),
    messages: (threadId, before, signal) => call(async () =>
      (await client.get<MessageDto[]>(`${path(threadId)}/messages`, { before, limit: 50 }, signal)).map(message), signal),
    async send(threadId, outgoing) {
      if (outgoing.files.length > ATTACHMENT_LIMITS.count
          || outgoing.files.some((f) => f.size > ATTACHMENT_LIMITS.bytes)) return failure("validation", false);
      const form = new FormData();
      form.set("text", outgoing.text);
      if (outgoing.target) form.set("target", outgoing.target);
      if (outgoing.mention) form.set("mention", outgoing.mention);
      if (outgoing.choiceId) form.set("choice_id", outgoing.choiceId);
      if (outgoing.replyTo !== undefined) form.set("reply_to", String(outgoing.replyTo));
      outgoing.files.forEach((f) => form.append("files", f, f.name));
      return run(async () => message(await client.form<MessageDto>(`${path(threadId)}/messages`, form)));
    },
    async markRead(threadId, messageId) {
      await client.post(`${path(threadId)}/read`, { message_id: messageId }).catch(() => undefined);
    },
    createGroup: (name, agentIds) =>
      run(async () => thread(await client.post<ThreadDto>("/api/threads", { name, agent_ids: agentIds }))),
    updateGroup: (threadId, patch) => run(async () => thread(await client.patch<ThreadDto>(path(threadId), {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      add_agent_ids: patch.add ?? [], remove_agent_ids: patch.remove ?? [],
    }))),
    tasks: (signal) => call(async () =>
      (await client.get<TaskDto[]>("/api/tasks", { status: "queued,running" }, signal)).map(task), signal),
    cancelTask: (taskId) => run(async () => task(await client.post<TaskDto>(`/api/tasks/${taskId}/cancel`))),
    async presence() {
      await client.post("/api/presence").catch(() => undefined);
    },
    subscribe(listener) {
      const emit = (event: AgentChatEvent) => listener(event);
      const stops = [
        realtime.on("message.created", (d) => emit({ type: "message", message: message(d as MessageDto) })),
        realtime.on("agent.status", (d) => {
          const s = d as { agent_id: string; status: AgentStatus; status_detail: string | null };
          emit({ type: "status", agentId: s.agent_id, status: s.status, statusDetail: s.status_detail });
        }),
        realtime.on("task.updated", (d) => emit({ type: "task", task: task(d as TaskDto) })),
        realtime.on("thread.updated", (d) => emit({ type: "thread", thread: thread(d as ThreadDto) })),
        realtime.on("groups.changed", () => realtime.restart()),
        // a new agent (made in the builder) comes with its own direct thread: re-read the lists
        realtime.on("builder.job", (d) => {
          const job = d as { kind?: string; status?: string };
          if (job.kind === "agent_create" && job.status === "done") emit({ type: "reconnect" });
        }),
        // every open is a re-read: events sent while the stream was down are gone for good
        // (no replay), so the screen re-reads to catch up (doc 14 "Realtime")
        realtime.on("open", () => emit({ type: "reconnect" })),
      ];
      realtime.restart(); // recompute current group channels when the chat page opens
      return () => stops.forEach((stop) => stop());
    },
  };
}
