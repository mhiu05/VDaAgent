import { type ArtifactKind, type ArtifactOf, type RunTask } from '@vda/contracts';
import { RepositoryError, type Lease, type Repository } from '@vda/db';
import { buildAnalysisPack, validateAnalysisPack } from './analyst-agent';
import { buildChartEvidence, buildChartPack, validateChartPack } from './chart-agent';
import { buildComparisonPack, validateComparisonPack } from './comparison-agent';
import { chartPayloadFingerprint } from './chart-builder';
import { verifyArtifact } from './integrity';
import {
  AGENT_WORKFLOW_DAG,
  executeCoordinatorAndData,
  loadDataStageArtifacts,
  type AgentDataStageResult,
} from './workflow';
import {
  isCurrentSuccessfulTask,
  loadStageContext,
  persistAgentStageMessage,
  persistStageArtifact,
  transitionTask,
  workflowFailureCode,
} from './workflow-support';

export type ComparisonBranchResult = {
  comparison_pack: ArtifactOf<'comparison_pack'>;
};

export type ChartBranchResult = {
  visual_evidence: ArtifactOf<'visual_evidence'>;
  chart_pack: ArtifactOf<'chart_pack'>;
};

export type AnalystBranchResult = {
  analysis_pack: ArtifactOf<'analysis_pack'>;
};

export type AgentBranchStageResult = ComparisonBranchResult &
  ChartBranchResult &
  AnalystBranchResult;

export type PersistedAgentBranchStageResult = AgentDataStageResult & AgentBranchStageResult;

export type AgentWorkflowThroughBranchesResult = {
  data: AgentDataStageResult;
  branches: AgentBranchStageResult;
};

async function branchData(
  repository: Repository,
  lease: Lease,
  data?: AgentDataStageResult,
): Promise<AgentDataStageResult> {
  return data ?? loadDataStageArtifacts(repository, lease);
}

async function keyedBranchArtifact<K extends ArtifactKind>(
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
  if (artifact.kind !== kind) throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
  return artifact as ArtifactOf<K>;
}

async function optionalBranchArtifact<K extends ArtifactKind>(
  repository: Repository,
  lease: Lease,
  key: string,
  kind: K,
): Promise<ArtifactOf<K> | undefined> {
  try {
    return await keyedBranchArtifact(repository, lease, key, kind);
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'ARTIFACT_NOT_FOUND') return undefined;
    throw error;
  }
}

function wasCompleted(
  context: Awaited<ReturnType<typeof loadStageContext>>,
  kind: RunTask['kind'],
) {
  return context.tasks.get(kind)?.status === 'succeeded';
}

