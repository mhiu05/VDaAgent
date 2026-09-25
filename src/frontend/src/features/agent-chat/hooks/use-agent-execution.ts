import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { getAgentTurnJob, getConversationAgentTurnJob, type AgentTurnJobSnapshot } from '../api/conversations';

const active = new Set(['queued','running','waiting']);

export function useAgentExecution(orgId: string, conversationId: string | null, acceptedJobId: string | null = null) {
  const [snapshot, setSnapshot] = useState<AgentTurnJobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          setSnapshot(next);
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
