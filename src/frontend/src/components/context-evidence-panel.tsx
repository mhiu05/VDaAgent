'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArtifactListSchema, RunDetailSchema } from '@vda/contracts';
import { api, scoped } from '../lib/client-api';
import { capabilityLabel } from './capability-rail';
import type { WorkspaceContextState } from './workspace-context';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;

export function ContextEvidencePanel({
  orgId,
  organizationName,
  context,
  onClearStaleNotice,
}: {
  orgId: string;
  organizationName: string;
  context: WorkspaceContextState;
  onClearStaleNotice: () => void;
}) {
  const [runDetail, setRunDetail] = useState<{ runId: string; data: RunDetail } | null>(null);
  const [artifacts, setArtifacts] = useState<{ runId: string; data: ArtifactList } | null>(null);
  const [unavailableRunId, setUnavailableRunId] = useState<string | null>(null);

  useEffect(() => {
    const runId = context.active_run_id;
    if (!runId) {
      setRunDetail(null);
      setArtifacts(null);
      setUnavailableRunId(null);
      return;
    }
    let obsolete = false;
    setRunDetail(null);
    setArtifacts(null);
    setUnavailableRunId(null);
    void api(scoped('/runs/' + runId, orgId), RunDetailSchema)
      .then(async (detail) => {
        const bundle = context.active_artifact_id
          ? await api(scoped('/runs/' + runId + '/artifacts', orgId), ArtifactListSchema)
          : null;
        if (obsolete) return;
        if (detail.run.run_id !== runId) {
          setUnavailableRunId(runId);
          return;
        }
        setRunDetail({ runId, data: detail });
        setArtifacts(bundle ? { runId, data: bundle } : null);
      })
      .catch(() => {
        if (!obsolete) setUnavailableRunId(runId);
      });
    return () => {
      obsolete = true;
    };
  }, [context.active_artifact_id, context.active_run_id, orgId]);

  const activeRunDetail =
    runDetail?.runId === context.active_run_id ? (runDetail.data ?? null) : null;
  const activeArtifacts =
    artifacts?.runId === context.active_run_id ? (artifacts.data ?? null) : null;
  const unavailable = unavailableRunId === context.active_run_id;
  const artifact = context.active_artifact_id
    ? (activeArtifacts?.artifacts.find((item) => item.artifact_id === context.active_artifact_id) ??
      null)
    : null;
  const validation = artifact
    ? (activeArtifacts?.validations.find((item) => item.artifact_id === artifact.artifact_id) ??
      null)
    : null;

  return (
    <aside className="context-evidence-panel card" aria-label="Context and evidence">
      <header className="section-heading">
        <div>
          <span className="eyebrow">SELECTED CONTEXT</span>
          <h2>Context &amp; evidence</h2>
        </div>
        <span className="badge">{capabilityLabel(context.mode)}</span>
      </header>
      {context.stale_selection_cleared && (
        <div className="notice" role="status">
          <p>The prior selection belongs to a different result and was cleared.</p>
          <button className="text-button" onClick={onClearStaleNotice}>
            Dismiss
          </button>
        </div>
      )}
      <section>
        <h3>Active context</h3>
        <p>{organizationName}</p>
        <p>Capability: {capabilityLabel(context.mode)}</p>
        {activeRunDetail && (
          <p>
            {activeRunDetail.run.request.scope.project_external_id}
            {activeRunDetail.run.request.scope.zone_external_id
              ? ' / ' + activeRunDetail.run.request.scope.zone_external_id
              : ''}
            {' · '}
            {activeRunDetail.run.request.data_as_of}
          </p>
        )}
      </section>
      <section>
        <h3>Run</h3>
        {!context.active_run_id ? (
          <p className="muted">No active result.</p>
        ) : unavailable ? (
          <p className="muted">The selected result is unavailable.</p>
        ) : !activeRunDetail ? (
          <p className="muted">Loading authorized run…</p>
        ) : (
          <>
            <code>{activeRunDetail.run.run_id.slice(0, 8)}</code>
            <p>Status: {activeRunDetail.run.status}</p>
            <p>Workflow: {activeRunDetail.run.workflow_version ?? 'legacy-v1'}</p>
          </>
        )}
      </section>
      <section>
        <h3>Artifact &amp; evidence</h3>
        {!context.active_artifact_id ? (
          <p className="muted">No evidence artifact is selected.</p>
        ) : unavailable ? (
          <p className="muted">The selected artifact is unavailable.</p>
        ) : !activeArtifacts ? (
          <p className="muted">Loading authorized evidence…</p>
        ) : !artifact ? (
          <p className="muted">The selected artifact is unavailable.</p>
        ) : (
          <>
            <p>Kind: {artifact.kind}</p>
            <p>Validation: {validation?.valid ? 'validated' : 'not available'}</p>
            {context.active_evidence_ref?.evidence_path && (
              <code>{context.active_evidence_ref.evidence_path}</code>
            )}
          </>
        )}
      </section>
      <section>
        <h3>Support &amp; quality</h3>
        <p className="muted">
          The server rechecks this selection before it uses any supporting result.
        </p>
      </section>
    </aside>
  );
}
