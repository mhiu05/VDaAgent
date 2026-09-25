import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { type AnalysisRequest, type DataAnalysisPack } from '@vda/contracts';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import {
  calculateDataAgentOutput,
  validateDataAnalysisPack,
} from './analysis-v1/agents/data-agent';
import { executeCoordinatorAndData } from './analysis-v1/stages/coordinator-data';

const resources: { repo: Repository; close: () => Promise<void> }[] = [];

async function setup() {
  const { pg, repo } = await createTestRepository();
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

const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

async function executeDataStage(repo: Repository, runId: string, workerId: string) {
  const lease = await repo.claimRun(workerId);
  if (!lease || lease.run.run_id !== runId) throw new Error('LEASE_REQUIRED');
  return { lease, result: await executeCoordinatorAndData(repo, lease) };
}

function analyticalView(pack: DataAnalysisPack) {
  return {
    use_case: pack.use_case,
    use_case_version: pack.use_case_version,
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

describe('persisted Coordinator and Data Agent workflow', () => {
  it('writes one exact canonical pack from the fenced, pinned snapshot read', async () => {
    const repo = await setup();
    const created = await repo.createRun(TEST_USERS.owner, request, 'agent-data-persisted');
    const { result } = await executeDataStage(repo, created.run_id, 'agent-data-worker');
    const detail = await repo.getRun(TEST_USERS.owner, created.org_id, created.run_id);
    const pack = result.data_analysis_pack.payload;

    expect(detail.run).toMatchObject({ status: 'running', workflow_version: 'agent-v1' });
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
    expect(detail.tasks).toHaveLength(2);
    expect(
      await repo.artifactByKey(TEST_USERS.owner, created.org_id, created.run_id, 'data.query'),
    ).toEqual(result.query);
    expect(
      await repo.artifactByKey(
        TEST_USERS.owner,
        created.org_id,
        created.run_id,
        'data_analysis_pack',
      ),
    ).toEqual(result.data_analysis_pack);
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
        query: result.query,
        query_result: result.query_result,
        calculation: result.calculation,
        comparison_calculation: result.comparison_calculation,
        comparison: result.comparison,
      }),
    ).not.toThrow();
    const expected = calculateDataAgentOutput(detail.run, result.query_result.payload.rows, 90);
    expect(pack.metrics).toEqual(expected.calculation.metrics);
    expect(pack.peer_items).toEqual(expected.peer_items);

    const bundle = await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id);
    expect(bundle.artifacts).toHaveLength(8);
    expect(bundle.validations).toHaveLength(8);
    expect(bundle.validations.every((validation) => validation.valid)).toBe(true);
    expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
  });

  it('rehydrates a complete Coordinator/Data checkpoint without another stage write or snapshot read', async () => {
    const repo = await setup();
    const created = await repo.createRun(TEST_USERS.owner, request, 'agent-data-complete-recovery');
    const { lease, result: first } = await executeDataStage(
      repo,
      created.run_id,
      'agent-data-complete-recovery-worker',
    );
    const readSnapshots = vi
      .spyOn(repo, 'readSnapshots')
      .mockRejectedValue(new Error('DATA_STAGE_MUST_NOT_RUN_ON_RECOVERY'));
    const storeArtifact = vi
      .spyOn(repo, 'storeArtifact')
      .mockRejectedValue(new Error('ARTIFACT_WRITE_MUST_NOT_RUN_ON_RECOVERY'));

    const recovered = await executeCoordinatorAndData(repo, lease);

    expect(recovered).toEqual(first);
    expect(readSnapshots).not.toHaveBeenCalled();
    expect(storeArtifact).not.toHaveBeenCalled();
  });

  it('gives scheduled and interactive entries equivalent canonical analytical output', async () => {
    const repo = await setup();
    const interactive = await repo.createRun(TEST_USERS.owner, request, 'agent-data-interactive');
    const first = await executeDataStage(repo, interactive.run_id, 'interactive-worker');
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
    const second = await executeDataStage(repo, scheduled.run_id, 'scheduled-worker');

    expect(
      (await repo.getRun(TEST_USERS.owner, request.org_id, scheduled.run_id)).run,
    ).toMatchObject({
      entrypoint: 'scheduled',
      workflow_version: 'agent-v1',
    });
    expect(analyticalView(second.result.data_analysis_pack.payload)).toEqual(
      analyticalView(first.result.data_analysis_pack.payload),
    );
  });

  it('revalidates persisted checkpoints after an interruption without duplicating artifacts', async () => {
    const repo = await setup();
    const created = await repo.createRun(TEST_USERS.owner, request, 'agent-data-recovery');
    const lease = await repo.claimRun('recovery-worker');
    if (!lease) throw new Error('LEASE_REQUIRED');
    const validateArtifact = repo.validateArtifact.bind(repo);
    let validations = 0;
    vi.spyOn(repo, 'validateArtifact').mockImplementation(async (activeLease, validation) => {
      validations++;
      if (validations === 4) throw new Error('SIMULATED_CRASH');
      return validateArtifact(activeLease, validation);
    });

    await expect(executeCoordinatorAndData(repo, lease)).rejects.toThrow('SIMULATED_CRASH');
    const partial = await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id);
    expect(partial.artifacts.map((artifact) => artifact.kind)).toEqual([
      'analysis_request',
      'coordinator_decision',
      'query',
      'query_result',
    ]);

    const recovered = await executeCoordinatorAndData(repo, lease);
    const complete = await repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id);
    expect(complete.artifacts).toHaveLength(8);
    expect(new Set(complete.artifacts.map((artifact) => artifact.artifact_id)).size).toBe(8);
    expect(
      await repo.artifactByKey(
        TEST_USERS.owner,
        created.org_id,
        created.run_id,
        'data_analysis_pack',
      ),
    ).toEqual(recovered.data_analysis_pack);
    expect(complete.validations.every((validation) => validation.valid)).toBe(true);
  });

  it('denies stale or cancelled ownership before any Data artifact write', async () => {
    const repo = await setup();
    const staleRun = await repo.createRun(TEST_USERS.owner, request, 'agent-data-stale');
    const stale = await repo.claimRun('stale-worker', new Date('2026-09-20T00:00:00Z'), 1);
    if (!stale) throw new Error('LEASE_REQUIRED');
    const current = await repo.claimRun('current-worker', new Date('2026-09-20T00:01:00Z'));
    expect(current?.run.run_id).toBe(staleRun.run_id);
    await expect(executeCoordinatorAndData(repo, stale)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, staleRun.org_id, staleRun.run_id)).artifacts,
    ).toEqual([]);
    await repo.cancelRun(TEST_USERS.owner, staleRun.org_id, staleRun.run_id);

    const cancelledRun = await repo.createRun(TEST_USERS.owner, request, 'agent-data-cancelled');
    const cancelled = await repo.claimRun('cancelled-worker');
    if (!cancelled || cancelled.run.run_id !== cancelledRun.run_id)
      throw new Error('LEASE_REQUIRED');
    await repo.cancelRun(TEST_USERS.owner, cancelledRun.org_id, cancelledRun.run_id);
    await expect(executeCoordinatorAndData(repo, cancelled)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, cancelledRun.org_id, cancelledRun.run_id)).artifacts,
    ).toEqual([]);
  });
});
