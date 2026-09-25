import type { AnalysisRun } from '@vda/contracts/analysis/run';
import type { Artifact, ArtifactOf } from '@vda/contracts/artifacts/artifact';
import { canonical, stableId, verifyArtifact } from '../artifacts/integrity';
import { validateReport } from '../reports/report-validation';
import {
  AgentWorkflowValidationError,
  sameIds,
  artifactMap,
  requiredArtifact,
  singleInputOfKind,
  validatePersistedKeys,
} from './artifact-graph';
import { validateReportDraftArtifact, validateReviewResultArtifact } from './draft';

/**
 * Atomic publication uses this gate after re-reading the graph under a fence.
 * A valid schema alone never turns a review into PASS.
 */
export function validateAgentPublication(
  draft: ArtifactOf<'report_draft'>,
  review: ArtifactOf<'review_result'>,
  report: ArtifactOf<'report'>,
  persistedArtifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  if (run.workflow_version !== 'agent-v1')
    throw new AgentWorkflowValidationError('AGENT_PUBLICATION_NOT_SELECTED');
  const graph = [...persistedArtifacts, report];
  const graphKeys = artifactKeys
    ? new Map([...artifactKeys, [report.artifact_id, 'report']])
    : undefined;
  validateReportDraftArtifact(draft, persistedArtifacts, run, artifactKeys);
  validateReviewResultArtifact(review, draft, persistedArtifacts, run, artifactKeys);
  if (review.payload.status !== 'PASS')
    throw new AgentWorkflowValidationError('REVIEW_PASS_REQUIRED');
  verifyArtifact(report);
  validatePersistedKeys(graph, run, graphKeys);
  if (
    report.artifact_id !== stableId(`${run.run_id}:artifact:report`) ||
    report.task_id !== stableId(`${run.run_id}:task:publication`) ||
    report.created_at !== run.created_at ||
    report.org_id !== run.org_id ||
    report.run_id !== run.run_id ||
    report.data_as_of !== run.request.data_as_of ||
    report.semantic_version !== draft.semantic_version ||
    canonical(report.payload) !== canonical(draft.payload.report) ||
    !sameIds(report.snapshot_refs, draft.snapshot_refs) ||
    !sameIds(report.source_refs, draft.source_refs) ||
    !sameIds(report.limitations, draft.payload.report.limitations)
  )
    throw new AgentWorkflowValidationError('INVALID_PUBLICATION_REPORT');
  const byId = artifactMap(persistedArtifacts);
  const insightPack = requiredArtifact(
    byId,
    draft.payload.insight_pack_artifact_id,
    'insight_pack',
  );
  const insight = singleInputOfKind(insightPack, byId, 'insight');
  const expectedInputs = [
    draft.payload.report.calculation_artifact_id,
    draft.payload.report.chart_artifact_id,
    draft.payload.report.comparison_artifact_id,
    insight?.artifact_id ?? '',
    ...(draft.payload.decision_intelligence_artifact_id
      ? [draft.payload.decision_intelligence_artifact_id]
      : []),
  ];
  if (!sameIds(report.input_refs, expectedInputs))
    throw new AgentWorkflowValidationError('INVALID_PUBLICATION_LINEAGE');
  validateReport(report.payload, graph, run.org_id, run.run_id);
}
