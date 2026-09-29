import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import { errorDiagnostics } from '../../../src/backend/worker/error-diagnostics';
import { dispatchAgentTurn } from '../../../src/backend/worker/agent-turn-dispatcher';

describe('worker diagnostic redaction', () => {
  it('keeps only allowlisted provider codes and timing', () => {
    const first = Object.assign(new Error('PROVIDER_HTTP_401'), {
      failure_reason: 'http_error',
      duration_ms: 120,
      body: 'PRIVATE_SENTINEL',
    });
    const second = Object.assign(new Error('PRIVATE_SENTINEL'), { body: 'PRIVATE_SENTINEL' });
    const diagnostics = errorDiagnostics(
      new AggregateError([first, second], 'ALL_LLM_PROVIDERS_FAILED'),
    );
    expect(diagnostics).toEqual({
      cause_type: 'Error',
      provider_failure_codes: ['PROVIDER_HTTP_401'],
      provider_failure_reasons: ['http_error'],
      provider_failure_durations_ms: [120],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_SENTINEL');
  });

  it('finds a safe SQLSTATE through wrapped causes without exposing SQL', () => {
    const cause = Object.assign(new Error('private query'), {
      code: '42P01',
      constraint_name: 'agent_memory_artifact_refs_check',
      query: 'private SQL',
      parameters: ['secret'],
    });
    const diagnostics = errorDiagnostics(new Error('TOOL_EXECUTION_FAILED', { cause }));
    expect(diagnostics).toEqual({
      cause_type: 'Error',
      database_code: '42P01',
      database_constraint: 'agent_memory_artifact_refs_check',
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|secret/);
  });

  it('bounds cycles and rejects unsafe constraint text', () => {
    const cause = { code: '23514', constraint: 'private prompt', cause: null as unknown };
    cause.cause = cause;
    expect(errorDiagnostics(cause)).toEqual({ cause_type: 'NonError', database_code: '23514' });
  });

  it('keeps ordered, allowlisted provider failure reasons and drops unsafe timing', () => {
    const first = Object.assign(new Error('GEMINI_RESPONSE_INVALID'), {
      failure_reason: 'empty_output',
      duration_ms: 24_000,
      prompt: 'PRIVATE_SENTINEL',
    });
    const second = Object.assign(new Error('PROVIDER_HTTP_401'), {
      failure_reason: 'http_error',
      duration_ms: 30_000,
      body: 'PRIVATE_SENTINEL',
    });
    const error = () => new AggregateError([first, second], 'ALL_LLM_PROVIDERS_FAILED');
    expect(errorDiagnostics(error())).toEqual({
      cause_type: 'Error',
      provider_failure_codes: ['GEMINI_RESPONSE_INVALID', 'PROVIDER_HTTP_401'],
      provider_failure_reasons: ['empty_output', 'http_error'],
      provider_failure_durations_ms: [24_000, 30_000],
    });
    second.failure_reason = 'PRIVATE_SENTINEL';
    second.duration_ms = Infinity;
    const safe = errorDiagnostics(error());
    expect(safe).toMatchObject({ provider_failure_reasons: ['empty_output', 'unknown'] });
    expect(safe).not.toHaveProperty('provider_failure_durations_ms');
    expect(JSON.stringify(safe)).not.toContain('PRIVATE_SENTINEL');
  });

  it('turns a private database failure into a public job code with safe logs', async () => {
    const databaseError = Object.assign(new Error('sensitive prompt'), {
      code: '23514',
      constraint_name: 'agent_memory_artifact_refs_check',
    });
    const repo = {
      resumeAgentAnalysis: vi.fn().mockRejectedValue(databaseError),
      failAgentTurnJob: vi.fn(),
    } as unknown as Repository;
    const lease = { job: { job_id: 'job', run_id: 'run' } } as Parameters<
      typeof dispatchAgentTurn
    >[1];
    const error = vi.fn();
    await dispatchAgentTurn(repo, lease, { log: vi.fn(), error });
    expect(repo.failAgentTurnJob).toHaveBeenCalledWith(lease, 'AGENT_EXECUTION_FAILED');
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      database_code: '23514',
      database_constraint: 'agent_memory_artifact_refs_check',
    });
    expect(error.mock.calls[0]![0]).not.toContain('sensitive prompt');
  });

  it('does not log completion after losing the job lease', async () => {
    let complete!: () => void;
    const repo = {
      renewAgentTurnLease: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('private query'), { code: '08006' })),
      resumeAgentAnalysis: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      ),
      failAgentTurnJob: vi.fn().mockRejectedValue(new Error('LEASE_LOST')),
    } as unknown as Repository;
    const lease = { job: { job_id: 'job', run_id: 'run' } } as Parameters<
      typeof dispatchAgentTurn
    >[1];
    let heartbeat: (() => void) | undefined;
    const log = vi.fn();
    const error = vi.fn();
    const pending = dispatchAgentTurn(repo, lease, {
      log,
      error,
      startHeartbeat: vi.fn((callback: () => void) => {
        heartbeat = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      stopHeartbeat: vi.fn(),
    });
    heartbeat?.();
    await Promise.resolve();
    complete();
    await pending;
    expect(log).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      event: 'agent_turn_lease_renewal_failed',
      database_code: '08006',
    });
    expect(error.mock.calls.map((call) => call[0]).join(' ')).not.toContain('private query');
    expect(repo.failAgentTurnJob).toHaveBeenCalledWith(lease, 'AGENT_EXECUTION_FAILED');
  });
});
