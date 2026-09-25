import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactSchema,
  ReportPayloadSchema,
  type Artifact,
  type ArtifactOf,
} from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeIndependentBranches } from './analysis-v1/stages/branches';
import {
  executeAgentThroughDraft,
  executeInsightStage,
  executeReportDraftStage,
} from './analysis-v1/stages/insight-report';
import { exportReport } from './index';
import { artifactHash, SAFE_SUMMARY, stableId, validateReport } from '@vda/domain';
import { executeCoordinatorAndData } from './analysis-v1/stages/coordinator-data';

const resources: { repo: Repository; close: () => Promise<void> }[] = [];

async function setup() {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  return repo;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});

const request = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

const narrativeProvider = () => ({
  narrate: vi.fn(async (claims) => ({
    summary: SAFE_SUMMARY,
    // The Insight Agent canonicalizes this provider ordering before persistence.
    claims: [...claims].reverse(),
    provider: 'gemini' as const,
  })),
});

async function start(repo: Repository, key: string, worker = `${key}-worker`) {
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(worker);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
  return { run, lease };
}

function legacyReportAdapter(
  draft: ArtifactOf<'report_draft'>,
  artifacts: Artifact[],
): ArtifactOf<'report'> {
  const byKind = (kind: Artifact['kind']) => artifacts.find((artifact) => artifact.kind === kind)!;
  const calculation = byKind('calculation');
  const comparison = byKind('comparison');
  const chart = byKind('visual_evidence');
  const insight = byKind('insight');
  const body = {
    artifact_id: stableId(`${draft.run_id}:legacy-report-adapter`),
    org_id: draft.org_id,
    run_id: draft.run_id,
    task_id: draft.task_id,
    kind: 'report' as const,
    schema_version: draft.schema_version,
    created_at: draft.created_at,
    semantic_version: draft.semantic_version,
    provisional: true as const,
    data_as_of: draft.data_as_of,
    input_refs: [
      calculation.artifact_id,
      comparison.artifact_id,
      chart.artifact_id,
      insight.artifact_id,
    ].sort(),
    snapshot_refs: draft.snapshot_refs,
    source_refs: draft.source_refs,
    limitations: draft.payload.report.limitations,
    payload: draft.payload.report,
  };
  return ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<'report'>;
}

