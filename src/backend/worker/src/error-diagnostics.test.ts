import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import { errorDiagnostics } from './error-diagnostics';
import { dispatchAgentTurn } from './agent-turn-dispatcher';

describe('safe worker diagnostics', () => {
  it('retains safe diagnostics for rejected provider credentials through a tool failure', () => {
    const failures = [120, 400].map(duration_ms => Object.assign(new Error('PROVIDER_HTTP_401'), {
      duration_ms, failure_reason: 'http_error', body: 'PRIVATE_CREDENTIAL_SENTINEL',
    }));
    const error = new Error('LLM_AUTHENTICATION_FAILED', {
      cause: new AggregateError(failures, 'LLM_AUTHENTICATION_FAILED'),
    });
    expect(errorDiagnostics(error)).toEqual({ cause_type: 'Error',
      provider_failure_codes: ['PROVIDER_HTTP_401', 'PROVIDER_HTTP_401'],
      provider_failure_reasons: ['http_error', 'http_error'], provider_failure_durations_ms: [120, 400],
    });
  });

  it('finds SQLSTATE and postgres.js constraint names through wrapped causes', () => {
    const cause = Object.assign(new Error('private prompt'), { name: 'PostgresError', code: '42P01',
      constraint_name: 'agent_memory_artifact_refs_check', detail: 'credentials', query: 'private SQL', parameters: ['secret'] });
    const wrapped = new Error('TOOL_EXECUTION_FAILED', { cause: new Error('inner', { cause }) });
    expect(errorDiagnostics(wrapped)).toEqual({ cause_type: 'Error', database_code: '42P01', database_constraint: 'agent_memory_artifact_refs_check' });
    expect(JSON.stringify(errorDiagnostics(wrapped))).not.toMatch(/prompt|credentials|private SQL|secret/);
  });
  it('bounds cycles and rejects unsafe constraint text', () => {
    const cause = { code: '23514', constraint: 'private prompt with spaces', cause: null as unknown };
    cause.cause = cause;
    expect(errorDiagnostics(cause)).toEqual({ cause_type: 'NonError', database_code: '23514' });
    delete (cause as { code?: string }).code;
    expect(errorDiagnostics(cause)).toEqual({ cause_type: 'NonError' });
  });
  it('logs only allowlisted per-provider codes from an Insight aggregate failure', () => {
    const error = new AggregateError([
      new Error('GEMINI_RESPONSE_INVALID'),
      new Error('PROVIDER_HTTP_429'),
      new Error('PRIVATE_PROMPT_SECRET'),
    ], 'ALL_LLM_PROVIDERS_FAILED');
    const wrapped = new Error('TOOL_EXECUTION_FAILED', { cause: error });
    expect(errorDiagnostics(wrapped)).toEqual({
      cause_type: 'Error', provider_failure_codes: ['GEMINI_RESPONSE_INVALID', 'PROVIDER_HTTP_429'],
    });
    expect(JSON.stringify(errorDiagnostics(wrapped))).not.toContain('PRIVATE_PROMPT_SECRET');
  });
  it('records a lost job lease without logging phase completion', async () => {
    const databaseError = Object.assign(new Error('private query'), { code: '08006' });
    let complete!: () => void;
    const repo = {
      renewAgentTurnLease: vi.fn().mockRejectedValue(databaseError),
      resumeAgentAnalysis: vi.fn(() => new Promise<void>(resolve => { complete = resolve; })),
      failAgentTurnJob: vi.fn().mockRejectedValue(new Error('LEASE_LOST')),
    } as unknown as Repository;
    const lease = { job: { job_id: 'test-job', run_id: 'test-run' } } as Parameters<typeof dispatchAgentTurn>[1];
    let heartbeat: (() => void) | undefined;
    const log = vi.fn();
    const error = vi.fn();
    const pending = dispatchAgentTurn(repo, lease, {
      log, error,
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
    expect(JSON.parse(error.mock.calls[0]![0])).toEqual({
      event: 'agent_turn_lease_renewal_failed', job_id: 'test-job',
      cause_type: 'Error', database_code: '08006',
    });
    expect(JSON.parse(error.mock.calls[1]![0])).toMatchObject({event:'agent_turn_phase_failed'});
    expect(error.mock.calls.map(call => call[0]).join(' ')).not.toContain('private query');
    expect(repo.failAgentTurnJob).toHaveBeenCalledWith(lease, 'AGENT_EXECUTION_FAILED');
  });

  it('copies only safe provider reasons and finite elapsed times, preserving attempt order', () => {
    const first = Object.assign(new Error('GEMINI_RESPONSE_INVALID'), { failure_reason: 'empty_output', duration_ms: 24_000, prompt: 'PRIVATE_SENTINEL' });
    const second = Object.assign(new Error('PROVIDER_HTTP_401'), { failure_reason: 'http_error', duration_ms: 30_000, body: 'PRIVATE_SENTINEL' });
    expect(errorDiagnostics(new AggregateError([first, second], 'ALL_LLM_PROVIDERS_FAILED'))).toEqual({
      cause_type: 'Error', provider_failure_codes: ['GEMINI_RESPONSE_INVALID', 'PROVIDER_HTTP_401'],
      provider_failure_reasons: ['empty_output', 'http_error'], provider_failure_durations_ms: [24_000, 30_000],
    });
    second.failure_reason = 'PRIVATE_SENTINEL';
    second.duration_ms = Infinity;
    expect(errorDiagnostics(new AggregateError([first, second], 'ALL_LLM_PROVIDERS_FAILED'))).toEqual({
      cause_type: 'Error', provider_failure_codes: ['GEMINI_RESPONSE_INVALID', 'PROVIDER_HTTP_401'],
      provider_failure_reasons: ['empty_output', 'unknown'],
    });
  });

  it('keeps database details out of the public job error', async () => {
    const databaseError = Object.assign(new Error('sensitive prompt'), { code: '23514', constraint_name: 'agent_memory_artifact_refs_check' });
    const repo = { resumeAgentAnalysis: vi.fn().mockRejectedValue(databaseError), failAgentTurnJob: vi.fn() } as unknown as Repository;
    const lease = { job: { job_id: 'test-job', run_id: 'test-run' } } as Parameters<typeof dispatchAgentTurn>[1];
    const error = vi.fn();
    await dispatchAgentTurn(repo, lease, { log: vi.fn(), error });
    expect(repo.failAgentTurnJob).toHaveBeenCalledWith(lease, 'AGENT_EXECUTION_FAILED');
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ database_code: '23514', database_constraint: 'agent_memory_artifact_refs_check' });
    expect(error.mock.calls[0][0]).not.toContain('sensitive');
  });
});
