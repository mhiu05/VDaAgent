import { RepositoryError, type Lease, type Repository } from '@vda/db';
import { validateReportDraftArtifact } from '@vda/domain';
import { bindClaims, verifyArtifact } from './integrity';
import {
  buildInsightPack,
  buildLegacyInsightPayload,
  validateInsightPack,
  type InsightSourceInput,
} from './insight-agent';
import { createProvider, type NarrativeProvider } from './provider';
import {
  buildReportDraft,
  validateDraftReportCompatibility,
  validateReportDraft,
} from './report-agent';
import {
  executeIndependentBranches,
  loadBranchStageArtifacts,
  type PersistedAgentBranchStageResult,
} from './branch-workflow';
import { executeCoordinatorAndData } from './workflow';
import {
  isCurrentSuccessfulTask,
  loadStageContext,
  persistAgentStageMessage,
  persistStageArtifact,
  transitionTask,
  workflowFailureCode,
} from './workflow-support';
import { AGENT_WORKFLOW_DAG } from './workflow';
import { type ArtifactKind, type ArtifactOf, type RunTask } from '@vda/contracts';

export type AgentInsightStageResult = PersistedAgentBranchStageResult & {
  insight: ArtifactOf<'insight'>;
  insight_pack: ArtifactOf<'insight_pack'>;
};

export type AgentDraftStageResult = AgentInsightStageResult & {
  report_draft: ArtifactOf<'report_draft'>;
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
    if (artifact.kind !== kind) throw new Error('INVALID_AGENT_STAGE_ARTIFACT');
    return artifact as ArtifactOf<K>;
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'ARTIFACT_NOT_FOUND') return undefined;
    throw error;
  }
}

function insightInput(persisted: PersistedAgentBranchStageResult): InsightSourceInput {
  return {
    data_analysis_pack: persisted.data_analysis_pack,
    calculation: persisted.calculation,
    comparison: persisted.comparison,
    comparison_pack: persisted.comparison_pack,
    visual_evidence: persisted.visual_evidence,
    chart_pack: persisted.chart_pack,
    analysis_pack: persisted.analysis_pack,
    keys: {
      data_analysis_pack: 'data_analysis_pack',
      calculation: 'data.calculation',
      comparison: 'data.comparison',
      comparison_pack: 'comparison_pack',
      visual_evidence: 'chart.visual_evidence',
      chart_pack: 'chart_pack',
      analysis_pack: 'analysis_pack',
      insight: 'insight',
    },
  };
}

/** Rehydrates and validates the exact Insight checkpoint before Report composition. */
export async function loadInsightStageArtifacts(
  repository: Repository,
  lease: Lease,
): Promise<AgentInsightStageResult> {
  const persisted = await loadBranchStageArtifacts(repository, lease);
  const [detail, insight, insightPack] = await Promise.all([
    repository.getRun(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    optionalArtifact(repository, lease, 'insight', 'insight'),
    optionalArtifact(repository, lease, 'insight_pack', 'insight_pack'),
  ]);
  if (
    detail.tasks.find((task) => task.kind === 'insight')?.status !== 'succeeded' ||
    !insight ||
    !insightPack
  )
    throw new Error('INVALID_INSIGHT_STAGE_ARTIFACT');
  const input = { ...insightInput(persisted), insight };
  validateInsightPack(insightPack.payload, input);
  await repository.assertLease(lease);
  await persistAgentStageMessage({ repository, lease }, 'insight', insightPack);
  return { ...persisted, insight, insight_pack: insightPack };
}

/**
 * The Insight stage is retry-safe: once the bounded provider result is stored
 * at `insight`, later retries revalidate it rather than calling a provider.
 */
export async function executeInsightStage(
  repository: Repository,
  lease: Lease,
  provider?: NarrativeProvider,
): Promise<AgentInsightStageResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'insight';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) => {
    return transitionTask(context, active, status, errorCode);
  };
  try {
    const persisted = await loadBranchStageArtifacts(repository, lease);
    const source = insightInput(persisted);
    const [priorInsight, priorPack] = await Promise.all([
      optionalArtifact(repository, lease, 'insight', 'insight'),
      optionalArtifact(repository, lease, 'insight_pack', 'insight_pack'),
    ]);
    if (priorPack) {
      if (!priorInsight) throw new Error('INVALID_INSIGHT_STAGE_ARTIFACT');
      validateInsightPack(priorPack.payload, { ...source, insight: priorInsight });
      if (!isCurrentSuccessfulTask(context, active)) await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'insight', priorPack);
      return { ...persisted, insight: priorInsight, insight_pack: priorPack };
    }
    if (context.tasks.get(active)?.status === 'succeeded')
      throw new Error('INVALID_INSIGHT_STAGE_ARTIFACT');
    const task = await checkpoint('running');
    const insight =
      priorInsight ??
      (await persistStageArtifact(context, {
        kind: 'insight',
        key: 'insight',
        task,
        payload: buildLegacyInsightPayload(
          source,
          await (provider ?? createProvider()).narrate(bindClaims(persisted.calculation)),
        ),
        inputs: [
          persisted.calculation,
          persisted.comparison,
          persisted.comparison_pack,
          persisted.chart_pack,
          persisted.analysis_pack,
        ],
        limitations: persisted.data_analysis_pack.payload.limitations,
        checks: ['schema', 'hash', 'tenant', 'lineage', 'bounded-narrative'],
      }));
    const payload = buildInsightPack({ ...source, insight });
    validateInsightPack(payload, { ...source, insight });
    const insightPack = await persistStageArtifact(context, {
      kind: 'insight_pack',
      key: 'insight_pack',
      task,
      payload,
      inputs: [
        persisted.data_analysis_pack,
        persisted.comparison_pack,
        persisted.chart_pack,
        persisted.analysis_pack,
        insight,
      ],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'bounded-narrative'],
    });
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'insight', insightPack);
    return { ...persisted, insight, insight_pack: insightPack };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'INSIGHT_AGENT_FAILED'));
    } catch {
      // Cancellation and a newer fencing owner always win over this stage.
    }
    throw error;
  }
}

