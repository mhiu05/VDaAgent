import type { AnswerSource, Profile } from "@/lib/types";

export type ChatMessage = {
  id: string;
  role: "agent" | "user";
  text: string;
  label?: string;
  sources?: AnswerSource[];
};

export type ChatSnapshot = {
  messages: ChatMessage[];
  profile: Profile | null;
  /** Legacy, retained solely to migrate existing browser snapshots. */
  sources?: AnswerSource[];
};

export type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  hasUploadedData?: boolean;
};

const INDEX_KEY = "p170-agent-conversations-v1";
const SNAPSHOT_PREFIX = "p170-agent-conversation-v1:";
let scope = "anonymous:legacy";
let guestScope = false;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_HISTORY_EVENT = "p170-chat-history-updated";

function snapshotKey(id: string): string {
  return `${SNAPSHOT_PREFIX}${scope}:${id}`;
}

function indexKey(): string {
  return `${INDEX_KEY}:${scope}`;
}

function storage(): Storage {
  return guestScope ? window.sessionStorage : window.localStorage;
}

/** Keep browser-only chat state isolated when account or workspace changes. */
export function setChatHistoryScope(userId: string | null | undefined, workspaceId: string | null | undefined, isGuest = false): void {
  scope = `${userId || "anonymous"}:${workspaceId || "legacy"}`;
  guestScope = isGuest;
  if (typeof window !== "undefined") notifyHistoryChanged();
}

export function clearChatHistory(): void {
  if (typeof window === "undefined") return;
  const store = storage();
  store.removeItem(indexKey());
  for (let index = store.length - 1; index >= 0; index -= 1) {
    const key = store.key(index);
    if (key?.startsWith(`${SNAPSHOT_PREFIX}${scope}:`)) store.removeItem(key);
  }
  notifyHistoryChanged();
}

function notifyHistoryChanged(): void {
  window.dispatchEvent(new Event(CHAT_HISTORY_EVENT));
}

export function createConversation(title = "Cuộc trò chuyện mới"): ChatConversation {
  const now = new Date().toISOString();
  const conversation: ChatConversation = {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    hasUploadedData: false,
  };
  saveConversations([conversation, ...readConversations()]);
  storage().setItem(snapshotKey(conversation.id), JSON.stringify({ messages: [], profile: null }));
  return conversation;
}

function readConversations(): ChatConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = storage().getItem(indexKey());
    const parsed = raw ? JSON.parse(raw) as ChatConversation[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanupExpiredConversations(conversations: ChatConversation[]): ChatConversation[] {
  const now = Date.now();
  const active = conversations.filter((conversation) => {
    const updatedAt = Date.parse(conversation.updatedAt || conversation.createdAt);
    return !Number.isFinite(updatedAt) || now - updatedAt <= HISTORY_RETENTION_MS;
  });
  const expired = conversations.filter((conversation) => !active.includes(conversation));
  expired.forEach((conversation) => storage().removeItem(snapshotKey(conversation.id)));
  if (active.length !== conversations.length) {
    storage().setItem(indexKey(), JSON.stringify(active));
  }
  return active;
}

export function listConversations(): ChatConversation[] {
  // Every conversation is valid history, including chats that never uploaded
  // a dataset. The preview is limited by the sidebar; the full list is opened
  // through the History button.
  return cleanupExpiredConversations(readConversations());
}

function saveConversations(conversations: ChatConversation[]): void {
  storage().setItem(indexKey(), JSON.stringify(conversations));
  notifyHistoryChanged();
}

export function getConversation(id: string): ChatConversation | null {
  return cleanupExpiredConversations(readConversations()).find((conversation) => conversation.id === id) || null;
}

export function updateConversationSnapshot(id: string, snapshot: ChatSnapshot): void {
  if (typeof window === "undefined") return;
  storage().setItem(snapshotKey(id), JSON.stringify(snapshot));
  const conversations = cleanupExpiredConversations(readConversations());
  const current = conversations.find((conversation) => conversation.id === id);
  if (!current) return;
  const hasUploadedData = snapshot.profile
    ? true
    : current.hasUploadedData === false
      ? false
      : current.hasUploadedData;
  const firstUserMessage = snapshot.messages.find((message) => message.role === "user");
  const title = current.title === "Cuộc trò chuyện mới" && firstUserMessage
    ? firstUserMessage.text.trim().slice(0, 42) || current.title
    : current.title;
  saveConversations(conversations.map((conversation) => conversation.id === id
    ? { ...conversation, title, hasUploadedData, updatedAt: new Date().toISOString() }
    : conversation));
}

export function getConversationSnapshot(id: string): ChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = storage().getItem(snapshotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatSnapshot>;
    if (!Array.isArray(parsed.messages)) return null;
    return {
      profile: parsed.profile || null,
      // Snapshots from v1 held one conversation-wide source array. Associate it
      // with its last agent answer once, then all later saves use message scope.
      messages: (() => {
        const messages = parsed.messages as ChatMessage[];
        if (Array.isArray(parsed.sources) && parsed.sources.length) {
          const lastAgent = [...messages].reverse().find((message) => message.role === "agent");
          if (lastAgent && !lastAgent.sources) lastAgent.sources = parsed.sources;
        }
        return messages;
      })(),
      sources: [],
    };
  } catch {
    return null;
  }
}
