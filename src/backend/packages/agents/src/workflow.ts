import { type Artifact, type ArtifactKind, type ArtifactOf, type RunTask } from '@vda/contracts';
import { RepositoryError, type Lease, type Repository } from '@vda/db';
import { semanticPack } from '@vda/semantic';
import { coordinateRun } from './coordinator';
import {
  buildDataAnalysisPack,
  calculateDataAgentOutput,
  validateDataAnalysisPack,
  type DataAgentArtifacts,
} from './data-agent';
import { canonical, stableId, verifyArtifact } from './integrity';
import {
  isCurrentSuccessfulTask,
  loadStageContext,
  persistAgentStageMessage,
  persistStageArtifact,
  transitionTask,
  workflowFailureCode,
  type WorkflowDag,
} from './workflow-support';

/**
 * One durable graph on the existing PostgreSQL lease. Branch stages have no
 * dependency on one another; later phases extend the same graph at fan-in.
 */
export const AGENT_WORKFLOW_DAG: WorkflowDag = [
  { kind: 'coordinator', dependencies: [] },
  { kind: 'data', dependencies: ['coordinator'] },
  { kind: 'comparison', dependencies: ['data'] },
  { kind: 'chart', dependencies: ['data'] },
  { kind: 'analyst', dependencies: ['data'] },
  { kind: 'insight', dependencies: ['comparison', 'chart', 'analyst'] },
  { kind: 'report', dependencies: ['insight'] },
  { kind: 'reviewer', dependencies: ['report'] },
  { kind: 'publication', dependencies: ['reviewer'] },
];

/** Retained as the explicit Phase C subset for callers and tests. */
export const AGENT_DATA_DAG: WorkflowDag = AGENT_WORKFLOW_DAG.slice(0, 2);

export type AgentDataStageResult = DataAgentArtifacts & {
  analysis_request: ArtifactOf<'analysis_request'>;
  coordinator_decision: ArtifactOf<'coordinator_decision'>;
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
};

type CoordinatorStageResult = Pick<
  AgentDataStageResult,
  'analysis_request' | 'coordinator_decision'
>;

function isMissingArtifact(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError && error.code === 'ARTIFACT_NOT_FOUND';
}

async function loadCompletedDataStage(
  repository: Repository,
  lease: Lease,
): Promise<AgentDataStageResult | undefined> {
  try {
    return await loadDataStageArtifacts(repository, lease);
  } catch (error) {
    if (!isMissingArtifact(error)) throw error;
    const detail = await repository.getRun(
      lease.run.created_by,
      lease.run.org_id,
      lease.run.run_id,
    );
    // A successful task with a missing keyed artifact is an integrity failure,
    // not a reason to manufacture a replacement checkpoint.
    if (detail.tasks.find((task) => task.kind === 'data')?.status === 'succeeded') throw error;
    return undefined;
  }
}

async function loadCompletedCoordinatorStage(
  repository: Repository,
  lease: Lease,
): Promise<CoordinatorStageResult | undefined> {
  try {
    return await loadCoordinatorStageArtifacts(repository, lease);
  } catch (error) {
    if (!isMissingArtifact(error)) throw error;
    const detail = await repository.getRun(
      lease.run.created_by,
      lease.run.org_id,
      lease.run.run_id,
    );
    // Do not overwrite a coordinator checkpoint when its task has already
    // committed success but its immutable artifact graph is incomplete.
    if (detail.tasks.find((task) => task.kind === 'coordinator')?.status === 'succeeded')
      throw error;
    return undefined;
  }
}

/**
 * Persists a Coordinator decision and its Data-owned, deterministic outputs.
 * This is intentionally not a terminal executor: later phases add fan-out,
 * drafting, review, and the publication gate to the same claimed run.
 */
