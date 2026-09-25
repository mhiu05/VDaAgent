import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import {
  artifactHash,
  executeAgentWorkflow,
  exportReport,
  SAFE_SUMMARY,
  type NarrativeProvider,
  validateReport,
} from '@vda/agents';
import { ReportPayloadSchema, type AnalysisRequest } from '@vda/contracts';
import { createTestRepository } from '../helpers/postgres.js';
const resources: { repo: Repository; close: () => Promise<void> }[] = [];
async function setup() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});
const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Phân tích tồn kho',
  conversation_id: null,
};
const deterministicProvider = (): NarrativeProvider => ({
  narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
});
async function runPipeline(repo: Repository, key = 'pipeline') {
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun('test-worker', new Date(), 240_000);
  expect(lease).not.toBeNull();
  await executeAgentWorkflow(repo, lease!, { narrativeProvider: deterministicProvider() });
  return { run, lease: lease! };
}
describe('persisted DAG and truth chain', () => {
  it('recovers validation after a crash between query-result persistence and validation', async () => {
    const repo = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'crash-validation');
    const validate = repo.validateArtifact.bind(repo);
    let interrupted = false;
    vi.spyOn(repo, 'validateArtifact').mockImplementation(async (lease, record) => {
      const bundle = await repo.artifacts(run.created_by, run.org_id, run.run_id);
      if (
        !interrupted &&
        bundle.artifacts.some(
          (a) => a.artifact_id === record.artifact_id && a.kind === 'query_result',
        )
      ) {
        interrupted = true;
        throw new Error('SIMULATED_CRASH');
      }
      return validate(lease, record);
    });
    await expect(
      executeAgentWorkflow(repo, (await repo.claimRun('first', new Date(), 240_000))!, {
        narrativeProvider: deterministicProvider(),
      }),
    ).rejects.toThrow('SIMULATED_CRASH');
    await repo.retryRun(TEST_USERS.owner, run.org_id, run.run_id);
    await executeAgentWorkflow(repo, (await repo.claimRun('recovery', new Date(), 240_000))!, {
      narrativeProvider: deterministicProvider(),
    });
    expect((await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id)).run.status).toBe(
      'succeeded',
    );
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
  }, 120_000);
  it('keeps metrics null when the selected date has no snapshot', async () => {
    const repo = await setup();
    const run = await repo.createRun(
      TEST_USERS.owner,
      { ...request, data_as_of: '2026-01-01' },
      'empty',
    );
    await executeAgentWorkflow(repo, (await repo.claimRun('empty-worker', new Date(), 240_000))!, {
      narrativeProvider: deterministicProvider(),
    });
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const report = bundle.artifacts.find((a) => a.kind === 'report')!;
    expect(report.payload.metrics.every((m) => m.value === null)).toBe(true);
    expect(report.payload.units).toEqual([]);
  }, 120_000);
  it('publishes complete immutable report and resolves every numeric claim', async () => {
    const repo = await setup();
    const { run } = await runPipeline(repo);
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    expect(detail.run.status).toBe('succeeded');
    expect(detail.tasks).toHaveLength(9);
    expect(detail.tasks.every((t) => t.status === 'succeeded')).toBe(true);
    const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(bundle.artifacts.length).toBeGreaterThanOrEqual(10);
    expect(bundle.validations.every((v) => v.valid)).toBe(true);
    expect(bundle.sources).toHaveLength(1);
    const report = bundle.artifacts.find((a) => a.kind === 'report')!;
    expect(report.content_hash).toBe(artifactHash(report));
    expect(report.payload.decision_brief).toMatchObject({
      requested_data_as_of: request.data_as_of,
      effective_snapshot_date: '2026-09-19',
    });
    expect(
      Object.fromEntries(report.payload.metrics.map((metric) => [metric.key, metric.value])),
    ).toMatchObject({
      total_inventory: 12,
      available_inventory: 10,
      sold_units_30d: 1,
      slow_moving_units: 6,
      unknown_inventory_age: 1,
    });
    expect(() =>
      validateReport(report.payload, bundle.artifacts, run.org_id, run.run_id),
    ).not.toThrow();
    const json = exportReport(report, 'json');
    expect(JSON.parse(json.body)).toEqual(report);
    expect(exportReport(report, 'csv').body).toContain(report.payload.calculation_artifact_id);
    const messages = await repo.messages(
      TEST_USERS.owner,
      run.org_id,
      run.request.conversation_id!,
    );
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(
      messages.filter((message) => message.role === 'assistant' && message.sender_agent === null),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.role === 'assistant' && message.sender_agent !== null)
        .length,
    ).toBeGreaterThan(0);
    expect(await repo.decisionBrief(TEST_USERS.viewer, run.org_id, run.run_id)).toMatchObject({
      run_id: run.run_id,
      org_id: run.org_id,
      calculation_artifact_id: report.payload.calculation_artifact_id,
    });
    await expect(repo.decisionBrief(TEST_USERS.beta, run.org_id, run.run_id)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
    await expect(repo.artifacts(TEST_USERS.beta, run.org_id, run.run_id)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
  }, 120_000);
  it('rejects fabricated values, missing query lineage, and cross-tenant ancestors', async () => {
    const repo = await setup();
    const { run } = await runPipeline(repo);
    const { artifacts } = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const report = artifacts.find((a) => a.kind === 'report')!;
    const fabricated = structuredClone(report.payload);
    fabricated.claims[0].value = 999;
    expect(() => validateReport(fabricated, artifacts, run.org_id, run.run_id)).toThrow(
      'UNGROUNDED_CLAIM',
    );
    const fabricatedField = structuredClone(report.payload);
    Object.assign(fabricatedField.claims[0], { fabricated_numeric: 999 });
    expect(() => validateReport(fabricatedField, artifacts, run.org_id, run.run_id)).toThrow();
    const inventedClaim = structuredClone(report.payload);
    inventedClaim.claims[0].claim_id = 'invented-claim';
    expect(() => validateReport(inventedClaim, artifacts, run.org_id, run.run_id)).toThrow(
      'UNGROUNDED_CLAIM',
    );
    const invalidEvidence = structuredClone(report.payload);
    invalidEvidence.claims[0].evidence_path = 'payload.metrics[999].value';
    expect(() => validateReport(invalidEvidence, artifacts, run.org_id, run.run_id)).toThrow(
      'UNGROUNDED_CLAIM',
    );
    const fabricatedBrief = structuredClone(report.payload);
    fabricatedBrief.decision_brief!.current_state[0].current_value = 999;
    expect(() => validateReport(fabricatedBrief, artifacts, run.org_id, run.run_id)).toThrow(
      'INVALID_DECISION_BRIEF',
    );
    const invalidBriefEvidence = structuredClone(report.payload);
    invalidBriefEvidence.decision_brief!.current_state[0].evidence[0].path =
      'payload.metrics[999].value';
    expect(() => validateReport(invalidBriefEvidence, artifacts, run.org_id, run.run_id)).toThrow(
      'INVALID_EVIDENCE_PATH',
    );
    const duplicateBriefSignal = structuredClone(report.payload);
    duplicateBriefSignal.decision_brief!.current_state[1].signal_id =
      duplicateBriefSignal.decision_brief!.current_state[0].signal_id;
    expect(() => validateReport(duplicateBriefSignal, artifacts, run.org_id, run.run_id)).toThrow();
    const mismatchedBriefUnit = structuredClone(report.payload);
    mismatchedBriefUnit.decision_brief!.current_state[0].unit = 'percent';
    expect(() => validateReport(mismatchedBriefUnit, artifacts, run.org_id, run.run_id)).toThrow(
      'INVALID_DECISION_BRIEF',
    );
    const mismatchedBriefCurrency = structuredClone(report.payload);
    mismatchedBriefCurrency.decision_brief!.current_state[0].currency = 'USD';
    expect(() =>
      validateReport(mismatchedBriefCurrency, artifacts, run.org_id, run.run_id),
    ).toThrow();
    const crossRunBrief = structuredClone(report.payload);
    crossRunBrief.decision_brief!.current_state[0].evidence[0].artifact_id =
      '90000000-0000-4000-8000-000000000001';
    expect(() => validateReport(crossRunBrief, artifacts, run.org_id, run.run_id)).toThrow(
      'CROSS_RUN_DECISION_BRIEF',
    );
    expect(() =>
      validateReport(
        report.payload,
        artifacts.filter((a) => a.kind !== 'query'),
        run.org_id,
        run.run_id,
      ),
    ).toThrow('BROKEN_LINEAGE');
    const nonUpstream = structuredClone(artifacts);
    const calculation = nonUpstream.find((artifact) => artifact.kind === 'calculation')!;
    calculation.source_refs.push('90000000-0000-4000-8000-000000000001');
    calculation.content_hash = artifactHash(calculation);
    expect(() => validateReport(report.payload, nonUpstream, run.org_id, run.run_id)).toThrow(
      'NON_UPSTREAM_LINEAGE_REFERENCE',
    );
    const incompatibleDate = structuredClone(artifacts);
    const comparison = incompatibleDate.find((artifact) => artifact.kind === 'comparison')!;
    comparison.data_as_of = '2026-09-18';
    comparison.content_hash = artifactHash(comparison);
    expect(() => validateReport(report.payload, incompatibleDate, run.org_id, run.run_id)).toThrow(
      'INCOMPATIBLE_ARTIFACT_VERSION',
    );
    const foreign = structuredClone(artifacts);
    foreign[0].org_id = TEST_ORGS.beta;
    expect(() => validateReport(report.payload, foreign, run.org_id, run.run_id)).toThrow(
      'BROKEN_LINEAGE',
    );
  }, 120_000);
  it('keeps historical report payloads without a decision brief readable', async () => {
    const repo = await setup();
    const { run } = await runPipeline(repo, 'historical-report');
    const { artifacts } = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const report = artifacts.find((artifact) => artifact.kind === 'report')!;
    const historical = structuredClone(report.payload);
    delete historical.decision_brief;
    expect(() => ReportPayloadSchema.parse(historical)).not.toThrow();
    expect(() => validateReport(historical, artifacts, run.org_id, run.run_id)).not.toThrow();
  }, 120_000);
  it('resumes persisted upstream outputs after provider failure without duplicate publication', async () => {
    const repo = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'retry');
    const first = await repo.claimRun('worker-one', new Date(), 240_000);
    const bad = {
      narrate: vi.fn().mockRejectedValue(new Error('PROVIDER_UNAVAILABLE')),
    };
    await expect(executeAgentWorkflow(repo, first!, { narrativeProvider: bad })).rejects.toThrow(
      'PROVIDER_UNAVAILABLE',
    );
    const before = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const hashes = before.artifacts.map((a) => a.content_hash);
    await repo.retryRun(TEST_USERS.owner, run.org_id, run.run_id);
    await executeAgentWorkflow(repo, (await repo.claimRun('worker-two', new Date(), 240_000))!, {
      narrativeProvider: deterministicProvider(),
    });
    const after = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(hashes.every((hash) => after.artifacts.some((a) => a.content_hash === hash))).toBe(true);
    expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
  }, 120_000);
  it('scheduled and interactive entries execute the same artifact pipeline', async () => {
    const repo = await setup();
    await runPipeline(repo);
    const definition = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: request.org_id,
        name: 'Daily',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const one = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    const two = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    expect(one.run_id).toBe(two.run_id);
    await executeAgentWorkflow(
      repo,
      (await repo.claimRun('scheduler-worker', new Date(), 240_000))!,
      { narrativeProvider: deterministicProvider() },
    );
    const scheduled = await repo.artifacts(TEST_USERS.owner, request.org_id, one.run_id);
    expect(
      Object.fromEntries(
        scheduled.artifacts
          .find((a) => a.kind === 'report')!
          .payload.metrics.map((metric) => [metric.key, metric.value]),
      ),
    ).toMatchObject({ total_inventory: 12, available_inventory: 10, sold_units_30d: 1 });
    expect(await repo.listReports(TEST_USERS.owner, request.org_id)).toHaveLength(2);
  }, 120_000);
});
