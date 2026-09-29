import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import { runLoop } from '../../src/backend/worker/run-loop';
import { watchShutdownSignals } from '../../src/backend/worker/lifecycle';
import { runSchedulerOnce, tickWhenDue } from '../../src/backend/worker/scheduler';
import { dispatchWorkflow } from '../../src/backend/worker/workflow-dispatcher';

const lease = { run: { run_id: 'run-1', attempt: 2, workflow_version: 'agent-v1' } } as Parameters<
  typeof dispatchWorkflow
>[1];

describe('worker scheduling fairness', () => {
  it('claims an accepted turn without a browser connection', async () => {
    const jobLease = { job: { job_id: 'job-1' }, worker_id: 'worker-1', fencing_token: 1 };
    const repo = {
      tick: vi.fn().mockResolvedValue([]),
      claimAgentTurnJob: vi.fn().mockResolvedValue(jobLease),
      claimRun: vi.fn(),
    } as unknown as Repository;
    const dispatchAgent = vi.fn().mockResolvedValue(undefined);
    await runLoop(repo, 'worker-1', () => false, true, {
      durableAgentExecution: true,
      now: () => 100,
      dispatchAgent,
    });
    expect(repo.claimAgentTurnJob).toHaveBeenCalledWith('worker-1');
    expect(dispatchAgent).toHaveBeenCalledWith(repo, jobLease);
    expect(repo.claimRun).not.toHaveBeenCalled();
  });

  it('allows a queued analysis run to progress while turns keep arriving', async () => {
    const jobLease = { job: { job_id: 'job-1' }, worker_id: 'worker-1', fencing_token: 1 };
    const runLease = {
      run: { run_id: 'run-1', workflow_version: 'agent-v1' },
      worker_id: 'worker-1',
      fencing_token: 1,
    };
    const repo = {
      tick: vi.fn().mockResolvedValue([]),
      claimAgentTurnJob: vi.fn().mockResolvedValue(jobLease),
      claimRun: vi.fn().mockResolvedValue(runLease),
    } as unknown as Repository;
    const dispatchAgent = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    let iterations = 0;
    await runLoop(repo, 'worker-1', () => ++iterations >= 2, false, {
      durableAgentExecution: true,
      now: () => 100,
      dispatchAgent,
      dispatch,
    });
    expect(dispatchAgent).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(repo, runLease);
  });

  it('claims a run once and dispatches its pinned lease without idle sleep', async () => {
    const repo = {
      tick: vi.fn().mockResolvedValue([]),
      claimRun: vi.fn().mockResolvedValue(lease),
    } as unknown as Repository;
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runLoop(repo, 'worker-1', () => false, true, { now: () => 100, dispatch, sleep });
    expect(repo.tick).toHaveBeenCalledOnce();
    expect(repo.claimRun).toHaveBeenCalledWith('worker-1');
    expect(dispatch).toHaveBeenCalledWith(repo, lease);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honors shutdown after the current iteration', async () => {
    const signals = new EventEmitter();
    const shouldStop = watchShutdownSignals(signals as unknown as Pick<NodeJS.Process, 'on'>);
    const repo = {
      tick: vi.fn().mockResolvedValue([]),
      claimRun: vi.fn().mockImplementation(async () => {
        signals.emit('SIGTERM');
        return null;
      }),
    } as unknown as Repository;
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runLoop(repo, 'worker-1', shouldStop, false, { now: () => 100, sleep });
    expect(repo.claimRun).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('ticks on schedule and keeps the one-shot log bounded', async () => {
    const repo = {
      tick: vi.fn().mockResolvedValue([{ run_id: 'run-1' }]),
    } as unknown as Repository;
    expect(await tickWhenDue(repo, 200, () => 199)).toBe(200);
    expect(repo.tick).not.toHaveBeenCalled();
    expect(await tickWhenDue(repo, 200, () => 200)).toBe(60200);
    const log = vi.fn();
    await runSchedulerOnce(repo, '2026-09-24T00:00:00.000Z', log);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
      event: 'scheduler_tick',
      occurrences: 1,
      run_ids: ['run-1'],
    });
  });

  it('renews a fenced run and dispatches only its pinned workflow', async () => {
    const repo = {
      renewLease: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn(),
    } as unknown as Repository;
    const agentWorkflow = vi.fn().mockResolvedValue(undefined);
    let heartbeat: (() => void) | undefined;
    const stopHeartbeat = vi.fn();
    await dispatchWorkflow(repo, lease, {
      agentWorkflow,
      startHeartbeat: vi.fn((callback: () => void) => {
        heartbeat = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      stopHeartbeat,
      log: vi.fn(),
    });
    heartbeat?.();
    expect(agentWorkflow).toHaveBeenCalledWith(repo, lease, { signal: expect.any(AbortSignal) });
    expect(repo.renewLease).toHaveBeenCalledWith(lease);
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });

  it('never dispatches a historical workflow version', async () => {
    const repo = { failRun: vi.fn().mockResolvedValue(undefined) } as unknown as Repository;
    const agentWorkflow = vi.fn().mockResolvedValue(undefined);
    const error = vi.fn();
    await dispatchWorkflow(
      repo,
      { ...lease, run: { ...lease.run, workflow_version: 'legacy-v1' } },
      {
        agentWorkflow,
        startHeartbeat: vi.fn(
          () => 1 as unknown as ReturnType<typeof setInterval>,
        ) as unknown as typeof setInterval,
        stopHeartbeat: vi.fn(),
        log: vi.fn(),
        error,
      },
    );
    expect(agentWorkflow).not.toHaveBeenCalled();
    expect(repo.failRun).toHaveBeenCalledWith(expect.anything(), 'EXECUTION_FAILED');
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      event: 'run_failed',
      code: 'UNKNOWN_WORKFLOW_VERSION',
    });
  });

  it('aborts the workflow and logs only safe metadata after losing the lease', async () => {
    const repo = {
      renewLease: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('private query'), { code: '08006' })),
      failRun: vi.fn().mockRejectedValue(new Error('LEASE_LOST')),
    } as unknown as Repository;
    const error = vi.fn();
    let heartbeat: (() => void) | undefined;
    const pending = dispatchWorkflow(repo, lease, {
      agentWorkflow: async (_repo, _lease, options) => {
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
      startHeartbeat: vi.fn((callback: () => void) => {
        heartbeat = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      stopHeartbeat: vi.fn(),
      log: vi.fn(),
      error,
    });
    heartbeat?.();
    await pending;
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      event: 'run_lease_renewal_failed',
      database_code: '08006',
    });
    expect(error.mock.calls.map((call) => call[0]).join(' ')).not.toContain('private query');
    expect(repo.failRun).toHaveBeenCalledWith(lease, 'EXECUTION_FAILED');
  });

  it('records workflow failure and clears the heartbeat', async () => {
    const repo = { failRun: vi.fn().mockResolvedValue(undefined) } as unknown as Repository;
    const stopHeartbeat = vi.fn();
    const error = vi.fn();
    await dispatchWorkflow(repo, lease, {
      agentWorkflow: vi.fn().mockRejectedValue(new Error('VALIDATION_FAILED')),
      startHeartbeat: vi.fn(
        () => 1 as unknown as ReturnType<typeof setInterval>,
      ) as unknown as typeof setInterval,
      stopHeartbeat,
      log: vi.fn(),
      error,
    });
    expect(repo.failRun).toHaveBeenCalledWith(lease, 'EXECUTION_FAILED');
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      event: 'run_failed',
      code: 'VALIDATION_FAILED',
    });
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });
});
