import { useEffect, useState } from 'react';
import { ApiError, errorMessage, scoped } from '../../../lib/http/api-client';
import { readSse } from '../../../lib/sse';
import { AgentTurnJobSnapshotSchema, getAgentTurnJob, getConversationAgentTurnJob, type AgentTurnJobSnapshot } from '../api/conversations';

const active = new Set(['queued','running','waiting']);

export function newerExecutionSnapshot(current: AgentTurnJobSnapshot | null, next: AgentTurnJobSnapshot): AgentTurnJobSnapshot {
  if (!current || current.job.job_id !== next.job.job_id) return next;
  if (!active.has(current.job.status) && active.has(next.job.status)) return current;
  const currentSequence = Math.max(0, ...current.events.map((event) => event.sequence));
  const nextSequence = Math.max(0, ...next.events.map((event) => event.sequence));
  if (nextSequence < currentSequence || next.job.updated_at < current.job.updated_at) return current;
  return next;
}

export function useAgentExecution(orgId: string, conversationId: string | null, acceptedJobId: string | null = null, sseEnabled = false) {
  const [snapshot, setSnapshot] = useState<AgentTurnJobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobId = snapshot?.job.job_id;
  useEffect(() => {
    if (!sseEnabled || !jobId || !conversationId) return;
    const abort = new AbortController();
    let disposed = false;
    let cursor = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = async () => {
      try {
        const response = await fetch(`/api/v1${scoped(`/agent-turn-jobs/${jobId}/events?after=${cursor}`, orgId)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) },
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          return;
        }
        let terminal = false;
        await readSse(response, (frame) => {
          if (disposed) return;
          if (frame.event === 'snapshot') {
            const next = AgentTurnJobSnapshotSchema.parse(JSON.parse(frame.data));
            if (next.job.conversation_id === conversationId && next.job.job_id === jobId) setSnapshot((current) => newerExecutionSnapshot(current, next));
          } else if (frame.event === 'execution') {
            const sequence = Number(frame.id);
            if (!Number.isFinite(sequence) || sequence <= cursor) return;
            cursor = sequence;
            if (!refreshTimer) refreshTimer = setTimeout(() => {
              refreshTimer = undefined;
              void getAgentTurnJob(orgId, jobId).then((next) => {
                if (!disposed && next?.job.conversation_id === conversationId) setSnapshot((current) => newerExecutionSnapshot(current, next));
              }).catch(() => { /* Existing polling owns recovery and permission errors. */ });
            }, 80);
          } else if (frame.event === 'terminal') terminal = true;
        });
        if (!disposed && !terminal) reconnectTimer = setTimeout(() => void stream(), 2000);
      } catch { if (!disposed) reconnectTimer = setTimeout(() => void stream(), 2000); }
    };
    void stream();
    return () => { disposed = true; abort.abort(); if (refreshTimer) clearTimeout(refreshTimer); if (reconnectTimer) clearTimeout(reconnectTimer); };
  }, [orgId, conversationId, jobId, sseEnabled]);
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!conversationId) { setLoading(false); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      setLoading(true);
      try {
        const next = acceptedJobId
          ? await getAgentTurnJob(orgId, acceptedJobId)
          : await getConversationAgentTurnJob(orgId, conversationId);
        if (disposed) return;
        if (next && next.job.conversation_id === conversationId && (!acceptedJobId || next.job.job_id === acceptedJobId)) {
          setSnapshot((current) => newerExecutionSnapshot(current, next));
          setError(null);
          if (active.has(next.job.status)) timer = setTimeout(() => void poll(), document.hidden ? 5000 : 1000);
        } else if (acceptedJobId) {
          setSnapshot(null);
          setError('Không tìm thấy tác vụ đã nhận. Tải lại trang để kiểm tra.');
        } else {
          setSnapshot(null);
        }
      } catch (cause) {
        if (!disposed) {
          setError(errorMessage(cause));
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.status === 404))
            setSnapshot(null);
          else
            timer = setTimeout(() => void poll(), 5000);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void poll();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [orgId,conversationId,acceptedJobId]);
  return { snapshot, setSnapshot, loading, error };
}
