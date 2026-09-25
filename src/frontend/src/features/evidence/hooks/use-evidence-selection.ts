import { useState } from 'react';
import { errorMessage } from '../../../lib/http/api-client';
import { getRunArtifacts } from '../../analysis/api/run-data';
import type { useAnalysisRun } from '../../analysis/hooks/use-analysis-run';

export function useEvidenceSelection(
  orgId: string,
  runId: string | null,
  bundle: ReturnType<typeof useAnalysisRun>['bundle'],
  setBundle: ReturnType<typeof useAnalysisRun>['setBundle'],
  setDetailsLoading: ReturnType<typeof useAnalysisRun>['setDetailsLoading'],
  onError: (message: string) => void,
) {
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  async function openEvidence(id: string) {
    if (!bundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
      if (!runId) return;
      setDetailsLoading(true);
      try {
        const nextBundle = await getRunArtifacts(orgId, runId);
        setBundle(nextBundle);
        if (!nextBundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
          onError('The referenced evidence artifact is unavailable for this run.');
          return;
        }
      } catch (cause) {
        onError(errorMessage(cause));
        return;
      } finally {
        setDetailsLoading(false);
      }
    }
    setEvidenceId(id);
  }
  const selectedArtifact = bundle.artifacts.find((item) => item.artifact_id === evidenceId);
  return { evidenceId, setEvidenceId, selectedArtifact, openEvidence };
}
