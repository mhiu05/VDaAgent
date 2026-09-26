import { type RunTask } from '@vda/contracts';
import { type Lease, type Repository } from '@vda/db';
import { executeTeamThroughReview } from './team-workflow';
export { executeSpecialistWorkflow, isArtifactSpecialist } from './team-workflow';
import { executePublicationStage, type PublishedAgentWorkflowResult } from './stages/publication';
import {
  type AgentReviewStageResult,
} from './stages/reviewer';
import type { AgentWorkflowOptions } from './options';
export type { AgentWorkflowOptions } from './options';
import { AGENT_WORKFLOW_DAG } from './dag';
import { loadStageContext, transitionTask, workflowFailureCode } from './checkpoint/stage-context';

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
    const review = await executeTeamThroughReview(repository, lease, options);
    // Publication owns the terminal transaction. Runtime records are complete
    // before that transaction releases the run's fencing lease.
    return publishIfPassed(repository, lease, review);
  } catch (error) {
    try {
      await repository.failRun(lease, workflowFailureCode(error, 'AGENT_WORKFLOW_FAILED'));
    } catch {
      // A completed publication, cancellation, or a newer fencing owner wins.
    }
    throw error;
  }
}