export async function executeCoordinatorAndData(
  repository: Repository,
  lease: Lease,
): Promise<AgentDataStageResult> {
  const { run } = lease;
  if (run.workflow_version !== 'agent-v1') throw new Error('AGENT_WORKFLOW_NOT_SELECTED');
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  let active: RunTask['kind'] = 'coordinator';

  async function setTask(
    kind: RunTask['kind'],
    status: RunTask['status'],
    errorCode: string | null = null,
  ): Promise<RunTask> {
    active = kind;
    return transitionTask(context, kind, status, errorCode);
  }

  async function put<K extends ArtifactKind>(
    kind: K,
    key: string,
    task: RunTask,
    payload: ArtifactOf<K>['payload'],
    inputs: Artifact[],
    refs: { snapshots?: string[]; sources?: string[] } = {},
  ): Promise<ArtifactOf<K>> {
    return persistStageArtifact(context, {
      kind,
      key,
      task,
      payload,
      inputs,
      refs,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-data'],
    });
  }

  try {
    const recovered = await loadCompletedDataStage(repository, lease);
    if (recovered) {
      if (!isCurrentSuccessfulTask(context, 'coordinator'))
        await setTask('coordinator', 'succeeded');
      if (!isCurrentSuccessfulTask(context, 'data')) await setTask('data', 'succeeded');
      return recovered;
    }
    await repository.renewLease(lease);
    let coordinator = await loadCompletedCoordinatorStage(repository, lease);
    if (!coordinator) {
      const coordinatorTask = await setTask('coordinator', 'running');
      const request = await put(
        'analysis_request',
        'analysis_request',
        coordinatorTask,
        run.request,
        [],
      );
      const decision = await put(
        'coordinator_decision',
        'coordinator_decision',
        coordinatorTask,
        coordinateRun({ run }),
        [request],
      );
      await setTask('coordinator', 'succeeded');
      await persistAgentStageMessage(context, 'coordinator', decision);
      coordinator = { analysis_request: request, coordinator_decision: decision };
    } else if (!isCurrentSuccessfulTask(context, 'coordinator')) {
      await setTask('coordinator', 'succeeded');
    }
    const { analysis_request: request, coordinator_decision: decision } = coordinator;

    const dataTask = await setTask('data', 'running');
    // This repository method is the approved, pinned warehouse-read boundary.
    // The Data Agent receives rows only after repository fencing and scope checks.
    const queryResult = await repository.readSnapshots(lease);
    if (
      queryResult.rows.length > queryResult.row_limit ||
      queryResult.rows.some((row) => row.org_id !== run.org_id)
    )
      throw new Error('DATA_AGENT_SCOPE_MISMATCH');
    const query = await put(
      'query',
      'data.query',
      dataTask,
      {
        sql: queryResult.sql,
        parameters: queryResult.parameters,
        row_limit: queryResult.row_limit,
        timeout_ms: queryResult.timeout_ms,
      },
      [decision],
    );
    const result = await put(
      'query_result',
      'data.query_result',
      dataTask,
      {
        rows: queryResult.rows,
        row_count: queryResult.rows.length,
        truncated: false,
      },
      [query],
      {
        snapshots: queryResult.rows.map((row) => row.snapshot_id),
        sources: queryResult.rows.map((row) => row.import_id),
      },
    );
    const config = await repository.getMetricConfig(lease);
    const deterministic = calculateDataAgentOutput(
      run,
      result.payload.rows,
      config.slow_moving_threshold_days,
    );
    const calculation = await put(
      'calculation',
      'data.calculation',
      dataTask,
      deterministic.calculation,
      [result],
    );
    const comparisonCalculation = await put(
      'comparison_calculation',
      'data.comparison_calculation',
      dataTask,
      {
        items: deterministic.peer_items,
        rounding: 'decimal-half-up-6dp',
        rule: semanticPack.peer_rule,
      },
      [result, calculation],
    );
    // The Data boundary writes this legacy-shaped adapter so the Chart branch
    // can reuse the proven renderer without waiting for Comparison Agent prose.
    const comparison = await put(
      'comparison',
      'data.comparison',
      dataTask,
      {
        items: comparisonCalculation.payload.items,
        period_comparisons: calculation.payload.period_comparisons,
        segment_comparisons: calculation.payload.segment_comparisons,
        calculation_artifact_id: comparisonCalculation.artifact_id,
      },
      [comparisonCalculation],
    );
    const pack = buildDataAnalysisPack({
      run,
      query,
      query_result: result,
      calculation,
      comparison_calculation: comparisonCalculation,
      comparison,
      pack_id: stableId(`${run.run_id}:artifact:data_analysis_pack`),
      artifact_keys: {
        query: 'data.query',
        query_result: 'data.query_result',
        calculation: 'data.calculation',
        comparison_calculation: 'data.comparison_calculation',
        comparison: 'data.comparison',
      },
    });
    const dataAnalysisPack = await put('data_analysis_pack', 'data_analysis_pack', dataTask, pack, [
      query,
      result,
      calculation,
      comparisonCalculation,
      comparison,
    ]);
    await setTask('data', 'succeeded');
    await persistAgentStageMessage(context, 'data', dataAnalysisPack);
    return {
      analysis_request: request,
      coordinator_decision: decision,
      query,
      query_result: result,
      calculation,
      comparison_calculation: comparisonCalculation,
      comparison,
      data_analysis_pack: dataAnalysisPack,
    };
  } catch (error) {
    try {
      await setTask(active, 'failed', workflowFailureCode(error, 'AGENT_DATA_FAILED'));
    } catch {
      // Fencing and cancellation always win over a stale worker's stage state.
    }
    throw error;
  }
}

