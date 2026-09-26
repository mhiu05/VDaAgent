/** A read-only subscription. Disconnecting never cancels the durable worker. */
export type DurableEventStreamOptions<S, E extends { sequence: number }> = {
  initial: S;
  load: (after: number) => Promise<S>;
  events: (snapshot: S) => readonly E[];
  terminal: (snapshot: S) => Record<string, unknown> | null;
  eventName: 'runtime' | 'execution';
  signal: AbortSignal;
  after: number;
  pollMs?: number;
  heartbeatMs?: number;
  lifetimeMs?: number;
};

const encoder = new TextEncoder();

export function durableEventStream<S, E extends { sequence: number }>(
  options: DurableEventStreamOptions<S, E>,
): Response {
  let cursor = options.after;
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let previousSnapshot = '';

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearTimeout(lifetime);
    clearInterval(heartbeat);
    options.signal.removeEventListener('abort', close);
    try { controller?.close(); } catch { /* Already disconnected. */ }
  }

  function write(event: string, value: unknown, sequence?: number) {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(
        `event: ${event}\n${sequence === undefined ? '' : `id: ${sequence}\n`}data: ${JSON.stringify(value)}\n\n`,
      ));
    } catch { close(); }
  }

  async function publish(snapshot: S) {
    if (closed) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized !== previousSnapshot) {
      write('snapshot', snapshot);
      previousSnapshot = serialized;
    }
    const events = [...options.events(snapshot)].sort((left, right) => left.sequence - right.sequence);
    let advanced = false;
    for (const event of events) {
      if (event.sequence <= cursor) continue;
      write(options.eventName, event, event.sequence);
      cursor = event.sequence;
      advanced = true;
    }
    // Read once more after any page, including a terminal page. This drains
    // bounded database pages before closing and cannot lose the tail of a run.
    const terminal = options.terminal(snapshot);
    if (terminal && !advanced) {
      write('terminal', terminal);
      close();
      return;
    }
    timer = setTimeout(poll, advanced ? 0 : (options.pollMs ?? 750));
  }

  async function poll() {
    if (closed) return;
    if ((controller.desiredSize ?? 0) < 0) {
      timer = setTimeout(poll, options.pollMs ?? 750);
      return;
    }
    try { await publish(await options.load(cursor)); }
    catch {
      // Authorization is checked by every repository read. Never serialize an
      // internal exception or continue serving after membership is revoked.
      write('stream_error', { code: 'STREAM_UNAVAILABLE' });
      close();
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      if (options.signal.aborted) { close(); return; }
      options.signal.addEventListener('abort', close, { once: true });
      controller.enqueue(encoder.encode('retry: 1000\n: connected\n\n'));
      heartbeat = setInterval(() => {
        if (closed || (controller.desiredSize ?? 0) < 0) return;
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { close(); }
      }, options.heartbeatMs ?? 15_000);
      // Short-lived HTTP streams reconnect from their persisted event cursor.
      lifetime = setTimeout(close, options.lifetimeMs ?? 55_000);
      void publish(options.initial);
    },
    cancel: close,
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