/** Persists the immutable revision-one draft and stops before publication. */
export async function executeReportDraftStage(
  repository: Repository,
  lease: Lease,
): Promise<AgentDraftStageResult> {
  const context = await loadStageContext(repository, lease, AGENT_WORKFLOW_DAG);
  const active: RunTask['kind'] = 'report';
  const checkpoint = (status: RunTask['status'], errorCode: string | null = null) => {
    return transitionTask(context, active, status, errorCode);
  };
  try {
    const persisted = await loadInsightStageArtifacts(repository, lease);
    const input = { ...persisted, run: lease.run };
    const [existing, current] = await Promise.all([
      optionalArtifact(repository, lease, 'report_draft:1', 'report_draft'),
      repository.artifacts(lease.run.created_by, lease.run.org_id, lease.run.run_id),
    ]);
    for (const artifact of current.artifacts) {
      if (
        !current.validations.some(
          (validation) => validation.artifact_id === artifact.artifact_id && validation.valid,
        )
      )
        throw new Error('UNVALIDATED_ARTIFACT');
      if (
        artifact.source_refs.some(
          (sourceId) =>
            !current.sources.some(
              (source) => source.import_id === sourceId && source.org_id === lease.run.org_id,
            ),
        )
      )
        throw new Error('MISSING_IMPORT_MANIFEST');
    }
    if (existing) {
      validateReportDraft(existing.payload, input);
      // This is the old deterministic serializer/evidence oracle, not Reviewer PASS.
      validateDraftReportCompatibility(
        existing.payload,
        current.artifacts,
        lease.run.org_id,
        lease.run.run_id,
      );
      validateReportDraftArtifact(existing, current.artifacts, lease.run);
      if (!isCurrentSuccessfulTask(context, active)) await checkpoint('succeeded');
      await persistAgentStageMessage(context, 'report');
      return { ...persisted, report_draft: existing };
    }
    if (context.tasks.get(active)?.status === 'succeeded')
      throw new Error('INVALID_REPORT_DRAFT_STAGE_ARTIFACT');
    const task = await checkpoint('running');
    const payload = buildReportDraft(input);
    validateReportDraft(payload, input);
    // This is the old deterministic serializer/evidence oracle, not Reviewer PASS.
    validateDraftReportCompatibility(
      payload,
      current.artifacts,
      lease.run.org_id,
      lease.run.run_id,
    );
    const draft = await persistStageArtifact(context, {
      kind: 'report_draft',
      key: 'report_draft:1',
      task,
      payload,
      inputs: [
        persisted.data_analysis_pack,
        persisted.comparison_pack,
        persisted.chart_pack,
        persisted.analysis_pack,
        persisted.insight_pack,
      ],
      limitations: payload.limitations,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'legacy-report-compatibility'],
    });
    await checkpoint('succeeded');
    await persistAgentStageMessage(context, 'report');
    return { ...persisted, report_draft: draft };
  } catch (error) {
    try {
      await checkpoint('failed', workflowFailureCode(error, 'REPORT_AGENT_FAILED'));
    } catch {
      // Cancellation and a newer fencing owner always win over this stage.
    }
    throw error;
  }
}

/**
 * Non-terminal Phase E execution: data, durable parallel branches, Insight,
 * then a persisted draft. Publication remains intentionally unavailable.
 */
export async function executeAgentThroughDraft(
  repository: Repository,
  lease: Lease,
  provider?: NarrativeProvider,
): Promise<AgentDraftStageResult> {
  await executeCoordinatorAndData(repository, lease);
  await executeIndependentBranches(repository, lease);
  await executeInsightStage(repository, lease, provider);
  return executeReportDraftStage(repository, lease);
}
