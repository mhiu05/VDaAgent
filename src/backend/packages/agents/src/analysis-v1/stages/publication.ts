import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  type AnalysisRun,
  type Artifact,
  type ArtifactOf,
  type ReportRecord,
  type RunTask,
} from '@vda/contracts';
import { type Lease, type Repository } from '@vda/db';
import { validateAgentPublication } from '@vda/domain';
import { artifactHash, stableId, verifyArtifact } from '@vda/domain';
import { loadReviewStageArtifacts, type AgentReviewStageResult } from './reviewer';
import { AGENT_WORKFLOW_DAG } from '../dag';
import {
  isCurrentSuccessfulTask,
  loadStageContext,
  transitionTask,
  workflowFailureCode,
} from '../checkpoint/stage-context';

export type PublicationArtifactInput = {
  run: AnalysisRun;
  task: RunTask;
  draft: ArtifactOf<'report_draft'>;
  review: ArtifactOf<'review_result'>;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  visual_evidence: ArtifactOf<'visual_evidence'>;
  insight: ArtifactOf<'insight'>;
  decision_intelligence_pack: ArtifactOf<'decision_intelligence_pack'>;
};

/**
 * Builds the final legacy-shaped report artifact without publishing it. The
 * repository publication transaction remains the sole authority that can
 * persist it and transition the run.
 */
export function buildPublicationArtifact(input: PublicationArtifactInput): ArtifactOf<'report'> {
  const {
    run,
    task,
    draft,
    review,
    calculation,
    comparison,
    visual_evidence,
    insight,
    decision_intelligence_pack,
  } = input;
  for (const artifact of [
    draft,
    review,
    calculation,
    comparison,
    visual_evidence,
    insight,
    decision_intelligence_pack,
  ])
    verifyArtifact(artifact);
  const body = {
    artifact_id: stableId(`${run.run_id}:artifact:report`),
    org_id: run.org_id,
    run_id: run.run_id,
    task_id: task.task_id,
    kind: 'report' as const,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: run.created_at,
    semantic_version: draft.semantic_version,
    provisional: true as const,
    data_as_of: run.request.data_as_of,
    // The fenced repository transaction binds this exact draft/review pair.
    // The public report itself exposes only canonical evidence lineage, so a
    // viewer cannot discover owner/analyst-only workflow artifact identifiers.
    input_refs: [
      calculation.artifact_id,
      comparison.artifact_id,
      visual_evidence.artifact_id,
      insight.artifact_id,
      decision_intelligence_pack.artifact_id,
    ].sort(),
    snapshot_refs: [...draft.snapshot_refs].sort(),
    source_refs: [...draft.source_refs].sort(),
    limitations: [...draft.payload.report.limitations].sort(),
    payload: draft.payload.report,
  };
  const artifact = ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<'report'>;
  verifyArtifact(artifact);
  return artifact;
}

export type PublishedAgentWorkflowResult = AgentReviewStageResult & {
  report: ArtifactOf<'report'>;
  report_record: ReportRecord;
};

/**
 * The final stage builds a candidate in memory, validates it again, then asks
 * the repository to perform the only report write in one fenced transaction.
 * No provider or external call happens while that transaction is open.
 */
export async function executePublicationStage(
  repository: Repository,
  lease: Lease,
): Promise<PublishedAgentWorkflowResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'publication';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) =>
    transitionTask(context, active, status, errorCode);
  try {
    const reviewed = await loadReviewStageArtifacts(repository, lease);
    if (reviewed.review_result.payload.status !== 'PASS') throw new Error('REVIEW_PASS_REQUIRED');
    for (const kind of ['report', 'reviewer'] as const) {
      if (!isCurrentSuccessfulTask(context, kind)) await transitionTask(context, kind, 'succeeded');
    }
    const task = await checkpoint('running');
    const report = buildPublicationArtifact({
      run: context.run,
      task,
      draft: reviewed.report_draft,
      review: reviewed.review_result,
      calculation: reviewed.calculation,
      comparison: reviewed.comparison,
      visual_evidence: reviewed.visual_evidence,
      insight: reviewed.insight,
      decision_intelligence_pack: reviewed.decision_intelligence_pack,
    });
    validateAgentPublication(
      reviewed.report_draft,
      reviewed.review_result,
      report,
      reviewed.artifacts,
      context.run,
    );
    const reportRecord = await repository.publishReviewedDraft(lease, {
      draft_artifact_id: reviewed.report_draft.artifact_id,
      review_artifact_id: reviewed.review_result.artifact_id,
      publication_task: task,
      report,
    });
    return { ...reviewed, report, report_record: reportRecord };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'PUBLICATION_FAILED'));
    } catch {
      // The publication transaction may already have made the run terminal.
    }
    throw error;
  }
}
