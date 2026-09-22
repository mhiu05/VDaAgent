import {
  type AnalysisRun,
  type Artifact,
  type ArtifactKind,
  type ArtifactOf,
  type RunTask,
} from '@vda/contracts';
import { RepositoryError, type Lease, type Repository } from '@vda/db';
import {
  validateReportDraftArtifact,
  validateReviewResultArtifact,
  verifyArtifact,
} from '@vda/domain';
import { loadInsightStageArtifacts, type AgentInsightStageResult } from './draft-workflow';
import {
  buildReportDraftRevision,
  validateReportDraft,
  validateReportDraftRevision,
} from './report-agent';
import {
  buildReviewResult,
  createDeterministicReviewerProvider,
  reviewerProviderInput,
  ReviewerCorrectionRequestSchema,
  validateReviewResult,
  type ReviewerAgentInput,
  type ReviewerCorrectionRequest,
  type ReviewerProvider,
} from './reviewer-agent';
import { stableId } from './integrity';
import { AGENT_WORKFLOW_DAG } from './workflow';
import {
  loadStageContext,
  persistAgentStageMessage,
  persistStageArtifact,
  transitionTask,
  workflowFailureCode,
} from './workflow-support';

export type AgentDraftCheckpoint = AgentInsightStageResult & {
  run: AnalysisRun;
  artifacts: Artifact[];
  report_draft: ArtifactOf<'report_draft'>;
};

export type AgentReviewStageResult = AgentDraftCheckpoint & {
  review_result: ArtifactOf<'review_result'>;
};

type ReviewOptions = {
  provider?: ReviewerProvider;
  /** Internal test/server hook; external callers never supply corrections. */
  correction?: ReviewerCorrectionRequest | null;
};

async function optionalArtifact<K extends ArtifactKind>(
  repository: Repository,
  lease: Lease,
  key: string,
  kind: K,
): Promise<ArtifactOf<K> | undefined> {
  try {
    const artifact = await repository.artifactByKey(
      lease.run.created_by,
      lease.run.org_id,
      lease.run.run_id,
      key,
    );
    verifyArtifact(artifact);
    if (artifact.kind !== kind) throw new Error('INVALID_REVIEW_STAGE_ARTIFACT');
    return artifact as ArtifactOf<K>;
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'ARTIFACT_NOT_FOUND') return undefined;
    throw error;
  }
}

function expectedCorrection(
  review: ArtifactOf<'review_result'>,
  draft: ArtifactOf<'report_draft'>,
): ReviewerCorrectionRequest | null {
  if (review.payload.status === 'PASS') return null;
  const issue = review.payload.issues[0];
  if (
    review.payload.issues.length === 1 &&
    issue?.category === 'overstatement' &&
    issue.claim_id !== null &&
    issue.issue_id === stableId(`${draft.artifact_id}:evidence-bound-wording:${issue.claim_id}`)
  )
    return { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: issue.claim_id };
  // A draft-projection issue is deterministic without a provider correction.
  return null;
}

function stageInput(checkpoint: AgentDraftCheckpoint): ReviewerAgentInput {
  return {
    run: checkpoint.run,
    report_draft: checkpoint.report_draft,
    artifacts: checkpoint.artifacts,
  };
}

