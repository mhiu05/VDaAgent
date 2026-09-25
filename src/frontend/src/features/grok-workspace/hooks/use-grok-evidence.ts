import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArtifactListSchema } from '@vda/contracts';
import { getRunArtifacts } from '../../analysis/api/run-data';
import type { WorkspaceContextState } from '../../workspace/context';

type ArtifactList = z.infer<typeof ArtifactListSchema>;

export function useGrokEvidence(orgId: string, workspaceState: WorkspaceContextState) {
  const [evidenceBundle, setEvidenceBundle] = useState<ArtifactList | null>(null);
  useEffect(() => {
    const runId = workspaceState.active_run_id;
    const artifactId = workspaceState.active_artifact_id;
    if (!runId || !artifactId) {
      setEvidenceBundle(null);
      return;
    }
    let obsolete = false;
    setEvidenceBundle(null);
    void getRunArtifacts(orgId, runId)
      .then((bundle) => {
        if (!obsolete) setEvidenceBundle(bundle);
      })
      .catch(() => {
        if (!obsolete) setEvidenceBundle(null);
      });
    return () => {
      obsolete = true;
    };
  }, [orgId, workspaceState.active_artifact_id, workspaceState.active_run_id]);

  const selectedEvidence = evidenceBundle?.artifacts.find(
    (artifact) => artifact.artifact_id === workspaceState.active_artifact_id,
  );

  return { selectedEvidence, evidenceBundle };
}
