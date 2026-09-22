import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  LIMITATION,
  SEMANTIC_VERSION,
  type AgentKey,
  type AnalysisRun,
  type Artifact,
  type ArtifactKind,
  type ArtifactOf,
  type RunTask,
} from '@vda/contracts';
import { type Lease, type Repository } from '@vda/db';
import { artifactHash, stableId, verifyArtifact } from './integrity';

export type WorkflowDag = readonly {
  kind: RunTask['kind'];
  dependencies: RunTask['kind'][];
}[];

export type StageContext = {
  repository: Repository;
  lease: Lease;
  run: AnalysisRun;
  dag: WorkflowDag;
  tasks: Map<RunTask['kind'], RunTask>;
};

export type ArtifactRefs = { snapshots?: string[]; sources?: string[] };

const unique = (values: readonly string[]) => [...new Set(values)].sort();

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
export async function persistStageArtifact<K extends ArtifactKind>(
  context: StageContext,
  input: {
    kind: K;
    key: string;
    task: RunTask;
    payload: ArtifactOf<K>['payload'];
    inputs: Artifact[];
    refs?: ArtifactRefs;
    limitations?: string[];
    checks?: string[];
  },
): Promise<ArtifactOf<K>> {
  const { run, repository, lease } = context;
  await repository.assertLease(lease);
  const body = {
    artifact_id: stableId(`${run.run_id}:artifact:${input.key}`),
    org_id: run.org_id,
    run_id: run.run_id,
    task_id: input.task.task_id,
    kind: input.kind,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: run.created_at,
    semantic_version: SEMANTIC_VERSION,
    provisional: true as const,
    data_as_of: run.request.data_as_of,
    input_refs: unique(input.inputs.map((artifact) => artifact.artifact_id)),
    snapshot_refs: unique(
      input.refs?.snapshots ?? input.inputs.flatMap((artifact) => artifact.snapshot_refs),
    ),
    source_refs: unique(
      input.refs?.sources ?? input.inputs.flatMap((artifact) => artifact.source_refs),
    ),
    limitations: unique(input.limitations?.length ? input.limitations : [LIMITATION]),
    payload: input.payload,
  };
  const artifact = ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<K>;
  verifyArtifact(artifact);
  const persisted = (await repository.storeArtifact(lease, artifact, {
    artifact_key: input.key,
  })) as ArtifactOf<K>;
  verifyArtifact(persisted);
  await repository.validateArtifact(lease, {
    artifact_id: persisted.artifact_id,
    org_id: run.org_id,
    run_id: run.run_id,
    validated_at: new Date().toISOString(),
    validator_version: 'mvp-validator-v1',
    valid: true,
    checks: input.checks ?? ['schema', 'hash', 'tenant', 'lineage'],
  });
  return persisted;
}
