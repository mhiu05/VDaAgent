import { useEffect, useState } from 'react';
import { RuntimeActivityEventSchema } from '@vda/contracts';
import { ApiError, errorMessage, scoped } from '../../../lib/http/api-client';
import { readSse } from '../../../lib/sse';
import { getRunRuntime, RuntimeSnapshotSchema, type RuntimeSnapshot } from '../api/runtime';

const empty: RuntimeSnapshot = { records: [], events: [], last_sequence: 0 };

/** A browser subscribes to persisted work; disconnecting never cancels that work. */
export function useRunRuntime(orgId: string, runId: string | null, sseEnabled: boolean, active: boolean) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(empty);
  const [connection, setConnection] = useState<'loading' | 'live' | 'reconnecting' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSnapshot(empty);
    setError(null);
    if (!runId) { setConnection('idle'); return; }
    let disposed = false;
    let lastSequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const refresh = async () => {
      const next = await getRunRuntime(orgId, runId);
      if (!disposed && next.last_sequence >= lastSequence) {
        lastSequence = next.last_sequence;
        setSnapshot(next);
      }
    };
    const connect = async () => {
      if (disposed) return;
      setConnection(lastSequence ? 'reconnecting' : 'loading');
      try {
        await refresh();
        if (disposed) return;
        setError(null);
        if (!active) { setConnection('idle'); return; }
        if (!sseEnabled) {
          setConnection('live');
          timer = setTimeout(() => void connect(), document.hidden ? 5000 : 1500);
          return;
        }
        const response = await fetch(`/api/v1${scoped(`/runs/${runId}/events?after=${lastSequence}`, orgId)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(lastSequence) },
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ApiError('Runtime stream is unavailable.', response.status);
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          throw new Error('Invalid runtime stream.');
        }
        setConnection('live');
        let terminal = false;
        await readSse(response, (frame) => {
          if (disposed) return;
          if (frame.event === 'snapshot') {
            const value = JSON.parse(frame.data) as { runtime?: unknown };
            const parsed = RuntimeSnapshotSchema.safeParse(value.runtime);
            if (parsed.success && parsed.data.last_sequence >= lastSequence) {
              lastSequence = parsed.data.last_sequence;
              setSnapshot(parsed.data);
            }
          } else if (frame.event === 'runtime') {
            const parsed = RuntimeActivityEventSchema.parse(JSON.parse(frame.data));
            if (parsed.run_id !== runId || parsed.sequence <= lastSequence) return;
            lastSequence = parsed.sequence;
            setSnapshot((current) => ({
              records: current.records.some((record) => record.activity_id === parsed.record.activity_id)
                ? current.records.map((record) => record.activity_id === parsed.record.activity_id ? parsed.record : record)
                : [...current.records, parsed.record],
              events: [...current.events, parsed].slice(-100),
              last_sequence: parsed.sequence,
            }));
          } else if (frame.event === 'terminal') terminal = true;
        }, 2_000_000);
        if (disposed) return;
        await refresh();
        if (terminal) { setConnection('idle'); return; }
        throw new Error('Runtime connection interrupted. Reconnecting to saved execution.');
      } catch (cause) {
        if (disposed) return;
        setError(errorMessage(cause));
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          setSnapshot(empty); setConnection('idle'); return;
        }
        setConnection('reconnecting');
        timer = setTimeout(() => void connect(), 2500);
      }
    };
    void connect();
    return () => { disposed = true; abort.abort(); if (timer) clearTimeout(timer); };
  }, [orgId, runId, sseEnabled, active]);
  return { snapshot, connection, error };
}
