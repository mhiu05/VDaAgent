import { z } from 'zod';
import {
  AgentActivityEventV1Schema,
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  AgentTurnStreamEventV1Schema,
  type AgentActivityEventV1,
  type AgentTurnRequest,
} from '@vda/contracts';
import { ApiError, scoped } from './http/api-client';
import { type TurnRequestIdentity } from './http/turn-identity';

const MAX_SSE_BUFFER_SIZE = 64_000;
type AgentTurnStreamTerminal = Extract<
  z.infer<typeof AgentTurnStreamEventV1Schema>,
  { type: 'terminal' }
>;

export type SseFrame = {
  event: string;
  data: string;
  id: string | null;
};

function streamError(message: string, status = 502) {
  return new ApiError(message, status);
}

function consumeFrame(block: string, onFrame: (frame: SseFrame) => void) {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? '' : line.slice(separator + (line[separator + 1] === ' ' ? 2 : 1));
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length) onFrame({ event, data: data.join('\n'), id });
}

export async function readSse(response: Response, onFrame: (frame: SseFrame) => void, maxBufferSize = MAX_SSE_BUFFER_SIZE) {
  const reader = response.body?.getReader();
  if (!reader) throw streamError('The assistant activity stream is unavailable.');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > maxBufferSize)
        throw streamError('The assistant activity stream is invalid.');
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end === -1) break;
        consumeFrame(buffer.slice(0, end), onFrame);
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, '\n');
    if (buffer.trim()) consumeFrame(buffer, onFrame);
  } catch (cause) {
    // A malformed frame or callback failure must close this HTTP subscription
    // before its caller reconnects; releasing the lock alone leaves it alive.
    try { await reader.cancel(cause); } catch { /* Preserve the original failure. */ }
    throw cause;
  } finally {
    reader.releaseLock();
  }
}

async function errorFromResponse(response: Response) {
  let value: unknown = null;
  try {
    value = await response.json();
  } catch {
    // A proxy failure may not have a JSON body. Keep the client error generic.
  }
  const problem = z
    .object({
      detail: z.string().optional(),
      title: z.string().optional(),
      run_id: z.string().optional(),
    })
    .passthrough()
    .safeParse(value);
  return new ApiError(
    problem.success
      ? (problem.data.detail ?? problem.data.title ?? 'The assistant request failed.')
      : 'The assistant request failed.',
    response.status,
    problem.success ? problem.data.run_id : undefined,
  );
}

export async function sendTurnStream(
  orgId: string,
  input: Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'>,
  identity: TurnRequestIdentity,
  onActivity: (event: AgentActivityEventV1) => void,
  conversationId?: string,
  signal?: AbortSignal,
) {
  const body = AgentTurnRequestSchema.parse({
    ...input,
    org_id: orgId,
    client_turn_id: identity.client_turn_id,
  });
  const path = conversationId
    ? '/conversations/' + conversationId + '/messages/stream'
    : '/conversations/stream';
  const response = await fetch(scoped(path, orgId), {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'Idempotency-Key': identity.idempotency_key,
    },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    throw streamError('The assistant activity stream is unavailable.');

  let sequence = -1;
  const terminal: { value: AgentTurnStreamTerminal | null } = { value: null };
  await readSse(response, (frame) => {
    let value: unknown;
    try {
      value = JSON.parse(frame.data);
    } catch {
      throw streamError('The assistant activity stream is invalid.');
    }
    const event = AgentTurnStreamEventV1Schema.safeParse(value);
    if (!event.success || frame.event !== event.data.type || event.data.sequence <= sequence)
      throw streamError('The assistant activity stream is invalid.');
    sequence = event.data.sequence;
    if (event.data.type === 'activity') {
      onActivity(AgentActivityEventV1Schema.parse(event.data.activity));
      return;
    }
    terminal.value = event.data;
  });
  const completed = terminal.value;
  if (!completed) throw streamError('The assistant activity stream ended before completion.');
  if (completed.accepted) return AgentTurnAcceptedSchema.parse(completed.accepted);
  throw streamError(
    completed.error_code === 'TURN_CANCELLED'
      ? 'The assistant request was cancelled.'
      : 'The assistant activity stream could not be completed.',
    503,
  );
}