function sameIds(actual: readonly string[], expected: readonly string[]) {
  return canonical([...new Set(actual)].sort()) === canonical([...new Set(expected)].sort());
}

async function keyedArtifact<K extends ArtifactKind>(
  repository: Repository,
  lease: Lease,
  key: string,
  kind: K,
): Promise<ArtifactOf<K>> {
  const artifact = await repository.artifactByKey(
    lease.run.created_by,
    lease.run.org_id,
    lease.run.run_id,
    key,
  );
  verifyArtifact(artifact);
  if (artifact.kind !== kind) throw new Error('INVALID_DATA_STAGE_ARTIFACT');
  return artifact as ArtifactOf<K>;
}

/** Rehydrates and revalidates the Coordinator checkpoint without rerunning it. */
export async function loadCoordinatorStageArtifacts(
  repository: Repository,
  lease: Lease,
): Promise<CoordinatorStageResult> {
  const { run } = lease;
  if (run.workflow_version !== 'agent-v1') throw new Error('AGENT_WORKFLOW_NOT_SELECTED');
  await repository.assertLease(lease);
  const [detail, request, decision] = await Promise.all([
    repository.getRun(run.created_by, run.org_id, run.run_id),
    keyedArtifact(repository, lease, 'analysis_request', 'analysis_request'),
    keyedArtifact(repository, lease, 'coordinator_decision', 'coordinator_decision'),
  ]);
  if (
    detail.tasks.find((task) => task.kind === 'coordinator')?.status !== 'succeeded' ||
    canonical(request.payload) !== canonical(detail.run.request) ||
    canonical(decision.payload) !== canonical(coordinateRun({ run: detail.run }))
  )
    throw new Error('INVALID_COORDINATOR_STAGE_ARTIFACT');
  await repository.assertLease(lease);
  await persistAgentStageMessage({ repository, lease }, 'coordinator', decision);
  return { analysis_request: request, coordinator_decision: decision };
}

/**
 * Rehydrates and revalidates the immutable Data checkpoint. Branches use this
 * instead of process memory, so a retry can resume after a worker crash.
 */
export async function loadDataStageArtifacts(
  repository: Repository,
  lease: Lease,
): Promise<AgentDataStageResult> {
  const { run } = lease;
  if (run.workflow_version !== 'agent-v1') throw new Error('AGENT_WORKFLOW_NOT_SELECTED');
  await repository.assertLease(lease);
  const [
    detail,
    request,
    decision,
    query,
    queryResult,
    calculation,
    comparisonCalculation,
    comparison,
    pack,
  ] = await Promise.all([
    repository.getRun(run.created_by, run.org_id, run.run_id),
    keyedArtifact(repository, lease, 'analysis_request', 'analysis_request'),
    keyedArtifact(repository, lease, 'coordinator_decision', 'coordinator_decision'),
    keyedArtifact(repository, lease, 'data.query', 'query'),
    keyedArtifact(repository, lease, 'data.query_result', 'query_result'),
    keyedArtifact(repository, lease, 'data.calculation', 'calculation'),
    keyedArtifact(repository, lease, 'data.comparison_calculation', 'comparison_calculation'),
    keyedArtifact(repository, lease, 'data.comparison', 'comparison'),
    keyedArtifact(repository, lease, 'data_analysis_pack', 'data_analysis_pack'),
  ]);
  if (
    detail.tasks.find((task) => task.kind === 'coordinator')?.status !== 'succeeded' ||
    detail.tasks.find((task) => task.kind === 'data')?.status !== 'succeeded' ||
    canonical(request.payload) !== canonical(detail.run.request) ||
    canonical(decision.payload) !== canonical(coordinateRun({ run: detail.run })) ||
    !sameIds(pack.input_refs, pack.payload.input_refs)
  )
    throw new Error('INVALID_DATA_STAGE_ARTIFACT');
  validateDataAnalysisPack(pack.payload, {
    run: detail.run,
    query,
    query_result: queryResult,
    calculation,
    comparison_calculation: comparisonCalculation,
    comparison,
  });
  await repository.assertLease(lease);
  await persistAgentStageMessage({ repository, lease }, 'coordinator', decision);
  await persistAgentStageMessage({ repository, lease }, 'data', pack);
  return {
    analysis_request: request,
    coordinator_decision: decision,
    query,
    query_result: queryResult,
    calculation,
    comparison_calculation: comparisonCalculation,
    comparison,
    data_analysis_pack: pack,
  };
}
