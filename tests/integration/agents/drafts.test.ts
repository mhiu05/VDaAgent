import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactSchema,
  ReportPayloadSchema,
  type Artifact,
  type ArtifactOf,
} from '@vda/contracts';
import type { Repository } from '@vda/db';
import { artifactHash, SAFE_SUMMARY, stableId, validateReport } from '@vda/domain';
import { exportReport } from '@vda/domain/reports/export';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { executeCoordinatorAndData } from '../../../src/backend/agents/analysis/stages/coordinator-data';
import {
  executeComparisonBranch,
  executeChartBranch,
  executeAnalystBranch,
} from '../../../src/backend/agents/analysis/stages/branches';
import {
  executeInsightStage,
  executeReportDraftStage,
} from '../../../src/backend/agents/analysis/stages/insight-report';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of resources.splice(0)) {
    await item.repo.close();
    await item.close();
  }
});
const request = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const provider = () => ({
  narrate: vi.fn(async (claims) => ({
    summary: SAFE_SUMMARY,
    claims: [...claims].reverse(),
    provider: 'gemini' as const,
  })),
});
async function start(key: string) {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('Missing lease');
  return { repo, run, lease };
}
async function prepareBranches(
  repo: Repository,
  lease: NonNullable<Awaited<ReturnType<Repository['claimRun']>>>,
) {
  const data = await executeCoordinatorAndData(repo, lease);
  const [comparison, chart, analyst] = await Promise.all([
    executeComparisonBranch(repo, lease, data),
    executeChartBranch(repo, lease, data),
    executeAnalystBranch(repo, lease, data),
  ]);
  return { data, comparison, chart, analyst };
}
function publicReportFromDraft(
  draft: ArtifactOf<'report_draft'>,
  artifacts: Artifact[],
): ArtifactOf<'report'> {
  const kind = (name: Artifact['kind']) => artifacts.find((item) => item.kind === name)!;
  const body = {
    artifact_id: stableId(`${draft.run_id}:report-adapter-root`),
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
      kind('calculation').artifact_id,
      kind('comparison').artifact_id,
      kind('visual_evidence').artifact_id,
      kind('insight').artifact_id,
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

describe('Insight and draft checkpoints', () => {
  it('persists a validated revision-one draft without publishing a report', async () => {
    const { repo, run, lease } = await start('draft-root-happy');
    const narrator = provider();
    const stages = await prepareBranches(repo, lease);
    const insight = await executeInsightStage(repo, lease, narrator);
    const draft = await executeReportDraftStage(repo, lease);
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(narrator.narrate).toHaveBeenCalledOnce();
    expect(detail.run).toMatchObject({ status: 'running', report_artifact_id: null });
    expect(detail.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'insight', status: 'succeeded' }),
        expect.objectContaining({ kind: 'report', status: 'succeeded', dependencies: ['insight'] }),
      ]),
    );
    expect(insight.insight_pack.payload).toMatchObject({
      data_analysis_pack_artifact_id: stages.data.data_analysis_pack.artifact_id,
      comparison_pack_artifact_id: stages.comparison.comparison_pack.artifact_id,
      chart_pack_artifact_id: stages.chart.chart_pack.artifact_id,
      analysis_pack_artifact_id: stages.analyst.analysis_pack.artifact_id,
      provider: 'gemini',
    });
    expect(insight.decision_intelligence_pack.payload).toMatchObject({
      decision_brief: { version: 'decision-brief-v2', requested_data_as_of: request.data_as_of },
      insight_pack_artifact_id: insight.insight_pack.artifact_id,
    });
    expect(draft.report_draft.payload).toMatchObject({
      revision: 1,
      draft_id: stableId(`${run.run_id}:report-draft`),
      data_analysis_pack_artifact_id: stages.data.data_analysis_pack.artifact_id,
      insight_pack_artifact_id: insight.insight_pack.artifact_id,
      decision_intelligence_artifact_id: insight.decision_intelligence_pack.artifact_id,
    });
    expect(
      await repo.artifactByKey(TEST_USERS.owner, run.org_id, run.run_id, 'report_draft:1'),
    ).toEqual(draft.report_draft);
    expect(bundle.artifacts).toHaveLength(16);
    expect(bundle.validations).toHaveLength(16);
    expect(bundle.validations.every((item) => item.valid)).toBe(true);
    expect(bundle.artifacts.some((item) => item.kind === 'report')).toBe(false);
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    expect(() => ReportPayloadSchema.parse(draft.report_draft.payload.report)).not.toThrow();
    expect(() =>
      validateReport(draft.report_draft.payload.report, bundle.artifacts, run.org_id, run.run_id),
    ).not.toThrow();
    const compatible = publicReportFromDraft(draft.report_draft, bundle.artifacts);
    expect(exportReport(compatible, 'json').body).toContain(
      draft.report_draft.payload.report.title,
    );
    expect(exportReport(compatible, 'csv').contentType).toContain('text/csv');
  }, 60_000);

  it('rehydrates every completed stage without another provider or artifact write', async () => {
    const { repo, run, lease } = await start('draft-root-recovery');
    await prepareBranches(repo, lease);
    const narrator = provider();
    const firstInsight = await executeInsightStage(repo, lease, narrator);
    const firstDraft = await executeReportDraftStage(repo, lease);
    const unavailable = {
      narrate: vi.fn(async () => {
        throw new Error('Provider must not run');
      }),
    };
    const read = vi.spyOn(repo, 'readSnapshots').mockRejectedValue(new Error('Unexpected read'));
    const write = vi.spyOn(repo, 'storeArtifact').mockRejectedValue(new Error('Unexpected write'));
    await prepareBranches(repo, lease);
    const insight = await executeInsightStage(repo, lease, unavailable);
    const draft = await executeReportDraftStage(repo, lease);
    expect(narrator.narrate).toHaveBeenCalledOnce();
    expect(unavailable.narrate).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(insight).toEqual(firstInsight);
    expect(draft).toEqual(firstDraft);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(bundle.artifacts).toHaveLength(16);
    expect(new Set(bundle.artifacts.map((item) => item.artifact_id)).size).toBe(16);
  }, 60_000);

  it('keeps successful branches but no draft or report when the narrative provider fails', async () => {
    const { repo, run, lease } = await start('draft-root-provider-failure');
    await prepareBranches(repo, lease);
    await expect(
      executeInsightStage(repo, lease, {
        narrate: async () => {
          throw new Error('ALL_LLM_PROVIDERS_FAILED');
        },
      }),
    ).rejects.toThrow('ALL_LLM_PROVIDERS_FAILED');
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(detail.run.status).toBe('running');
    expect(detail.tasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'insight', status: 'failed' })]),
    );
    expect(bundle.artifacts).toHaveLength(12);
    expect(
      bundle.artifacts.some((item) =>
        ['insight', 'insight_pack', 'report_draft', 'report'].includes(item.kind),
      ),
    ).toBe(false);
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
  }, 60_000);
});
