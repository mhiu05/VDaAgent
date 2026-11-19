import type { MockReadOptions } from '../../features/reports/model/types';

/** Adapter-local runtime; replace its binding after the shared mock context is frozen. */
export async function mockRead(options: MockReadOptions, operation: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const delay = typeof options.latencyMs === 'function' ? options.latencyMs(operation) : options.latencyMs ?? 0;
  if (delay > 0) await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
  signal?.throwIfAborted();
  const error = options.fail?.(operation);
  if (error) throw error;
}
