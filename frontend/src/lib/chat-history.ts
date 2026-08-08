import type { AnswerSource, Profile } from "@/lib/types";

export type ChatMessage = {
  id: string;
  role: "agent" | "user";
  text: string;
  label?: string;
};

export type ChatSnapshot = {
  messages: ChatMessage[];
  profile: Profile | null;
  sources: AnswerSource[];
};

export type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

const INDEX_KEY = "p170-agent-conversations-v1";
const SNAPSHOT_PREFIX = "p170-agent-conversation-v1:";
export const CHAT_HISTORY_EVENT = "p170-chat-history-updated";

function snapshotKey(id: string): string {
  return `${SNAPSHOT_PREFIX}${id}`;
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
  };
  saveConversations([conversation, ...listConversations()]);
  window.localStorage.setItem(snapshotKey(conversation.id), JSON.stringify({ messages: [], profile: null, sources: [] }));
  return conversation;
}

export function listConversations(): ChatConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) as ChatConversation[] : [];
    if (!Array.isArray(parsed)) return [];
    // Giữ lại một mục rỗng gần nhất để các lần mount/reload không làm sidebar
    // xuất hiện nhiều "Cuộc trò chuyện mới" chưa có nội dung.
    let emptyNewChatKept = false;
    return parsed.filter((conversation) => {
      if (conversation.title !== "Cuộc trò chuyện mới") return true;
      if (emptyNewChatKept) return false;
      emptyNewChatKept = true;
      return true;
    });
  } catch {
    return [];
  }
}

function saveConversations(conversations: ChatConversation[]): void {
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(conversations));
  notifyHistoryChanged();
}

export function getConversation(id: string): ChatConversation | null {
  return listConversations().find((conversation) => conversation.id === id) || null;
}

export function updateConversationSnapshot(id: string, snapshot: ChatSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(snapshotKey(id), JSON.stringify(snapshot));
  const conversations = listConversations();
  const current = conversations.find((conversation) => conversation.id === id);
  if (!current) return;
  const firstUserMessage = snapshot.messages.find((message) => message.role === "user");
  const title = current.title === "Cuộc trò chuyện mới" && firstUserMessage
    ? firstUserMessage.text.trim().slice(0, 42) || current.title
    : current.title;
  saveConversations(conversations.map((conversation) => conversation.id === id
    ? { ...conversation, title, updatedAt: new Date().toISOString() }
    : conversation));
}

export function getConversationSnapshot(id: string): ChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatSnapshot>;
    if (!Array.isArray(parsed.messages)) return null;
    return {
      messages: parsed.messages,
      profile: parsed.profile || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return null;
  }
}
