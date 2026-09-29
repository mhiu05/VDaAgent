import {
  AgentActivityEventV1Schema,
  AgentRuntimeErrorCodeSchema,
  AgentTurnStreamEventV1Schema,
  type AgentActivityEventV1,
  type AgentTurnAccepted,
} from '@vda/contracts';

const encoder = new TextEncoder();
const sseHeaders = {
  'Cache-Control': 'private, no-store, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff',
};

export type AgentTurnStreamOptions = {
  execute: (
    activitySink: (event: AgentActivityEventV1) => void,
    signal: AbortSignal,
  ) => Promise<AgentTurnAccepted>;
  requestSignal: AbortSignal;
};

function frame(event: 'activity' | 'terminal', value: unknown) {
  const parsed = AgentTurnStreamEventV1Schema.parse(value);
  return encoder.encode(
    'event: ' +
      event +
      '\n' +
      'id: ' +
      parsed.sequence +
      '\n' +
      'data: ' +
      JSON.stringify(parsed) +
      '\n\n',
  );
}

/**
 * The stream is presentation-only, but it must not erase a normalized
 * runtime result that JSON callers receive. Parse the code through the same
 * closed public enum; arbitrary thrown values remain a generic provider
 * failure and are never serialized.
 */
function publicErrorCode(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return 'TURN_CANCELLED' as const;
  const candidate =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return AgentRuntimeErrorCodeSchema.safeParse(candidate).data ?? 'PROVIDER_UNAVAILABLE';
}

/**
 * Creates a short-lived, fetch-compatible event stream for one idempotent
 * turn. The runtime owns persistence; this stream is only a best-effort view
 * over its safe activity projection and terminal accepted state.
 */
export function agentTurnStream(options: AgentTurnStreamOptions): Response {
  const cancellation = new AbortController();
  const onRequestAbort = () => cancellation.abort(options.requestSignal.reason);
  options.requestSignal.addEventListener('abort', onRequestAbort, { once: true });
  const signal = AbortSignal.any([options.requestSignal, cancellation.signal]);
  let closed = false;
  let sequence = -1;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  function close() {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    options.requestSignal.removeEventListener('abort', onRequestAbort);
    try {
      controller?.close();
    } catch {
      // A disconnected client has already closed the response body.
    }
  }

  function write(event: 'activity' | 'terminal', value: unknown) {
    if (closed || !controller) return false;
    try {
      controller.enqueue(frame(event, value));
      return true;
    } catch {
      cancellation.abort();
      close();
      return false;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      try {
        controller.enqueue(encoder.encode(': connected\n\n'));
      } catch {
        cancellation.abort();
        close();
        return;
      }
      keepalive = setInterval(() => {
        if (closed || !controller) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          cancellation.abort();
          close();
        }
      }, 15_000);

      const emitActivity = (activity: AgentActivityEventV1) => {
        const parsedActivity = AgentActivityEventV1Schema.safeParse(activity);
        if (!parsedActivity.success || parsedActivity.data.sequence <= sequence) return;
        sequence = parsedActivity.data.sequence;
        write('activity', {
          version: 'agent-turn-stream-v1',
          sequence,
          type: 'activity',
          activity: parsedActivity.data,
        });
      };

      void options
        .execute(emitActivity, signal)
        .then((accepted) => {
          if (closed) return;
          write('terminal', {
            version: 'agent-turn-stream-v1',
            sequence: sequence + 1,
            type: 'terminal',
            accepted,
            error_code: null,
          });
          close();
        })
        .catch((error) => {
          if (closed) return;
          write('terminal', {
            version: 'agent-turn-stream-v1',
            sequence: sequence + 1,
            type: 'terminal',
            accepted: null,
            error_code: publicErrorCode(error, signal),
          });
          close();
        });
    },
    cancel() {
      cancellation.abort();
      close();
    },
  });
  return new Response(stream, { status: 202, headers: sseHeaders });
}
