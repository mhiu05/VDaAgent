import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  MessageSchema,
  RunDetailSchema,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
} from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import {
  getRunArtifacts,
  getRunBrief,
  getRunDecision,
  getRunDetail,
  getRunMessages,
} from '../api/run-data';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;

export function useAnalysisRun(orgId: string, onError: (message: string) => void) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<z.infer<typeof MessageSchema>[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [bundle, setBundle] = useState<ArtifactList>({
    artifacts: [],
    validations: [],
    sources: [],
  });
  const [brief, setBrief] = useState<DecisionBriefResponse | null>(null);
  const [decision, setDecision] = useState<DecisionIntelligenceResponse | null>(null);
  const [briefStatus, setBriefStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>(
    'idle',
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  useEffect(() => {
    if (!runId) return;
    const pollingRunId = runId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const detail = await getRunDetail(orgId, pollingRunId);
        if (cancelled) return;
        setRunDetail(detail);
        const conversation = detail.run.request.conversation_id;
        if (conversation) {
          const value = await getRunMessages(orgId, conversation);
          if (cancelled) return;
          setMessages(value.messages);
          setConversationId(conversation);
        }
        if (detail.run.status === 'succeeded') {
          if (!cancelled) setBriefStatus('loading');
          try {
            const nextDecision = await getRunDecision(orgId, pollingRunId);
            if (!cancelled) setDecision(nextDecision);
            if (nextDecision.status === 'available') {
              if (!cancelled) setBriefStatus('available');
              return;
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
          }
          try {
            const nextBrief = await getRunBrief(orgId, pollingRunId);
            if (!cancelled) {
              setBrief(nextBrief);
              setBriefStatus('available');
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
            if (!cancelled) setBriefStatus('unavailable');
            const nextBundle = await getRunArtifacts(orgId, pollingRunId);
            if (!cancelled) setBundle(nextBundle);
          }
        } else if (['failed', 'cancelled'].includes(detail.run.status)) {
          if (!cancelled) setBriefStatus('unavailable');
          const nextBundle = await getRunArtifacts(orgId, pollingRunId);
          if (!cancelled) setBundle(nextBundle);
        } else if (!cancelled) timer = setTimeout(() => void poll(), 1100);
      } catch (cause) {
        if (!cancelled) onError(errorMessage(cause));
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, orgId, pollEpoch, onError]);
  async function loadRunArtifacts() {
    if (!runId || bundle.artifacts.length || detailsLoading) return;
    setDetailsLoading(true);
    try {
      setBundle(await getRunArtifacts(orgId, runId));
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setDetailsLoading(false);
    }
  }
  return {
    conversationId,
    setConversationId,
    messages,
    setMessages,
    runId,
    setRunId,
    runDetail,
    setRunDetail,
    bundle,
    setBundle,
    brief,
    setBrief,
    decision,
    setDecision,
    briefStatus,
    setBriefStatus,
    detailsLoading,
    setDetailsLoading,
    setPollEpoch,
    loadRunArtifacts,
  };
}
