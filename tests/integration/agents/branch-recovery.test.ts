import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import {
  ChartBuilder,
  chartPayloadFingerprint,
} from '../../../src/backend/agents/analysis/chart-builder';
import { executeCoordinatorAndData } from '../../../src/backend/agents/analysis/stages/coordinator-data';
import {
  executeAnalystBranch,
  executeChartBranch,
  executeComparisonBranch,
} from '../../../src/backend/agents/analysis/stages/branches';

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
async function fixture(key: string) {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('Missing lease');
  const data = await executeCoordinatorAndData(repo, lease);
  return { repo, run, lease, data };
}
const executeBranches = (repo: Repository, lease: Awaited<ReturnType<Repository['claimRun']>>) => {
  if (!lease) throw new Error('Missing lease');
  return Promise.all([
    executeComparisonBranch(repo, lease),
    executeChartBranch(repo, lease),
    executeAnalystBranch(repo, lease),
  ]);
};

describe('independent analysis branches', () => {
  it('starts all three before any branch finishes and preserves deterministic charts', async () => {
    const { repo, run, lease, data } = await fixture('branches-root-parallel');
    const setTask = repo.setTask.bind(repo);
    let started = 0;
    let announce!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(repo, 'setTask').mockImplementation(async (activeLease, task) => {
      if (task.status === 'running' && ['comparison', 'chart', 'analyst'].includes(task.kind)) {
        started++;
        if (started === 3) announce();
        await gate;
      }
      return setTask(activeLease, task);
    });
    const pending = executeBranches(repo, lease);
    await allStarted;
    expect(started).toBe(3);
    release();
    const [comparison, chart, analyst] = await pending;
    const expected = new ChartBuilder().build({
      calculation: data.calculation,
      comparison: data.comparison,
    });
    expect(chartPayloadFingerprint(chart.visual_evidence.payload)).toBe(
      chartPayloadFingerprint(expected),
    );
    expect(chart.visual_evidence.payload).toEqual(expected);
    expect(comparison.comparison_pack.payload).toMatchObject({
      data_analysis_pack_artifact_id: data.data_analysis_pack.artifact_id,
      comparisons: data.data_analysis_pack.payload.peer_items,
      period_comparisons: data.data_analysis_pack.payload.period_comparisons,
    });
    expect(chart.chart_pack.payload.data_analysis_pack_artifact_id).toBe(
      data.data_analysis_pack.artifact_id,
    );
    expect(
      analyst.analysis_pack.payload.findings.every((item) => item.kind === 'descriptive'),
    ).toBe(true);
    const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
    expect(detail.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'comparison',
          status: 'succeeded',
          dependencies: ['data'],
        }),
        expect.objectContaining({ kind: 'chart', status: 'succeeded', dependencies: ['data'] }),
        expect.objectContaining({ kind: 'analyst', status: 'succeeded', dependencies: ['data'] }),
      ]),
    );
    expect((await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id)).artifacts).toHaveLength(
      12,
    );
  }, 60_000);

  it('keeps successful peers and retries only a failed chart from persisted inputs', async () => {
    const { repo, run, lease } = await fixture('branches-root-recovery');
    const store = repo.storeArtifact.bind(repo);
    let failed = false;
    let recovering = false;
    const writes: string[] = [];
    vi.spyOn(repo, 'storeArtifact').mockImplementation(async (activeLease, artifact, options) => {
      if (!failed && artifact.kind === 'visual_evidence') {
        failed = true;
        throw new Error('SIMULATED_BRANCH_FAILURE');
      }
      if (recovering) {
        if (['comparison_pack', 'analysis_pack'].includes(artifact.kind))
          throw new Error('Successful branch reran');
        writes.push(artifact.kind);
      }
      return store(activeLease, artifact, options);
    });
    const first = await Promise.allSettled([
      executeComparisonBranch(repo, lease),
      executeChartBranch(repo, lease),
      executeAnalystBranch(repo, lease),
    ]);
    expect(first[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: 'SIMULATED_BRANCH_FAILURE',
      }),
    });
    const partial = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const preserved = partial.artifacts
      .filter((item) => item.kind === 'comparison_pack' || item.kind === 'analysis_pack')
      .map((item) => item.artifact_id)
      .sort();
    expect(preserved).toHaveLength(2);
    recovering = true;
    const [comparison, chart, analyst] = await executeBranches(repo, lease);
    expect(comparison.comparison_pack.artifact_id).toBe(
      preserved.find((id) => id === comparison.comparison_pack.artifact_id),
    );
    expect(analyst.analysis_pack.artifact_id).toBe(
      preserved.find((id) => id === analyst.analysis_pack.artifact_id),
    );
    expect(writes).toEqual(['visual_evidence', 'chart_pack']);
    expect(chart.chart_pack.payload.charts).toEqual(chart.visual_evidence.payload.charts);
    const complete = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(complete.artifacts).toHaveLength(12);
    expect(
      complete.artifacts
        .filter((item) => item.kind === 'comparison_pack' || item.kind === 'analysis_pack')
        .map((item) => item.artifact_id)
        .sort(),
    ).toEqual(preserved);
  }, 60_000);

  it('refuses branch writes after cancellation or a fencing-owner change', async () => {
    const { repo, run, lease } = await fixture('branches-root-cancelled');
    await repo.cancelRun(TEST_USERS.owner, run.org_id, run.run_id);
    await expect(executeChartBranch(repo, lease)).rejects.toThrow('LEASE_LOST');
    expect((await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id)).artifacts).toHaveLength(
      8,
    );
    const next = await repo.createRun(TEST_USERS.owner, request, 'branches-root-stale');
    const stale = await repo.claimRun('branches-root-stale-worker');
    if (!stale || stale.run.run_id !== next.run_id) throw new Error('Missing stale lease');
    await executeCoordinatorAndData(repo, stale);
    const replacement = await repo.claimRun(
      'branches-root-replacement',
      new Date(Date.now() + 60_000),
    );
    expect(replacement?.run.run_id).toBe(next.run_id);
    await expect(executeComparisonBranch(repo, stale)).rejects.toThrow('LEASE_LOST');
  }, 60_000);
});
