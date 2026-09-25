import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { ChartBuilder, chartPayloadFingerprint } from './analysis/chart-builder';
import { executeIndependentBranches } from './analysis-v1/stages/branches';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import {
  executeCoordinatorAndData,
  loadDataStageArtifacts,
} from './analysis-v1/stages/coordinator-data';

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

const request = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

async function startData(repo: Repository, key: string, worker = `${key}-data`) {
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(worker);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
  await executeCoordinatorAndData(repo, lease);
  return { run, lease, data: await loadDataStageArtifacts(repo, lease) };
}

describe('independent Comparison, Chart, and Analyst branches', () => {
  it('starts all three branches before any is allowed to continue, and preserves chart equality', async () => {
    const repo = await setup();
    const { run, lease, data } = await startData(repo, 'branch-concurrency');
    const setTask = repo.setTask.bind(repo);
    let entered = 0;
    let signalStarted!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(repo, 'setTask').mockImplementation(async (activeLease, task) => {
      if (
        task.status === 'running' &&
        (task.kind === 'comparison' || task.kind === 'chart' || task.kind === 'analyst')
      ) {
        entered++;
        if (entered === 3) signalStarted();
        await gate;
      }
      return setTask(activeLease, task);
    });

    const branches = executeIndependentBranches(repo, lease);
    await allStarted;
    expect(entered).toBe(3);
    release();
    const result = await branches;

    const expectedVisual = new ChartBuilder().build({
      calculation: data.calculation,
      comparison: data.comparison,
    });
    expect(chartPayloadFingerprint(result.visual_evidence.payload)).toBe(
      chartPayloadFingerprint(expectedVisual),
    );
    expect(result.visual_evidence.payload).toEqual(expectedVisual);
    expect(result.comparison_pack.payload).toMatchObject({
      data_analysis_pack_artifact_id: data.data_analysis_pack.artifact_id,
      comparisons: data.data_analysis_pack.payload.peer_items,
      period_comparisons: data.data_analysis_pack.payload.period_comparisons,
    });
    expect(result.chart_pack.payload.data_analysis_pack_artifact_id).toBe(
      data.data_analysis_pack.artifact_id,
    );
    expect(result.analysis_pack.payload.data_analysis_pack_artifact_id).toBe(
      data.data_analysis_pack.artifact_id,
    );
    expect(
      result.analysis_pack.payload.findings.every((finding) => finding.kind === 'descriptive'),
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
  }, 30_000);

  it('preserves successful peer branches and resumes the failed chart branch from persisted inputs', async () => {
    const repo = await setup();
    const { run, lease } = await startData(repo, 'branch-recovery');
    const storeArtifact = repo.storeArtifact.bind(repo);
    let interrupted = false;
    let recovering = false;
    const recoveryWrites: string[] = [];
    vi.spyOn(repo, 'storeArtifact').mockImplementation(async (activeLease, artifact, options) => {
      if (!interrupted && artifact.kind === 'visual_evidence') {
        interrupted = true;
        throw new Error('SIMULATED_BRANCH_FAILURE');
      }
      if (recovering) {
        if (artifact.kind === 'comparison_pack' || artifact.kind === 'analysis_pack')
          throw new Error('SUCCESSFUL_BRANCH_MUST_NOT_RUN_ON_RECOVERY');
        recoveryWrites.push(artifact.kind);
      }
      return storeArtifact(activeLease, artifact, options);
    });

    await expect(executeIndependentBranches(repo, lease)).rejects.toThrow(
      'SIMULATED_BRANCH_FAILURE',
    );
    const partial = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    const preserved = partial.artifacts
      .filter(
        (artifact) => artifact.kind === 'comparison_pack' || artifact.kind === 'analysis_pack',
      )
      .map((artifact) => artifact.artifact_id)
      .sort();
    expect(preserved).toHaveLength(2);
    expect((await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id)).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'comparison', status: 'succeeded' }),
        expect.objectContaining({ kind: 'analyst', status: 'succeeded' }),
        expect.objectContaining({ kind: 'chart', status: 'failed' }),
      ]),
    );

    recovering = true;
    const recovered = await executeIndependentBranches(repo, lease);
    const complete = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
    expect(complete.artifacts).toHaveLength(12);
    expect(
      complete.artifacts
        .filter(
          (artifact) => artifact.kind === 'comparison_pack' || artifact.kind === 'analysis_pack',
        )
        .map((artifact) => artifact.artifact_id)
        .sort(),
    ).toEqual(preserved);
    expect(recoveryWrites).toEqual(['visual_evidence', 'chart_pack']);
    expect(recovered.chart_pack.payload.charts).toEqual(recovered.visual_evidence.payload.charts);
    expect((await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id)).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'comparison', status: 'succeeded' }),
        expect.objectContaining({ kind: 'chart', status: 'succeeded' }),
        expect.objectContaining({ kind: 'analyst', status: 'succeeded' }),
      ]),
    );
  });

  it('denies branch writes after cancellation or a fencing-owner change', async () => {
    const repo = await setup();
    const cancelled = await startData(repo, 'branch-cancelled');
    await repo.cancelRun(TEST_USERS.owner, cancelled.run.org_id, cancelled.run.run_id);
    await expect(executeIndependentBranches(repo, cancelled.lease)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, cancelled.run.org_id, cancelled.run.run_id))
        .artifacts,
    ).toHaveLength(8);

    const stale = await startData(repo, 'branch-stale');
    const current = await repo.claimRun('replacement-worker', new Date(Date.now() + 60_000));
    expect(current?.run.run_id).toBe(stale.run.run_id);
    await expect(executeIndependentBranches(repo, stale.lease)).rejects.toThrow('LEASE_LOST');
    expect(
      (await repo.artifacts(TEST_USERS.owner, stale.run.org_id, stale.run.run_id)).artifacts,
    ).toHaveLength(8);
  });
});
