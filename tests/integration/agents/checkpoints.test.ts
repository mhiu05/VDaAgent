import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisRequest, DataAnalysisPack } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import {
  calculateDataAgentOutput,
  validateDataAnalysisPack,
} from '../../../src/backend/agents/analysis/specialists/data';
import { executeCoordinatorAndData } from '../../../src/backend/agents/analysis/stages/coordinator-data';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
async function repository() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of resources.splice(0)) {
    await item.repo.close();
    await item.close();
  }
});
const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
function analyticView(pack: DataAnalysisPack) {
  return {
    scope: pack.scope,
    data_as_of: pack.data_as_of,
    semantic_version: pack.semantic_version,
    metric_config: pack.metric_config,
    metrics: pack.metrics,
    units: pack.units,
    age_buckets: pack.age_buckets,
    breakdowns: pack.breakdowns,
    period_comparisons: pack.period_comparisons,
    segment_comparisons: pack.segment_comparisons,
    notable_changes: pack.notable_changes,
    peer_items: pack.peer_items,
    insight_candidates: pack.insight_candidates,
    quality_limitations: pack.quality_limitations,
    limitations: pack.limitations,
  };
}

describe('fenced Coordinator/Data checkpoints', () => {
  it('persists one canonical pack from pinned snapshots, without a report', async () => {
    const repo = await repository();
    const created = await repo.createRun(TEST_USERS.owner, request, 'data-root-persisted');
    const lease = await repo.claimRun('data-root-worker');
    if (!lease) throw new Error('Missing lease');
    const stage = await executeCoordinatorAndData(repo, lease);
    const detail = await repo.getRun(TEST_USERS.owner, created.org_id, created.run_id);
    expect(detail.run).toMatchObject({ status: 'running', workflow_version: 'agent-v1' });
    expect(detail.tasks).toHaveLength(2);
    expect(detail.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'coordinator', status: 'succeeded', dependencies: [] }),
        expect.objectContaining({
          kind: 'data',
          status: 'succeeded',
          dependencies: ['coordinator'],
        }),
      ]),
    );
    expect(
      await repo.artifactByKey(TEST_USERS.owner, created.org_id, created.run_id, 'data.query'),
    ).toEqual(stage.query);
    expect(
      await repo.artifactByKey(
        TEST_USERS.owner,
        created.org_id,
        created.run_id,
        'data_analysis_pack',
      ),
    ).toEqual(stage.data_analysis_pack);
    const pack = stage.data_analysis_pack.payload;
    expect(pack).toMatchObject({
      use_case: 'slow_moving_inventory',
      semantic_version: 'mvp-inventory-v0.2',
      scope: request.scope,
      data_as_of: request.data_as_of,
      dataset: { row_count: 12 },
      metric_config: { slow_moving_threshold_days: 90 },
    });
    expect(() =>
      validateDataAnalysisPack(pack, {
        run: detail.run,
        query: stage.query,
        query_result: stage.query_result,
        calculation: stage.calculation,
        comparison_calculation: stage.comparison_calculation,
        comparison: stage.comparison,
      }),
    ).not.toThrow();
    const exact = calculateDataAgentOutput(detail.run, stage.query_result.payload.rows, 90);
    expect(pack.metrics).toEqual(exact.calculation.metrics);
    expect(pack.peer_items).toEqual(exact.peer_items);
    const bundle = await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id);
    expect(bundle.artifacts).toHaveLength(8);
    expect(bundle.validations).toHaveLength(8);
    expect(bundle.validations.every((value) => value.valid)).toBe(true);
    expect(bundle.artifacts.some((item) => item.kind === 'report')).toBe(false);
  });

  it('loads a complete checkpoint without rereading snapshots or writing artifacts', async () => {
    const repo = await repository();
    await repo.createRun(TEST_USERS.owner, request, 'data-root-rehydrate');
    const lease = await repo.claimRun('data-root-rehydrate-worker');
    if (!lease) throw new Error('Missing lease');
    const first = await executeCoordinatorAndData(repo, lease);
    const read = vi
      .spyOn(repo, 'readSnapshots')
      .mockRejectedValue(new Error('Unexpected snapshot read'));
    const write = vi.spyOn(repo, 'storeArtifact').mockRejectedValue(new Error('Unexpected write'));
    expect(await executeCoordinatorAndData(repo, lease)).toEqual(first);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('produces equivalent analytic numbers for scheduled and interactive input', async () => {
    const repo = await repository();
    const interactive = await repo.createRun(TEST_USERS.owner, request, 'data-root-interactive');
    const firstLease = await repo.claimRun('data-root-interactive-worker');
    if (!firstLease) throw new Error('Missing lease');
    const first = await executeCoordinatorAndData(repo, firstLease);
    const definition = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: request.org_id,
        name: 'Agent daily inventory',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const scheduled = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    const secondLease = await repo.claimRun('data-root-scheduled-worker');
    if (!secondLease || secondLease.run.run_id !== scheduled.run_id)
      throw new Error('Missing scheduled lease');
    const second = await executeCoordinatorAndData(repo, secondLease);
    expect(
      (await repo.getRun(TEST_USERS.owner, request.org_id, scheduled.run_id)).run,
    ).toMatchObject({ entrypoint: 'scheduled', workflow_version: 'agent-v1' });
    expect(analyticView(second.data_analysis_pack.payload)).toEqual(
      analyticView(first.data_analysis_pack.payload),
    );
    expect(interactive.run_id).not.toBe(scheduled.run_id);
  });

  it('resumes after a validation crash without duplicating persisted artifacts', async () => {
    const repo = await repository();
    const created = await repo.createRun(TEST_USERS.owner, request, 'data-root-recovery');
    const lease = await repo.claimRun('data-root-recovery-worker');
    if (!lease) throw new Error('Missing lease');
    const validate = repo.validateArtifact.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'validateArtifact').mockImplementation(async (activeLease, validation) => {
      if (++calls === 4) throw new Error('SIMULATED_CRASH');
      return validate(activeLease, validation);
    });
    await expect(executeCoordinatorAndData(repo, lease)).rejects.toThrow('SIMULATED_CRASH');
    expect(
      (await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id)).artifacts.map(
        (item) => item.kind,
      ),
    ).toEqual(['analysis_request', 'coordinator_decision', 'query', 'query_result']);
    const completed = await executeCoordinatorAndData(repo, lease);
    const bundle = await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id);
    expect(bundle.artifacts).toHaveLength(8);
    expect(new Set(bundle.artifacts.map((item) => item.artifact_id)).size).toBe(8);
    expect(bundle.validations.every((item) => item.valid)).toBe(true);
    expect(
      await repo.artifactByKey(
        TEST_USERS.owner,
        created.org_id,
        created.run_id,
        'data_analysis_pack',
      ),
    ).toEqual(completed.data_analysis_pack);
  });

  it('rejects cancelled and stale lease owners before any Data artifact write', async () => {
    const repo = await repository();
    const staleRun = await repo.createRun(TEST_USERS.owner, request, 'data-root-stale');
    const stale = await repo.claimRun('stale-worker', new Date('2026-09-20T00:00:00Z'), 1);
    if (!stale) throw new Error('Missing lease');
    const current = await repo.claimRun('current-worker', new Date('2026-09-20T00:01:00Z'));
    expect(current?.run.run_id).toBe(staleRun.run_id);
    await expect(executeCoordinatorAndData(repo, stale)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, staleRun.org_id, staleRun.run_id)).artifacts,
    ).toEqual([]);
    await repo.cancelRun(TEST_USERS.owner, staleRun.org_id, staleRun.run_id);
    const cancelledRun = await repo.createRun(TEST_USERS.owner, request, 'data-root-cancelled');
    const cancelled = await repo.claimRun('cancelled-worker');
    if (!cancelled || cancelled.run.run_id !== cancelledRun.run_id)
      throw new Error('Missing cancelled lease');
    await repo.cancelRun(TEST_USERS.owner, cancelledRun.org_id, cancelledRun.run_id);
    await expect(executeCoordinatorAndData(repo, cancelled)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, cancelledRun.org_id, cancelledRun.run_id)).artifacts,
    ).toEqual([]);
  });
});