describe('Insight Agent and immutable ReportDraft workflow', () => {
  it('persists the Insight join and revision-one draft without creating a final report', async () => {
    const repo = await setup();
    const { run, lease } = await start(repo, 'agent-draft-happy');
    const provider = narrativeProvider();
    const result = await executeAgentThroughDraft(repo, lease, provider);
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);

    expect(provider.narrate).toHaveBeenCalledTimes(1);
    expect(detail.run).toMatchObject({ status: 'running', report_artifact_id: null });
    expect(detail.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'insight', status: 'succeeded' }),
        expect.objectContaining({ kind: 'report', status: 'succeeded', dependencies: ['insight'] }),
      ]),
    );
    expect(result.insight_pack.payload).toMatchObject({
      data_analysis_pack_artifact_id: result.data_analysis_pack.artifact_id,
      comparison_pack_artifact_id: result.comparison_pack.artifact_id,
      chart_pack_artifact_id: result.chart_pack.artifact_id,
      analysis_pack_artifact_id: result.analysis_pack.artifact_id,
      provider: 'gemini',
    });
    expect(result.decision_intelligence_pack.payload).toMatchObject({
      decision_brief: {
        version: 'decision-brief-v2',
        requested_data_as_of: run.request.data_as_of,
      },
      insight_pack_artifact_id: result.insight_pack.artifact_id,
    });
    expect(result.report_draft.payload).toMatchObject({
      revision: 1,
      draft_id: stableId(`${run.run_id}:report-draft`),
      data_analysis_pack_artifact_id: result.data_analysis_pack.artifact_id,
      insight_pack_artifact_id: result.insight_pack.artifact_id,
      decision_intelligence_artifact_id: result.decision_intelligence_pack.artifact_id,
    });
    expect(
      await repo.artifactByKey(TEST_USERS.owner, run.org_id, run.run_id, 'report_draft:1'),
    ).toEqual(result.report_draft);
    expect(bundle.artifacts).toHaveLength(16);
    expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    expect(bundle.validations).toHaveLength(16);
    expect(bundle.validations.every((validation) => validation.valid)).toBe(true);

    expect(() => ReportPayloadSchema.parse(result.report_draft.payload.report)).not.toThrow();
    expect(() =>
      validateReport(result.report_draft.payload.report, bundle.artifacts, run.org_id, run.run_id),
    ).not.toThrow();
    const adapter = legacyReportAdapter(result.report_draft, bundle.artifacts);
    expect(exportReport(adapter, 'json').body).toContain(result.report_draft.payload.report.title);
    expect(exportReport(adapter, 'csv').contentType).toContain('text/csv');
  }, 30_000);

  it('rehydrates Coordinator through Draft checkpoints without repeating stage writes', async () => {
    const repo = await setup();
    const { run, lease } = await start(repo, 'agent-draft-recovery');
    await executeCoordinatorAndData(repo, lease);
    await executeIndependentBranches(repo, lease);
    const firstProvider = narrativeProvider();
    const firstInsight = await executeInsightStage(repo, lease, firstProvider);
    const firstDraft = await executeReportDraftStage(repo, lease);
    const unavailableProvider = {
      narrate: vi.fn(async () => {
        throw new Error('PROVIDER_CALLED');
      }),
    };
    const readSnapshots = vi
      .spyOn(repo, 'readSnapshots')
      .mockRejectedValue(new Error('DATA_STAGE_MUST_NOT_RUN_ON_RECOVERY'));
    const storeArtifact = vi
      .spyOn(repo, 'storeArtifact')
      .mockRejectedValue(new Error('ARTIFACT_WRITE_MUST_NOT_RUN_ON_RECOVERY'));

    const recovered = await executeAgentThroughDraft(repo, lease, unavailableProvider);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);

    expect(firstProvider.narrate).toHaveBeenCalledTimes(1);
    expect(unavailableProvider.narrate).not.toHaveBeenCalled();
    expect(readSnapshots).not.toHaveBeenCalled();
    expect(storeArtifact).not.toHaveBeenCalled();
    expect(recovered.insight).toEqual(firstInsight.insight);
    expect(recovered.insight_pack).toEqual(firstInsight.insight_pack);
    expect(recovered.decision_intelligence_pack).toEqual(firstInsight.decision_intelligence_pack);
    expect(recovered.report_draft).toEqual(firstDraft.report_draft);
    expect(bundle.artifacts).toHaveLength(16);
    expect(new Set(bundle.artifacts.map((artifact) => artifact.artifact_id)).size).toBe(16);
  }, 30_000);

  it('preserves branch checkpoints and leaves no draft or report when the bounded provider fails', async () => {
    const repo = await setup();
    const { run, lease } = await start(repo, 'agent-draft-provider-failure');
    await executeCoordinatorAndData(repo, lease);
    await executeIndependentBranches(repo, lease);
    const failingProvider = {
      narrate: vi.fn(async () => {
        throw new Error('ALL_LLM_PROVIDERS_FAILED');
      }),
    };

    await expect(executeInsightStage(repo, lease, failingProvider)).rejects.toThrow(
      'ALL_LLM_PROVIDERS_FAILED',
    );
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);

    expect(detail.run.status).toBe('running');
    expect(detail.tasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'insight', status: 'failed' })]),
    );
    expect(bundle.artifacts).toHaveLength(12);
    expect(
      bundle.artifacts.some((artifact) =>
        ['insight', 'insight_pack', 'report_draft', 'report'].includes(artifact.kind),
      ),
    ).toBe(false);
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
  }, 30_000);
});
