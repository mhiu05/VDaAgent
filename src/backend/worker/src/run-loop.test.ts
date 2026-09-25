import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import { watchShutdownSignals } from './lifecycle';
import { runLoop } from './run-loop';
import { runSchedulerOnce, tickWhenDue } from './scheduler';
import { dispatchWorkflow } from './workflow-dispatcher';

const lease = {
  run: { run_id: 'run-1', attempt: 2, workflow_version: 'agent-v1' },
} as Parameters<typeof dispatchWorkflow>[1];

describe('worker process boundaries', () => {
  it('claims the durable turn independently when the flag is enabled', async () => {
    const jobLease = {job:{job_id:'job-1'},worker_id:'worker-1',fencing_token:1};
    const repository = {
      tick: vi.fn().mockResolvedValue([]),
      claimAgentTurnJob: vi.fn().mockResolvedValue(jobLease),
      claimRun: vi.fn(),
    } as unknown as Repository;
    const dispatchAgent = vi.fn().mockResolvedValue(undefined);
    await runLoop(repository,'worker-1',() => false,true,{durableAgentExecution:true,now:() => 100,dispatchAgent});
    expect(repository.claimAgentTurnJob).toHaveBeenCalledWith('worker-1');
    expect(dispatchAgent).toHaveBeenCalledWith(repository,jobLease);
    expect(repository.claimRun).not.toHaveBeenCalled();
  });
  it('gives the newly created AnalysisRun a turn even while agent jobs remain queued', async () => {
    const jobLease = {job:{job_id:'job-1'},worker_id:'worker-1',fencing_token:1};
    const repository = {
      tick: vi.fn().mockResolvedValue([]),
      claimAgentTurnJob: vi.fn().mockResolvedValue(jobLease),
      claimRun: vi.fn().mockResolvedValue(lease),
    } as unknown as Repository;
    const dispatchAgent = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    let iterations = 0;
    await runLoop(repository,'worker-1',() => ++iterations >= 2,false,{
      durableAgentExecution:true,now:() => 100,dispatchAgent,dispatch,
    });
    expect(dispatchAgent).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(repository,lease);
  });
  it('ticks once, claims once, and dispatches the pinned workflow', async () => {
    const repository = {
      tick: vi.fn().mockResolvedValue([]),
      claimRun: vi.fn().mockResolvedValue(lease),
    } as unknown as Repository;
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runLoop(repository, 'worker-1', () => false, true, {
      now: () => 100,
      sleep,
      dispatch,
    });

    expect(repository.tick).toHaveBeenCalledOnce();
    expect(repository.claimRun).toHaveBeenCalledWith('worker-1');
    expect(dispatch).toHaveBeenCalledWith(repository, lease);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honors shutdown after the current iteration', async () => {
    const signals = new EventEmitter();
    const shouldStop = watchShutdownSignals(signals as unknown as Pick<NodeJS.Process, 'on'>);
    const repository = {
      tick: vi.fn().mockResolvedValue([]),
      claimRun: vi.fn().mockImplementation(async () => {
        signals.emit('SIGTERM');
        return null;
      }),
    } as unknown as Repository;
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runLoop(repository, 'worker-1', shouldStop, false, { now: () => 100, sleep });

    expect(shouldStop()).toBe(true);
    expect(repository.claimRun).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('keeps the scheduler cadence and one-shot log contract', async () => {
    const repository = {
      tick: vi.fn().mockResolvedValue([{ run_id: 'run-1' }]),
    } as unknown as Repository;
    const log = vi.fn();

    await expect(tickWhenDue(repository, 200, () => 199)).resolves.toBe(200);
    expect(repository.tick).not.toHaveBeenCalled();
    await expect(tickWhenDue(repository, 200, () => 200)).resolves.toBe(60200);
    await runSchedulerOnce(repository, '2026-09-24T00:00:00.000Z', log);

    expect(repository.tick).toHaveBeenCalledWith(new Date('2026-09-24T00:00:00.000Z'));
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
      event: 'scheduler_tick',
      occurrences: 1,
      run_ids: ['run-1'],
    });
  });

  it('renews the lease and dispatches according to the run workflow version', async () => {
    const repository = {
      renewLease: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as Repository;
    const agentWorkflow = vi.fn().mockResolvedValue(undefined);
    const legacyWorkflow = vi.fn().mockResolvedValue(undefined);
    const stopHeartbeat = vi.fn();
    let heartbeat: (() => void) | undefined;
    const startHeartbeat = vi.fn((callback: () => void) => {
      heartbeat = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    await dispatchWorkflow(repository, lease, {
      agentWorkflow,
      legacyWorkflow,
      startHeartbeat,
      stopHeartbeat,
      log: vi.fn(),
    });
    heartbeat?.();
    expect(agentWorkflow).toHaveBeenCalledWith(repository, lease);
    expect(legacyWorkflow).not.toHaveBeenCalled();
    expect(startHeartbeat).toHaveBeenCalledWith(expect.any(Function), 10000);
    expect(repository.renewLease).toHaveBeenCalledWith(lease);
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });

  it('records a failed run and clears its heartbeat', async () => {
    const repository = { failRun: vi.fn().mockResolvedValue(undefined) } as unknown as Repository;
    const error = vi.fn();
    const stopHeartbeat = vi.fn();

    await dispatchWorkflow(repository, lease, {
      agentWorkflow: vi.fn().mockRejectedValue(new Error('VALIDATION_FAILED')),
      startHeartbeat: vi.fn(
        () => 1 as unknown as ReturnType<typeof setInterval>,
      ) as unknown as typeof setInterval,
      stopHeartbeat,
      log: vi.fn(),
      error,
    });

    expect(repository.failRun).toHaveBeenCalledWith(lease, 'EXECUTION_FAILED');
    expect(JSON.parse(error.mock.calls[0]![0])).toEqual({
      event: 'run_failed',
      run_id: 'run-1',
      code: 'VALIDATION_FAILED',
    });
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });
});
