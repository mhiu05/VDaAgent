import { type AgentKey, type AnalysisRun, type Artifact, type RunTask } from '@vda/contracts';
import { type Lease, type Repository } from '@vda/db';
import { stableId } from '@vda/domain';
import type { WorkflowDag } from '../dag';

export type StageContext = {
  repository: Repository;
  lease: Lease;
  run: AnalysisRun;
  dag: WorkflowDag;
  tasks: Map<RunTask['kind'], RunTask>;
};

const stageMessageContent: Record<AgentKey, string> = {
  coordinator: 'Coordinator Agent persisted the registered use-case decision and authorized scope.',
  data: 'Data Agent persisted the canonical deterministic analysis pack.',
  comparison: 'Comparison Agent persisted the validated comparison pack.',
  chart: 'Chart Agent persisted the validated chart pack.',
  analyst: 'Analyst Agent persisted the evidence-bound analysis pack.',
  insight: 'Insight Agent persisted the bounded insight pack.',
  report:
    'Report Agent persisted a reviewable draft checkpoint. Authorized roles can inspect its status.',
  reviewer:
    'Reviewer Agent recorded the bounded review checkpoint. Publication remains deterministically gated.',
};

export function workflowFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message) ? error.message : fallback;
}

/**
 * Artifacts remain immutable across a reclaimed lease, but a downstream
 * transaction may require its validated task checkpoint to belong to the
 * current run attempt.
 */
export function isCurrentSuccessfulTask(
  context: Pick<StageContext, 'run' | 'tasks'>,
  kind: RunTask['kind'],
): boolean {
  const task = context.tasks.get(kind);
  return (
    task?.status === 'succeeded' && task.attempt === context.run.attempt && task.error_code === null
  );
}

export async function loadStageContext(
  repository: Repository,
  lease: Lease,
  dag: WorkflowDag,
): Promise<StageContext> {
  // The existing lease remains the sole fence. Renewing it only at durable
  // stage boundaries prevents a bounded draft/review sequence from expiring
  // between otherwise-valid checkpoints; a cancellation or newer owner still
  // rejects this fenced renewal.
  await repository.renewLease(lease);
  const { run } = lease;
  const { tasks } = await repository.getRun(run.created_by, run.org_id, run.run_id);
  return {
    repository,
    lease,
    run,
    dag,
    tasks: new Map(tasks.map((task) => [task.kind, task])),
  };
}

/** Fenced, dependency-checked task checkpoint shared by every agent stage. */
export async function transitionTask(
  context: StageContext,
  kind: RunTask['kind'],
  status: RunTask['status'],
  errorCode: string | null = null,
): Promise<RunTask> {
  await context.repository.assertLease(context.lease);
  const spec = context.dag.find((item) => item.kind === kind);
  if (!spec) throw new Error('UNKNOWN_AGENT_STAGE');
  if (
    status === 'running' &&
    spec.dependencies.some((dependency) => context.tasks.get(dependency)?.status !== 'succeeded')
  )
    throw new Error('UNVALIDATED_DEPENDENCY');
  const previous = context.tasks.get(kind);
  const task: RunTask = {
    task_id: previous?.task_id ?? stableId(`${context.run.run_id}:task:${kind}`),
    run_id: context.run.run_id,
    org_id: context.run.org_id,
    kind,
    dependencies: [...spec.dependencies],
    status,
    attempt: context.run.attempt,
    error_code: errorCode,
  };
  await context.repository.setTask(context.lease, task);
  context.tasks.set(kind, task);
  await context.repository.addEvent(context.lease, `${kind}: ${status}`, task.task_id);
  return task;
}

/**
 * Persists one reference-only chat checkpoint after a stage has durably
 * succeeded. The repository supplies the run reference, rechecks fencing and
 * validation, and refuses private draft/review artifact references.
 */
export async function persistAgentStageMessage(
  context: Pick<StageContext, 'repository' | 'lease'>,
  senderAgent: AgentKey,
  artifact?: Artifact,
): Promise<void> {
  await context.repository.upsertStageMessage(context.lease, {
    sender_agent: senderAgent,
    content: stageMessageContent[senderAgent],
    artifact,
  });
}

/**
 * Persists one immutable, keyed artifact and records its deterministic checks.
 * The database derives idempotency from the key while the content hash catches
 * a retry that would otherwise overwrite a prior stage result.
 */
