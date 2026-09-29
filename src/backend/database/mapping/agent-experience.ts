import {
  AgentKeySchema,
  AgentItemIdSchema,
  IdSchema,
  type AgentKey,
  type AgentItemId,
} from '@vda/contracts';
import { fail } from '../errors';

/** Legacy runtime labels are accepted only while reading stored activities. Public routes use AgentKeySchema. */
export function canonicalStoredAgent(value: unknown): AgentKey | null {
  const alias =
    value === 'orchestrator' || value === 'main'
      ? 'coordinator'
      : value === 'compare'
        ? 'comparison'
        : value;
  const parsed = AgentKeySchema.safeParse(alias);
  return parsed.success ? parsed.data : null;
}

export function acceptedRecipient(
  payload: unknown,
  fallbackSender?: unknown,
): {
  agent: AgentKey;
  placement: 'accepted_request' | 'sender' | 'historical_default';
} {
  if (payload && typeof payload === 'object') {
    const turn = (payload as Record<string, unknown>).agent_turn;
    if (turn && typeof turn === 'object') {
      const request = (turn as Record<string, unknown>).request;
      if (request && typeof request === 'object') {
        const raw = (request as Record<string, unknown>).agent_target;
        if (raw === null || raw === undefined)
          return { agent: 'coordinator', placement: 'accepted_request' };
        const agent = canonicalStoredAgent(raw);
        if (agent) return { agent, placement: 'accepted_request' };
      }
    }
  }
  const sender = canonicalStoredAgent(fallbackSender);
  return sender
    ? { agent: sender, placement: 'sender' }
    : { agent: 'coordinator', placement: 'historical_default' };
}

export type AgentCursorScope = {
  org: string;
  conversation: string;
  agent: AgentKey;
};
export type AgentCursorTuple = {
  timestamp: string;
  rank: 0 | 1;
  id: string;
};
export type AgentCursorDirection = 'older' | 'newer';
type EncodedCursor = AgentCursorScope &
  AgentCursorTuple & { v: 1; direction: AgentCursorDirection };

// Keep the database's timestamp text verbatim. Date/ISOString would truncate microseconds.
const preciseTimestamp =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
function validTuple(value: AgentCursorTuple): boolean {
  return (
    preciseTimestamp.test(value.timestamp) &&
    !Number.isNaN(Date.parse(value.timestamp)) &&
    (value.rank === 0 || value.rank === 1) &&
    IdSchema.safeParse(value.id).success
  );
}
export function encodeAgentCursor(
  scope: AgentCursorScope,
  direction: AgentCursorDirection,
  tuple: AgentCursorTuple,
): string {
  if (!validTuple(tuple)) fail('INVALID_CURSOR', 422);
  const value: EncodedCursor = { v: 1, ...scope, direction, ...tuple };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decodeAgentCursor(
  value: string | null | undefined,
  scope: AgentCursorScope,
  direction: AgentCursorDirection,
): AgentCursorTuple | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<EncodedCursor>;
    if (
      parsed.v !== 1 ||
      parsed.org !== scope.org ||
      parsed.conversation !== scope.conversation ||
      parsed.agent !== scope.agent ||
      parsed.direction !== direction ||
      !validTuple(parsed as AgentCursorTuple)
    )
      fail('INVALID_CURSOR', 422);
    return { timestamp: parsed.timestamp!, rank: parsed.rank!, id: parsed.id! };
  } catch {
    fail('INVALID_CURSOR', 422);
  }
}

export function decodeScopedAgentCursor(
  value: string,
  scope: AgentCursorScope,
): AgentCursorTuple & { direction: AgentCursorDirection } {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<EncodedCursor>;
    if (parsed.direction !== 'older' && parsed.direction !== 'newer') fail('INVALID_CURSOR', 422);
    const tuple = decodeAgentCursor(value, scope, parsed.direction);
    if (!tuple) fail('INVALID_CURSOR', 422);
    return { ...tuple, direction: parsed.direction };
  } catch {
    fail('INVALID_CURSOR', 422);
  }
}

export function parseAgentItemId(value: string): { source: 'message' | 'activity'; id: string } {
  const parsed = AgentItemIdSchema.safeParse(value);
  if (!parsed.success) fail('INVALID_ITEM_ID', 422);
  const [source, id] = parsed.data.split(':');
  return { source: source as 'message' | 'activity', id: id! };
}
export function agentItemId(source: 'message' | 'activity', id: string): AgentItemId {
  return AgentItemIdSchema.parse(`${source}:${id}`);
}
