import type { Repository } from '@vda/db';

const agentWorkflowStages = [
  'coordinator',
  'data',
  'comparison',
  'chart',
  'analyst',
  'insight',
  'report',
  'reviewer',
] as const;

export async function workflowStatus(
  repo: Repository,
  userId: string,
  orgId: string,
  runId: string,
) {
  // Draft/review checkpoints are private workflow data. This compact view
  // is deliberately gated to mutation-capable members and contains no
  // draft/report prose, artifact IDs, hashes or review issues.
  await repo.authorize(userId, orgId, true);
  const [{ run, tasks }, { artifacts }] = await Promise.all([
    repo.getRun(userId, orgId, runId),
    repo.artifacts(userId, orgId, runId),
  ]);
  const workflowVersion = run.workflow_version ?? 'legacy-v1';
  const isAgentWorkflow = workflowVersion === 'agent-v1';
  const drafts = isAgentWorkflow
    ? artifacts
        .filter((artifact) => artifact.kind === 'report_draft')
        .sort((left, right) => right.payload.revision - left.payload.revision)
    : [];
  const draft = drafts[0];
  const review = draft
    ? artifacts.find(
        (artifact) =>
          artifact.kind === 'review_result' &&
          artifact.payload.draft_artifact_id === draft.artifact_id,
      )
    : undefined;
  return {
    run_id: run.run_id,
    org_id: run.org_id,
    workflow_version: workflowVersion,
    stages: isAgentWorkflow
      ? agentWorkflowStages.flatMap((agent) => {
          const task = tasks.find((candidate) => candidate.kind === agent);
          return task ? [{ agent, status: task.status, error_code: task.error_code }] : [];
        })
      : [],
    draft_revision: draft?.payload.revision ?? null,
    review:
      review?.kind === 'review_result'
        ? { draft_revision: review.payload.draft_revision, status: review.payload.status }
        : null,
    publication_status: isAgentWorkflow
      ? (tasks.find((task) => task.kind === 'publication')?.status ?? null)
      : null,
  };
}
