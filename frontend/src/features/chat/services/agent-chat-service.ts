import type { ServiceResult } from "../../../shared/contracts/service-result";

/** The target chat (doc 14 "Chat app layout"): the user's agent team, threads and the global
 * task queue on the real API. Mock mode keeps the scripted `ChatService` (decision 0022). */
export type AgentStatus = "idle" | "busy" | "routine" | "compacting";
export type AgentAvatar = { emoji: string; color: string } | null;

export interface TeamAgent {
  id: string;
  slug: string;
  name: string;
  avatar: AgentAvatar;
  description: string;
  isLead: boolean;
  status: AgentStatus;
  statusDetail: string | null;
}

export interface ThreadMember {
  type: "user" | "agent";
  id: string;
  slug?: string;
  name: string;
  avatar: AgentAvatar;
  isLead?: boolean;
}

export interface ChatAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
}

export interface ChatReportRef { reportId: string; versionId: string; title: string }
export interface ChatChoice { id: string; label: string }

export interface ChatMessage {
  id: number;
  threadId: string;
  sender: {
    type: "user" | "agent" | "system";
    id: string | null;
    slug?: string;
    name: string;
    avatar: AgentAvatar;
  };
  text: string;
  target?: "lead" | null;
  /** The group agent a person @mentioned (routed through the group's lead). */
  mention?: { slug: string; name: string } | null;
  choices: ChatChoice[];
  replyTo: number | null;
  choiceId: string | null;
  attachments: ChatAttachment[];
  reportRefs: ChatReportRef[];
  createdAt: string;
}

export interface ChatThread {
  id: string;
  /** `agent` threads (agent ↔ agent) are visible to admins only (doc 08). */
  kind: "direct" | "group" | "agent";
  group?: { id: string; name: string; status: "provisioning" | "active" | "failed" } | null;
  name: string | null;
  members: ThreadMember[];
  lastMessage: ChatMessage | null;
  unread: number;
  readOnly: boolean;
  lastMessageAt: string;
}

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export interface ChatTask {
  id: number;
  description: string;
  status: TaskStatus;
  groupId?: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface OutgoingMessage {
  text: string;
  files: readonly File[];
  target?: "group" | "lead";
  /** Slug of a group agent picked from the @ menu; the server resolves it in the group's team. */
  mention?: string;
  choiceId?: string;
  replyTo?: number;
}

export type AgentChatEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "status"; agentId: string; status: AgentStatus; statusDetail: string | null }
  | { type: "task"; task: ChatTask }
  | { type: "thread"; thread: ChatThread }
  | { type: "reconnect" };

export const ATTACHMENT_LIMITS = { count: 10, bytes: 20 * 1024 * 1024 } as const;

export interface AgentChatService {
  agents(signal?: AbortSignal): Promise<ServiceResult<TeamAgent[]>>;
  threads(signal?: AbortSignal): Promise<ServiceResult<ChatThread[]>>;
  messages(threadId: string, before?: number, signal?: AbortSignal): Promise<ServiceResult<ChatMessage[]>>;
  send(threadId: string, message: OutgoingMessage): Promise<ServiceResult<ChatMessage>>;
  markRead(threadId: string, messageId: number): Promise<void>;
  createGroup(name: string, agentIds: readonly string[]): Promise<ServiceResult<ChatThread>>;
  updateGroup(threadId: string, patch: { name?: string; add?: readonly string[]; remove?: readonly string[] }):
    Promise<ServiceResult<ChatThread>>;
  tasks(signal?: AbortSignal): Promise<ServiceResult<ChatTask[]>>;
  cancelTask(taskId: number): Promise<ServiceResult<ChatTask>>;
  presence(): Promise<void>;
  subscribe(listener: (event: AgentChatEvent) => void): () => void;
}

/** Workspace key for the port; when it isn't configured `/chat` shows the mock chat. */
export const AGENT_CHAT_KEY = "agent-chat";
