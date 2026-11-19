/** One SSE connection per tab on `/api/stream` (doc 14 "Realtime"). No replay: on reconnect the
 * browser's EventSource retries and subscribers re-read their data; `open` fires on every
 * (re)connect with the number of opens so far, so `> 1` means a reconnect. A non-200 response
 * (the 401 before login) closes the browser's EventSource for good, so a closed source is
 * replaced after `retryMs` and the tracked event types are re-attached. The server binds a stream
 * to the user whose cookie opened it, so a login or logout in this tab calls `restart`. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  readonly readyState: number;
}
export type EventSourceFactory = (url: string) => EventSourceLike;
type Listener = (data: unknown) => void;

export interface Realtime {
  on(type: string, listener: Listener): () => void;
  /** Drop the current stream and open a new one (keeps listeners; counts as a reconnect). */
  restart(): void;
  stop(): void;
}

export function createRealtime(url: string, factory: EventSourceFactory, retryMs = 1000): Realtime {
  const listeners = new Map<string, Set<Listener>>();
  const attached = new Set<string>();
  let source: EventSourceLike | null = null;
  let opens = 0;
  let retry: number | undefined;

  function dispatch(type: string, event: MessageEvent) {
    if (type === "open") {
      opens += 1;
      listeners.get(type)?.forEach((fn) => fn(opens));
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    listeners.get(type)?.forEach((fn) => fn(data));
  }

  function wire(opened: EventSourceLike, type: string) {
    if (attached.has(type)) return;
    attached.add(type);
    // a replaced stream (restart) belonged to the previous session: drop anything it still says
    opened.addEventListener(type, (event) => { if (source === opened) dispatch(type, event); });
  }

  function connect() {
    const opened = factory(url);
    source = opened;
    attached.clear();
    wire(opened, "open");
    for (const type of listeners.keys()) wire(opened, type);
    opened.addEventListener("error", () => {
      if (opened.readyState !== 2 || source !== opened) return;
      source = null;
      if (listeners.size && retry === undefined)
        retry = window.setTimeout(() => {
          retry = undefined;
          if (!source && listeners.size) connect();
        }, retryMs);
    });
  }

  return {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      if (source) wire(source, type);
      else if (retry === undefined) connect();
      return () => {
        listeners.get(type)?.delete(listener);
      };
    },
    restart() {
      source?.close();
      source = null;
      clearTimeout(retry);
      retry = undefined;
      if (listeners.size) connect();
    },
    stop() {
      source?.close();
      source = null;
      listeners.clear();
      attached.clear();
      clearTimeout(retry);
      retry = undefined;
      opens = 0;
    },
  };
}

export const browserEventSource: EventSourceFactory = (url) =>
  new EventSource(url, { withCredentials: true });