/** Rehydrates every branch checkpoint by key before a downstream fan-in stage. */
export async function loadBranchStageArtifacts(
  repository: Repository,
  lease: Lease,
  data?: AgentDataStageResult,
): Promise<PersistedAgentBranchStageResult> {
  const persisted = await branchData(repository, lease, data);
  const [detail, comparisonPack, visualEvidence, chartPack, analysisPack] = await Promise.all([
    repository.getRun(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    keyedBranchArtifact(repository, lease, 'comparison_pack', 'comparison_pack'),
    keyedBranchArtifact(repository, lease, 'chart.visual_evidence', 'visual_evidence'),
    keyedBranchArtifact(repository, lease, 'chart_pack', 'chart_pack'),
    keyedBranchArtifact(repository, lease, 'analysis_pack', 'analysis_pack'),
  ]);
  if (
    ['comparison', 'chart', 'analyst'].some(
      (kind) => detail.tasks.find((task) => task.kind === kind)?.status !== 'succeeded',
    )
  )
    throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
  validateComparisonPack(comparisonPack.payload, {
    data_analysis_pack: persisted.data_analysis_pack,
    data_analysis_pack_key: 'data_analysis_pack',
  });
  validateChartPack(chartPack.payload, {
    data_analysis_pack: persisted.data_analysis_pack,
    calculation: persisted.calculation,
    comparison: persisted.comparison,
    visual_evidence: visualEvidence,
    keys: {
      data_analysis_pack: 'data_analysis_pack',
      calculation: 'data.calculation',
      comparison: 'data.comparison',
      visual_evidence: 'chart.visual_evidence',
    },
  });
  validateAnalysisPack(analysisPack.payload, {
    data_analysis_pack: persisted.data_analysis_pack,
    data_analysis_pack_key: 'data_analysis_pack',
  });
  await repository.assertLease(lease);
  await Promise.all([
    persistAgentStageMessage({ repository, lease }, 'comparison', comparisonPack),
    persistAgentStageMessage({ repository, lease }, 'chart', chartPack),
    persistAgentStageMessage({ repository, lease }, 'analyst', analysisPack),
  ]);
  return {
    ...persisted,
    comparison_pack: comparisonPack,
    visual_evidence: visualEvidence,
    chart_pack: chartPack,
    analysis_pack: analysisPack,
  };
}

export async function executeComparisonBranch(
  repository: Repository,
  lease: Lease,
  data?: AgentDataStageResult,
): Promise<ComparisonBranchResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'comparison';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) => {
    return transitionTask(context, active, status, errorCode);
  };
  try {
    const persisted = await branchData(repository, lease, data);
    const existing = await optionalBranchArtifact(
      repository,
      lease,
      'comparison_pack',
      'comparison_pack',
    );
    if (existing) {
      validateComparisonPack(existing.payload, {
        data_analysis_pack: persisted.data_analysis_pack,
        data_analysis_pack_key: 'data_analysis_pack',
      });
      if (!isCurrentSuccessfulTask(context, active)) await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'comparison', existing);
      return { comparison_pack: existing };
    }
    if (wasCompleted(context, active)) throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
    const task = await checkpoint('running');
    const payload = buildComparisonPack({
      data_analysis_pack: persisted.data_analysis_pack,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    validateComparisonPack(payload, {
      data_analysis_pack: persisted.data_analysis_pack,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    const comparisonPack = await persistStageArtifact(context, {
      kind: 'comparison_pack',
      key: 'comparison_pack',
      task,
      payload,
      inputs: [persisted.data_analysis_pack],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-comparison'],
    });
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'comparison', comparisonPack);
    return { comparison_pack: comparisonPack };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'COMPARISON_AGENT_FAILED'));
    } catch {
      // A cancellation or a newer fenced owner controls the task state.
    }
    throw error;
  }
}

export async function executeChartBranch(
  repository: Repository,
  lease: Lease,
  data?: AgentDataStageResult,
): Promise<ChartBranchResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'chart';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) => {
    return transitionTask(context, active, status, errorCode);
  };
  try {
    const persisted = await branchData(repository, lease, data);
    const input = {
      data_analysis_pack: persisted.data_analysis_pack,
      calculation: persisted.calculation,
      comparison: persisted.comparison,
      keys: {
        data_analysis_pack: 'data_analysis_pack',
        calculation: 'data.calculation',
        comparison: 'data.comparison',
        visual_evidence: 'chart.visual_evidence',
      },
    };
    const [priorVisual, priorPack] = await Promise.all([
      optionalBranchArtifact(repository, lease, 'chart.visual_evidence', 'visual_evidence'),
      optionalBranchArtifact(repository, lease, 'chart_pack', 'chart_pack'),
    ]);
    if (priorPack && !priorVisual) throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
    if (wasCompleted(context, active) && (!priorVisual || !priorPack))
      throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
    const visualPayload = buildChartEvidence(input);
    if (priorPack) {
      if (!priorVisual) throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
      if (chartPayloadFingerprint(priorVisual.payload) !== chartPayloadFingerprint(visualPayload))
        throw new Error('IMMUTABLE_CHART_RULE_MISMATCH');
      const visual = priorVisual;
      validateChartPack(priorPack.payload, { ...input, visual_evidence: visual });
      if (!isCurrentSuccessfulTask(context, active)) await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'chart', priorPack);
      return { visual_evidence: visual, chart_pack: priorPack };
    }
    const task = await checkpoint('running');
    const visual =
      priorVisual ??
      (await persistStageArtifact(context, {
        kind: 'visual_evidence',
        key: 'chart.visual_evidence',
        task,
        payload: visualPayload,
        inputs: [persisted.calculation, persisted.comparison],
        limitations: persisted.data_analysis_pack.payload.limitations,
        checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-chart'],
      }));
    if (chartPayloadFingerprint(visual.payload) !== chartPayloadFingerprint(visualPayload))
      throw new Error('IMMUTABLE_CHART_RULE_MISMATCH');
    const payload = buildChartPack({ ...input, visual_evidence: visual });
    validateChartPack(payload, { ...input, visual_evidence: visual });
    const chartPack = await persistStageArtifact(context, {
      kind: 'chart_pack',
      key: 'chart_pack',
      task,
      payload,
      inputs: [persisted.data_analysis_pack, visual],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-chart'],
    });
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'chart', chartPack);
    return { visual_evidence: visual, chart_pack: chartPack };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'CHART_AGENT_FAILED'));
    } catch {
      // A cancellation or a newer fenced owner controls the task state.
    }
    throw error;
  }
}