/** Rehydrates the latest immutable ReportDraft and validates it before review. */
export async function loadReportDraftStage(
  repository: Repository,
  lease: Lease,
): Promise<AgentDraftCheckpoint> {
  const persisted = await loadInsightStageArtifacts(repository, lease);
  const [detail, bundle, draftOne, draftTwo, reviewOne] = await Promise.all([
    repository.getRun(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    repository.artifacts(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    optionalArtifact(repository, lease, 'report_draft:1', 'report_draft'),
    optionalArtifact(repository, lease, 'report_draft:2', 'report_draft'),
    optionalArtifact(repository, lease, 'review_result:1', 'review_result'),
  ]);
  const draft = draftTwo ?? draftOne;
  if (
    !draft ||
    detail.tasks.find((task) => task.kind === 'report')?.status !== 'succeeded' ||
    !bundle.artifacts.some(
      (artifact) =>
        artifact.artifact_id === draft.artifact_id && artifact.content_hash === draft.content_hash,
    )
  )
    throw new Error('INVALID_REPORT_DRAFT_STAGE_ARTIFACT');
  const input = { ...persisted, run: detail.run, insight_pack: persisted.insight_pack };
  if (draft.payload.revision === 1) validateReportDraft(draft.payload, input);
  else {
    if (!draftOne || !reviewOne) throw new Error('INVALID_REPORT_DRAFT_STAGE_ARTIFACT');
    validateReportDraftRevision(draft.payload, {
      ...input,
      previous_draft: draftOne,
      review_result: reviewOne,
    });
  }
  validateReportDraftArtifact(draft, bundle.artifacts, detail.run);
  await repository.assertLease(lease);
  await persistAgentStageMessage({ repository, lease }, 'report');
  return { ...persisted, run: detail.run, artifacts: bundle.artifacts, report_draft: draft };
}

/** Rehydrates a Reviewer checkpoint without asking a provider again. */
export async function loadReviewStageArtifacts(
  repository: Repository,
  lease: Lease,
): Promise<AgentReviewStageResult> {
  const checkpoint = await loadReportDraftStage(repository, lease);
  const [detail, review] = await Promise.all([
    repository.getRun(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    optionalArtifact(
      repository,
      lease,
      `review_result:${checkpoint.report_draft.payload.revision}`,
      'review_result',
    ),
  ]);
  if (!review || detail.tasks.find((task) => task.kind === 'reviewer')?.status !== 'succeeded')
    throw new Error('INVALID_REVIEW_STAGE_ARTIFACT');
  const input = stageInput(checkpoint);
  validateReviewResult(review.payload, {
    ...input,
    correction: expectedCorrection(review, checkpoint.report_draft),
  });
  validateReviewResultArtifact(review, checkpoint.report_draft, checkpoint.artifacts, detail.run);
  await repository.assertLease(lease);
  await persistAgentStageMessage({ repository, lease }, 'reviewer');
  return { ...checkpoint, run: detail.run, review_result: review };
}

/**
 * Persists one structured review result. A provider is only allowed to request
 * a predeclared correction; its failure never yields a PASS or an artifact.
 */
export async function executeReviewerStage(
  repository: Repository,
  lease: Lease,
  options: ReviewOptions = {},
): Promise<AgentReviewStageResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'reviewer';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) =>
    transitionTask(context, active, status, errorCode);
  try {
    const draftStage = await loadReportDraftStage(repository, lease);
    const task = await checkpoint('running');
    const input = stageInput(draftStage);
    const existing = await optionalArtifact(
      repository,
      lease,
      `review_result:${draftStage.report_draft.payload.revision}`,
      'review_result',
    );
    if (existing) {
      validateReviewResult(existing.payload, {
        ...input,
        correction: expectedCorrection(existing, draftStage.report_draft),
      });
      validateReviewResultArtifact(
        existing,
        draftStage.report_draft,
        draftStage.artifacts,
        context.run,
      );
      await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'reviewer');
      return { ...draftStage, review_result: existing };
    }
    const requested =
      options.correction ??
      (await (options.provider ?? createDeterministicReviewerProvider()).review(
        reviewerProviderInput(input),
      ));
    const correction = requested === null ? null : ReviewerCorrectionRequestSchema.parse(requested);
    const payload = buildReviewResult({ ...input, correction });
    validateReviewResult(payload, { ...input, correction });
    const review = await persistStageArtifact(context, {
      kind: 'review_result',
      key: `review_result:${draftStage.report_draft.payload.revision}`,
      task,
      payload,
      inputs: [draftStage.report_draft],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-review'],
    });
    validateReviewResultArtifact(
      review,
      draftStage.report_draft,
      [...draftStage.artifacts, review],
      context.run,
    );
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'reviewer');
    return { ...draftStage, review_result: review };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'REVIEWER_AGENT_FAILED'));
    } catch {
      // Cancellation and a newer fencing owner control terminal state.
    }
    throw error;
  }
}

/** Creates the only permitted second ReportDraft after review one requests revision. */
export async function executeReportRevisionStage(
  repository: Repository,
  lease: Lease,
): Promise<AgentDraftCheckpoint> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'report';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) =>
    transitionTask(context, active, status, errorCode);
  try {
    const prior = await loadReviewStageArtifacts(repository, lease);
    if (
      prior.report_draft.payload.revision !== 1 ||
      prior.review_result.payload.status !== 'REVISION_REQUIRED'
    )
      throw new Error('REPORT_REVISION_NOT_REQUIRED');
    const task = await checkpoint('running');
    const input = { ...prior, run: context.run, insight_pack: prior.insight_pack };
    const payload = buildReportDraftRevision({
      ...input,
      previous_draft: prior.report_draft,
      review_result: prior.review_result,
    });
    validateReportDraftRevision(payload, {
      ...input,
      previous_draft: prior.report_draft,
      review_result: prior.review_result,
    });
    const draft = await persistStageArtifact(context, {
      kind: 'report_draft',
      key: 'report_draft:2',
      task,
      payload,
      inputs: [
        prior.data_analysis_pack,
        prior.comparison_pack,
        prior.chart_pack,
        prior.analysis_pack,
        prior.insight_pack,
        prior.review_result,
      ],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'bounded-report-revision'],
    });
    validateReportDraftArtifact(draft, [...prior.artifacts, draft], context.run);
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'report');
    return {
      ...prior,
      run: context.run,
      artifacts: [...prior.artifacts, draft],
      report_draft: draft,
    };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'REPORT_REVISION_FAILED'));
    } catch {
      // Cancellation and a newer fencing owner control terminal state.
    }
    throw error;
  }
}
