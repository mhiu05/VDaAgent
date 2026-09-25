import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArtifactListSchema, RunDetailSchema } from '@vda/contracts';
import { getRunEvidence } from '../api/run-evidence';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;

export function useEvidenceRun(orgId: string, activeRunId: string | null) {
  const [runDetail, setRunDetail] = useState<{ runId: string; data: RunDetail } | null>(null);
  const [artifacts, setArtifacts] = useState<{ runId: string; data: ArtifactList } | null>(null);
  const [unavailableRunId, setUnavailableRunId] = useState<string | null>(null);
  const [unavailableArtifactsRunId, setUnavailableArtifactsRunId] = useState<string | null>(null);
  useEffect(() => {
    const runId = activeRunId;
    if (!runId) {
      setRunDetail(null);
      setArtifacts(null);
      setUnavailableRunId(null);
      setUnavailableArtifactsRunId(null);
      return;
    }

    let obsolete = false;
    setRunDetail(null);
    setArtifacts(null);
    setUnavailableRunId(null);
    setUnavailableArtifactsRunId(null);

    void getRunEvidence(orgId, runId)
      .then(([detail, bundle]) => {
        if (obsolete) return;
        if (detail.run.run_id !== runId) {
          setUnavailableRunId(runId);
          return;
        }
        setRunDetail({ runId, data: detail });
        if (bundle) setArtifacts({ runId, data: bundle });
        else setUnavailableArtifactsRunId(runId);
      })
      .catch(() => {
        if (!obsolete) setUnavailableRunId(runId);
      });

    return () => {
      obsolete = true;
    };
  }, [activeRunId, orgId]);

  const activeRunDetail = runDetail?.runId === activeRunId ? (runDetail.data ?? null) : null;
  const activeArtifacts = artifacts?.runId === activeRunId ? (artifacts.data ?? null) : null;
  const unavailable = unavailableRunId === activeRunId;
  const artifactsUnavailable = unavailableArtifactsRunId === activeRunId;
  return { activeRunDetail, activeArtifacts, unavailable, artifactsUnavailable };
}