export async function executeAnalystBranch(
  repository: Repository,
  lease: Lease,
  data?: AgentDataStageResult,
): Promise<AnalystBranchResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'analyst';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) => {
    return transitionTask(context, active, status, errorCode);
  };
  try {
    const persisted = await branchData(repository, lease, data);
    const existing = await optionalBranchArtifact(
      repository,
      lease,
      'analysis_pack',
      'analysis_pack',
    );
    if (existing) {
      validateAnalysisPack(existing.payload, {
        data_analysis_pack: persisted.data_analysis_pack,
        data_analysis_pack_key: 'data_analysis_pack',
      });
      if (!isCurrentSuccessfulTask(context, active)) await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'analyst', existing);
      return { analysis_pack: existing };
    }
    if (wasCompleted(context, active)) throw new Error('INVALID_BRANCH_STAGE_ARTIFACT');
    const task = await checkpoint('running');
    const payload = buildAnalysisPack({
      data_analysis_pack: persisted.data_analysis_pack,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    validateAnalysisPack(payload, {
      data_analysis_pack: persisted.data_analysis_pack,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    const analysisPack = await persistStageArtifact(context, {
      kind: 'analysis_pack',
      key: 'analysis_pack',
      task,
      payload,
      inputs: [persisted.data_analysis_pack],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'deterministic-analysis'],
    });
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'analyst', analysisPack);
    return { analysis_pack: analysisPack };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'ANALYST_AGENT_FAILED'));
    } catch {
      // A cancellation or a newer fenced owner controls the task state.
    }
    throw error;
  }
}

/** Runs the three independent post-Data branches concurrently on the same lease. */
export async function executeIndependentBranches(
  repository: Repository,
  lease: Lease,
): Promise<AgentBranchStageResult> {
  const data = await loadDataStageArtifacts(repository, lease);
  const settled = await Promise.allSettled([
    executeComparisonBranch(repository, lease, data),
    executeChartBranch(repository, lease, data),
    executeAnalystBranch(repository, lease, data),
  ]);
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed) throw failed.reason;
  const [comparison, chart, analyst] = settled.map(
    (result) =>
      (
        result as PromiseFulfilledResult<
          ComparisonBranchResult | ChartBranchResult | AnalystBranchResult
        >
      ).value,
  );
  return {
    ...(comparison as ComparisonBranchResult),
    ...(chart as ChartBranchResult),
    ...(analyst as AnalystBranchResult),
  };
}

/**
 * The non-terminal Phase D executable path. It deliberately stays separate
 * from legacy executeLease until later phases add draft/review/publication.
 */
export async function executeAgentThroughBranches(
  repository: Repository,
  lease: Lease,
): Promise<AgentWorkflowThroughBranchesResult> {
  const data = await executeCoordinatorAndData(repository, lease);
  const branches = await executeIndependentBranches(repository, lease);
  return { data, branches };
}
