import { type RunTask } from '@vda/contracts';
import { type Lease, type Repository } from '@vda/db';
import { executeAgentThroughDraft } from './stages/insight-report';
import { executePublicationStage, type PublishedAgentWorkflowResult } from './stages/publication';
import { type NarrativeProvider } from '../legacy-workflow/narrative/provider';
import {
  executeReportRevisionStage,
  executeReviewerStage,
  loadReportDraftStage,
  type AgentReviewStageResult,
} from './stages/reviewer';
import { type ReviewerCorrectionRequest, type ReviewerProvider } from './agents/reviewer-agent';
import { AGENT_WORKFLOW_DAG } from './dag';
import { loadStageContext, transitionTask, workflowFailureCode } from './checkpoint/stage-context';

export type AgentWorkflowOptions = {
  narrativeProvider?: NarrativeProvider;
  reviewerProvider?: ReviewerProvider;
  /** Internal deterministic test/server hook for the first review only. */
  firstReviewCorrection?: ReviewerCorrectionRequest | null;
  /** Internal deterministic test/server hook for the bounded second review. */
  secondReviewCorrection?: ReviewerCorrectionRequest | null;
};

async function failAtReviewLimit(repository: Repository, lease: Lease): Promise<never> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const task: RunTask = await transitionTask(
    context,
    'reviewer',
    'failed',
    'REVIEW_REVISION_LIMIT',
  );
  await repository.addEvent(lease, 'reviewer: revision limit reached', task.task_id);
  await repository.failRun(lease, 'REVIEW_REVISION_LIMIT');
  throw new Error('REVIEW_REVISION_LIMIT');
}

async function publishIfPassed(
  repository: Repository,
  lease: Lease,
  review: AgentReviewStageResult,
): Promise<PublishedAgentWorkflowResult> {
  if (review.review_result.payload.status !== 'PASS') return failAtReviewLimit(repository, lease);
  return executePublicationStage(repository, lease);
}

/**
 * Terminal executor for the opted-in workflow. It is bounded to draft/review
 * revisions one and two; retryable provider failures produce no PASS or final
 * report, while existing checkpoints are rehydrated on the next fenced lease.
 */
export async function executeAgentWorkflow(
  repository: Repository,
  lease: Lease,
  options: AgentWorkflowOptions = {},
): Promise<PublishedAgentWorkflowResult> {
  if (lease.run.workflow_version !== 'agent-v1') throw new Error('AGENT_WORKFLOW_NOT_SELECTED');
  try {
    await executeAgentThroughDraft(repository, lease, options.narrativeProvider);
    // Recovery must resume the latest immutable revision. In particular, a
    // persisted second rejection is terminal; it must not try to manufacture a
    // third draft or reinterpret the first-review correction on revision two.
    const latestDraft = await loadReportDraftStage(repository, lease);
    const currentReview = await executeReviewerStage(repository, lease, {
      provider: options.reviewerProvider,
      correction:
        latestDraft.report_draft.payload.revision === 1
          ? options.firstReviewCorrection
          : options.secondReviewCorrection,
    });
    if (currentReview.report_draft.payload.revision === 2)
      return publishIfPassed(repository, lease, currentReview);
    if (currentReview.review_result.payload.status === 'PASS')
      return publishIfPassed(repository, lease, currentReview);

    await executeReportRevisionStage(repository, lease);
    const secondReview = await executeReviewerStage(repository, lease, {
      provider: options.reviewerProvider,
      correction: options.secondReviewCorrection,
    });
    return publishIfPassed(repository, lease, secondReview);
  } catch (error) {
    try {
      await repository.failRun(lease, workflowFailureCode(error, 'AGENT_WORKFLOW_FAILED'));
    } catch {
      // A completed publication, cancellation, or a newer fencing owner wins.
    }
    throw error;
  }
}
