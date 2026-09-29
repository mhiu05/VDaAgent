import {
  ConversationSchema,
  MessagePartSchema,
  MessageSchema,
  type Conversation,
  type Message,
  type MessagePart,
} from '@vda/contracts';
import type { Row } from '../driver';
import { RepositoryError, fail } from '../errors';
import { json } from './rows';

const now = () => new Date().toISOString();

export const asTimestamp = (value: unknown, fallback = now()): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
};
export const textPart = (content: string): MessagePart[] =>
  content.trim().length ? [{ type: 'text', text: content.trim() }] : [];
export function normalizeMessage(row: Row): Message {
  const payload = json(row) as Record<string, unknown>;
  const content = typeof payload.content === 'string' ? payload.content : '';
  const parts = Array.isArray(payload.parts)
    ? payload.parts.flatMap((part) => {
        const parsed = MessagePartSchema.safeParse(part);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return MessageSchema.parse({
    message_id: row.id ?? payload.message_id,
    org_id: row.org_id ?? payload.org_id,
    conversation_id: row.conversation_id ?? payload.conversation_id,
    run_id: row.run_id ?? payload.run_id ?? null,
    client_turn_id: row.client_turn_id ?? payload.client_turn_id ?? null,
    role: row.role ?? payload.role ?? 'user',
    sender_agent: row.sender_agent ?? payload.sender_agent ?? null,
    status: row.status ?? payload.status ?? 'completed',
    content,
    ...(payload.context_refs ? { context_refs: payload.context_refs } : {}),
    ...(payload.reply_to_message_id ? { reply_to_message_id: payload.reply_to_message_id } : {}),
    ...(payload.report_intent ? { report_intent: payload.report_intent } : {}),
    parts: parts.length ? parts : textPart(content),
    created_at: asTimestamp(row.created_at ?? payload.created_at),
    updated_at: asTimestamp(
      row.updated_at ?? payload.updated_at ?? row.created_at ?? payload.created_at,
    ),
  });
}
export function messagePayload(message: Message, payloadExtra: Record<string, unknown> = {}) {
  const { sender_agent: _senderAgent, ...payload } = message;
  const { sender_agent: _extraSenderAgent, ...extra } = payloadExtra;
  return { ...payload, ...extra };
}
export function conversationFromRow(row: Row): Conversation {
  return ConversationSchema.parse({
    conversation_id: row.id,
    org_id: row.org_id,
    created_by: row.created_by,
    kind: row.kind,
    title: row.title,
    created_at: asTimestamp(row.created_at),
    updated_at: asTimestamp(row.updated_at),
  });
}
type Cursor = { timestamp: string; id: string };
export function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decodeCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Cursor).timestamp !== 'string' ||
      typeof (parsed as Cursor).id !== 'string' ||
      !(parsed as Cursor).id ||
      Number.isNaN(Date.parse((parsed as Cursor).timestamp))
    )
      fail('INVALID_CURSOR');
    return {
      timestamp: new Date((parsed as Cursor).timestamp).toISOString(),
      id: (parsed as Cursor).id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('INVALID_CURSOR');
  }
}
export const titleFrom = (text: string) =>
  text.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New analysis';
