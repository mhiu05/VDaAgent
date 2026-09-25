import { useState } from 'react';
import { errorMessage } from '../../../lib/http/api-client';
import { cancelAnalysisRun, createAnalysis } from '../api/run-data';

export function useLegacyAnalysisActions(
  orgId: string,
  onAccepted: (runId: string, conversationId: string) => void,
  onError: (message: string) => void,
) {
  const [busy, setBusy] = useState(false);

  async function startAnalysis(
    project: string,
    zone: string,
    dataAsOf: string,
    question: string,
    conversationId: string | null,
  ) {
    setBusy(true);
    onError('');
    try {
      const accepted = await createAnalysis(
        orgId,
        project,
        zone,
        dataAsOf,
        question,
        conversationId,
      );
      onAccepted(accepted.run_id, accepted.conversation_id);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun(runId: string) {
    setBusy(true);
    try {
      await cancelAnalysisRun(orgId, runId);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return { busy, startAnalysis, cancelRun };
}
