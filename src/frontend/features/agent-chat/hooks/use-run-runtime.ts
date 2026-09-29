import { useEffect, useRef, useState } from 'react';
import { RunSchema, RuntimeActivityEventSchema, type AnalysisRun } from '@vda/contracts';
import { ApiError, errorMessage, scoped } from '../../../lib/http/api-client';
import { readSse } from '../../../lib/sse';
import { getRunRuntime, RuntimeSnapshotSchema, type RuntimeSnapshot } from '../api/runtime';
import {
  applyRuntimeEvent,
  emptyRuntimeReconciliation,
  installRuntimeSnapshot,
} from '../runtime-reconciliation';

const empty: RuntimeSnapshot = { records: [], events: [], last_sequence: 0 };

/** A browser subscribes to persisted work; disconnecting never cancels that work. */
export function useRunRuntime(
  orgId: string,
  runId: string | null,
  sseEnabled: boolean,
  active: boolean,
  onRunUpdate?: (run: AnalysisRun) => void,
) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(empty);
  const [connection, setConnection] = useState<'loading' | 'live' | 'reconnecting' | 'idle'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const onRunUpdateRef = useRef(onRunUpdate);
  useEffect(() => {
    onRunUpdateRef.current = onRunUpdate;
  }, [onRunUpdate]);
  useEffect(() => {
    setSnapshot(empty);
    setError(null);
    if (!runId) {
      setConnection('idle');
      return;
    }
    let disposed = false;
    let runtimeState = emptyRuntimeReconciliation();
    let requestGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const refresh = async () => {
      const generation = ++requestGeneration;
      const next = await getRunRuntime(orgId, runId, runtimeState.deliveredSequence);
      if (disposed || generation !== requestGeneration) return;
      runtimeState = installRuntimeSnapshot(runtimeState, next);
      setSnapshot(runtimeState.view);
    };
    const connect = async () => {
      if (disposed) return;
      setConnection(runtimeState.deliveredSequence ? 'reconnecting' : 'loading');
      try {
        await refresh();
        if (disposed) return;
        setError(null);
        if (!active) {
          setConnection('idle');
          return;
        }
        if (!sseEnabled) {
          setConnection('live');
          timer = setTimeout(() => void connect(), document.hidden ? 5000 : 1500);
          return;
        }
        const response = await fetch(
          `/api${scoped(`/runs/${runId}/events?after=${runtimeState.deliveredSequence}`, orgId)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: abort.signal,
            headers: {
              Accept: 'text/event-stream',
              'Last-Event-ID': String(runtimeState.deliveredSequence),
            },
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new ApiError('Không thể kết nối luồng cập nhật phân tích.', response.status);
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          throw new Error('Luồng cập nhật phân tích không hợp lệ.');
        }
        setConnection('live');
        let terminal = false;
        let sawSnapshot = false;
        await readSse(
          response,
          (frame) => {
            if (disposed) return;
            if (frame.event === 'snapshot') {
              const value = JSON.parse(frame.data) as { runtime?: unknown; run?: unknown };
              const run = RunSchema.safeParse(value.run);
              if (run.success && run.data.run_id === runId && run.data.org_id === orgId)
                onRunUpdateRef.current?.(run.data);
              const parsed = RuntimeSnapshotSchema.safeParse(value.runtime);
              if (parsed.success) {
                sawSnapshot = true;
                runtimeState = installRuntimeSnapshot(runtimeState, parsed.data);
                setSnapshot(runtimeState.view);
              }
            } else if (frame.event === 'runtime') {
              const parsed = RuntimeActivityEventSchema.parse(JSON.parse(frame.data));
              if (parsed.run_id !== runId) return;
              runtimeState = applyRuntimeEvent(runtimeState, parsed);
              setSnapshot(runtimeState.view);
              if (runtimeState.view.snapshot_sequence === undefined && !refreshTimer)
                refreshTimer = setTimeout(() => {
                  refreshTimer = undefined;
                  void refresh();
                }, 80);
            } else if (frame.event === 'terminal') terminal = true;
          },
          2_000_000,
        );
        if (disposed) return;
        if (terminal) {
          if (!sawSnapshot) await refresh();
          setConnection('idle');
          setError(null);
          return;
        }
        await refresh();
        throw new Error(
          'Kết nối cập nhật bị gián đoạn. Đang kết nối lại với lượt phân tích đã lưu.',
        );
      } catch (cause) {
        if (disposed) return;
        setError(errorMessage(cause));
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          setSnapshot(empty);
          setConnection('idle');
          return;
        }
        setConnection('reconnecting');
        timer = setTimeout(() => void connect(), 2500);
      }
    };
    void connect();
    return () => {
      disposed = true;
      abort.abort();
      if (timer) clearTimeout(timer);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [orgId, runId, sseEnabled, active]);
  return { snapshot, connection, error };
}
