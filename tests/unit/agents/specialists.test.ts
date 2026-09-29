import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisRequest, Artifact, ArtifactOf, DataAnalysisPack } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import {
  CoordinatorError,
  coordinateRun,
} from '../../../src/backend/agents/analysis/specialists/coordinator';
import { executeCoordinatorAndData } from '../../../src/backend/agents/analysis/stages/coordinator-data';
import {
  buildDataAnalysisPack,
  calculateDataAgentOutput,
  validateDataAnalysisPack,
} from '../../../src/backend/agents/analysis/specialists/data';

const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
async function repository() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.repo.close();
    await resource.close();
  }
});
function find<K extends Artifact['kind']>(artifacts: Artifact[], kind: K): ArtifactOf<K> {
  const value = artifacts.find((item) => item.kind === kind);
  if (!value) throw new Error(`Missing ${kind}`);
  return value as ArtifactOf<K>;
}
async function dataPack(repo: Repository, key: string) {
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`);
  if (!lease) throw new Error('Missing lease');
  await executeCoordinatorAndData(repo, lease);
  const [{ run: persisted }, { artifacts }] = await Promise.all([
    repo.getRun(TEST_USERS.owner, run.org_id, run.run_id),
    repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id),
  ]);
  const sources = {
    run: persisted,
    query: find(artifacts, 'query'),
    query_result: find(artifacts, 'query_result'),
    calculation: find(artifacts, 'calculation'),
    comparison_calculation: find(artifacts, 'comparison_calculation'),
    comparison: find(artifacts, 'comparison'),
  };
  return { pack: buildDataAnalysisPack(sources), sources };
}

describe('current Coordinator and Data specialists', () => {
  it('selects the registered use case with the exact interactive scope and date', async () => {
    const repo = await repository();
    const created = await repo.createRun(TEST_USERS.owner, request, 'coordinator-interactive-root');
    const { run } = await repo.getRun(TEST_USERS.owner, request.org_id, created.run_id);
    const decision = coordinateRun({ run });
    expect(decision).toMatchObject({
      use_case: 'slow_moving_inventory',
      use_case_version: 'slow-moving-inventory-v2',
      scope: request.scope,
      requested_data_as_of: request.data_as_of,
      effective_data_as_of: request.data_as_of,
      comparison_windows_days: [7, 30, 90],
      entrypoint: 'interactive',
      action: 'new_run',
    });
    expect(coordinateRun({ run })).toEqual(decision);
    expect(() => coordinateRun({ run, requested_capability: 'unknown' as never })).toThrow(
      CoordinatorError,
    );
    expect(() =>
      coordinateRun({ run: { ...run, request: { ...run.request, use_case: 'unknown' as never } } }),
    ).toThrow('UNKNOWN_USE_CASE');
  });

  it('uses the same data decision for a scheduled occurrence', async () => {
    const repo = await repository();
    const interactive = await repo.createRun(TEST_USERS.owner, request, 'coordinator-parity-root');
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
    const occurrence = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    const [a, b] = await Promise.all([
      repo.getRun(TEST_USERS.owner, request.org_id, interactive.run_id),
      repo.getRun(TEST_USERS.owner, request.org_id, occurrence.run_id),
    ]);
    const interactiveDecision = coordinateRun({ run: a.run });
    const scheduledDecision = coordinateRun({ run: b.run });
    expect(scheduledDecision.entrypoint).toBe('scheduled');
    expect({
      use_case: scheduledDecision.use_case,
      scope: scheduledDecision.scope,
      date: scheduledDecision.effective_data_as_of,
      windows: scheduledDecision.comparison_windows_days,
    }).toEqual({
      use_case: interactiveDecision.use_case,
      scope: interactiveDecision.scope,
      date: interactiveDecision.effective_data_as_of,
      windows: interactiveDecision.comparison_windows_days,
    });
  });

  it('projects immutable Data artifacts and rejects a changed metric', async () => {
    const repo = await repository();
    const { pack, sources } = await dataPack(repo, 'data-pack-root');
    expect(pack).toMatchObject({
      use_case: 'slow_moving_inventory',
      semantic_version: 'mvp-inventory-v0.2',
      dataset: { row_count: 12 },
      metric_config: { slow_moving_threshold_days: 90 },
    });
    expect(pack.evidence_refs.some((ref) => ref.path === 'payload')).toBe(true);
    const output = calculateDataAgentOutput(sources.run, sources.query_result.payload.rows, 90);
    expect(pack.metrics).toEqual(output.calculation.metrics);
    expect(pack.peer_items).toEqual(output.peer_items);
    expect(() => validateDataAnalysisPack(pack, sources)).not.toThrow();
    const changed: DataAnalysisPack = structuredClone(pack);
    changed.metrics[0]!.value = 999;
    expect(() => validateDataAnalysisPack(changed, sources)).toThrow('DATA_AGENT_LINEAGE_MISMATCH');
  });
});
