import type {
  AgentChatEvent, ChatMessage, ChatTask, ChatThread, TeamAgent,
} from "../services/agent-chat-service";

/** Client state of the target chat (doc 14 "Chat app layout", "Realtime"). Pure functions; the
 * page owns one copy and feeds it service reads and SSE events. */
export interface AgentChatState {
  agents: TeamAgent[];
  threads: ChatThread[];
  tasks: ChatTask[];
  messages: Record<string, { items: ChatMessage[]; complete: boolean }>;
}

export const emptyState = (): AgentChatState => ({ agents: [], threads: [], tasks: [], messages: {} });

const leadThread = (thread: ChatThread, agents: readonly TeamAgent[]) =>
  thread.kind === "direct"
  && thread.members.some((m) => m.type === "agent" && (m.isLead || agents.some((a) => a.id === m.id && a.isLead)));

export function orderThreads(threads: readonly ChatThread[], agents: readonly TeamAgent[]): ChatThread[] {
  return [...threads].sort((a, b) => {
    const lead = Number(leadThread(b, agents)) - Number(leadThread(a, agents));
    return lead || b.lastMessageAt.localeCompare(a.lastMessageAt) || a.id.localeCompare(b.id);
  });
}

export const agentMembers = (thread: ChatThread) => thread.members.filter((m) => m.type === "agent");

export function threadTitle(thread: ChatThread): string {
  if (thread.kind === "group") return thread.name ?? agentMembers(thread).map((m) => m.name).join(", ");
  return agentMembers(thread)[0]?.name ?? thread.name ?? "";
}

export function threadPreview(thread: ChatThread): string {
  const m = thread.lastMessage;
  if (!m) return "";
  const body = m.text.trim() || (m.attachments[0] ? `📎 ${m.attachments[0].filename}` : "");
  return thread.kind === "group" && m.sender.type !== "user" ? `${m.sender.name}: ${body}` : body;
}

export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const m of [...current, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const upsert = <T extends { id: unknown }>(list: readonly T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

const ACTIVE_TASK = new Set(["queued", "running"]);

export function applyEvent(state: AgentChatState, event: AgentChatEvent, openThreadId: string | null): AgentChatState {
  switch (event.type) {
    case "message": {
      const m = event.message;
      const loaded = state.messages[m.threadId];
      if (loaded?.items.some((x) => x.id === m.id)) return state;
      const counts = m.sender.type !== "user" && m.threadId !== openThreadId;
      return {
        ...state,
        messages: loaded
          ? { ...state.messages, [m.threadId]: { ...loaded, items: mergeMessages(loaded.items, [m]) } }
          : state.messages,
        threads: state.threads.map((t) => t.id !== m.threadId ? t : {
          ...t, lastMessage: m, lastMessageAt: m.createdAt > t.lastMessageAt ? m.createdAt : t.lastMessageAt,
          unread: t.unread + (counts ? 1 : 0),
        }),
      };
    }
    case "status":
      return {
        ...state,
        agents: state.agents.map((a) => a.id === event.agentId
          ? { ...a, status: event.status, statusDetail: event.statusDetail } : a),
      };
    case "task": {
      const rest = state.tasks.filter((t) => t.id !== event.task.id);
      return { ...state, tasks: ACTIVE_TASK.has(event.task.status) ? upsert(state.tasks, event.task) : rest };
    }
    case "thread":
      return { ...state, threads: upsert(state.threads, event.thread) };
    case "reconnect":
      return state;
  }
}

export function taskBanner(tasks: readonly ChatTask[], groupId: string | null = null) {
  const scoped = tasks.filter((task) => (task.groupId ?? null) === groupId);
  return {
    running: scoped.find((t) => t.status === "running") ?? null,
    queued: scoped.filter((t) => t.status === "queued").length,
  };
}

export function choiceState(message: ChatMessage, messages: readonly ChatMessage[]) {
  const reply = messages.find((m) => m.replyTo === message.id && m.sender.type === "user");
  return { locked: Boolean(reply), chosen: reply?.choiceId ?? null };
}
