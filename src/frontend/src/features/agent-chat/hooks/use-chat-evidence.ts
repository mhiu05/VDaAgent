import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { z } from 'zod';
import { ArtifactListSchema, RunDetailSchema } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { getRunArtifacts } from '../../analysis/api/run-data';

type ArtifactList = z.infer<typeof ArtifactListSchema>;
type RunDetail = z.infer<typeof RunDetailSchema>;

export function useChatEvidence({
  orgId,
  visibleRunId,
  currentRunDetail,
  bundle,
  setBundle,
  onError,
}: {
  orgId: string;
  visibleRunId: string | null | undefined;
  currentRunDetail: RunDetail | null;
  bundle: ArtifactList;
  setBundle: Dispatch<SetStateAction<ArtifactList>>;
  onError: (message: string) => void;
}) {
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const selection = useRef(`${orgId}:${visibleRunId ?? ''}`);
  useEffect(() => { selection.current = `${orgId}:${visibleRunId ?? ''}`; }, [orgId, visibleRunId]);
  const selectedArtifact = useMemo(
    () =>
      currentRunDetail
        ? bundle.artifacts.find((artifact) => artifact.artifact_id === evidenceId)
        : undefined,
    [bundle.artifacts, currentRunDetail, evidenceId],
  );

  async function loadRunArtifacts() {
    if (!visibleRunId || !currentRunDetail || bundle.artifacts.length || detailsLoading) return;
    setDetailsLoading(true);
    const requestSelection = selection.current;
    try {
      const artifacts = await getRunArtifacts(orgId, visibleRunId);
      if (selection.current === requestSelection) setBundle(artifacts);
    } catch (cause) {
      if (selection.current === requestSelection) onError(errorMessage(cause));
    } finally {
      if (selection.current === requestSelection) setDetailsLoading(false);
    }
  }

  async function openEvidence(id: string, artifactRunId = visibleRunId) {
    if (artifactRunId !== visibleRunId) {
      // The selected-run resource will hydrate the new run after navigation.
      setEvidenceId(id);
      return;
    }
    if (!bundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
      if (!artifactRunId) return;
      setDetailsLoading(true);
      const requestSelection = selection.current;
      try {
        const artifacts = await getRunArtifacts(orgId, artifactRunId);
        if (selection.current !== requestSelection) return;
        setBundle(artifacts);
        if (!artifacts.artifacts.some((artifact) => artifact.artifact_id === id)) {
          onError('The referenced evidence artifact is unavailable for this run.');
          return;
        }
      } catch (cause) {
        if (selection.current === requestSelection) onError(errorMessage(cause));
        return;
      } finally {
        if (selection.current === requestSelection) setDetailsLoading(false);
      }
    }
    setEvidenceId(id);
  }

  return {
    detailsLoading,
    setDetailsLoading,
    evidenceId,
    setEvidenceId,
    selectedArtifact,
    loadRunArtifacts,
    openEvidence,
  };
}
