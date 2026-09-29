// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutionEventSchema, RunSchema, RuntimeActivityRecordSchema } from '@vda/contracts';
import { getRunRuntime } from '../../src/frontend/features/agent-chat/api/runtime';
import { newerExecutionSnapshot } from '../../src/frontend/features/agent-chat/hooks/use-agent-execution';
import { useRunRuntime } from '../../src/frontend/features/agent-chat/hooks/use-run-runtime';
import { AgentTurnJobSnapshotSchema } from '../../src/frontend/features/agent-chat/api/conversations';
import { readSse } from '../../src/frontend/lib/sse';

vi.mock('../../src/frontend/features/agent-chat/api/runtime', async (original) => ({
  ...(await original<typeof import('../../src/frontend/features/agent-chat/api/runtime')>()),
  getRunRuntime: vi.fn(),
}));
vi.mock('../../src/frontend/lib/sse', () => ({ readSse: vi.fn() }));

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '10000000-0000-4000-8000-000000000002';
const record = RuntimeActivityRecordSchema.parse({
  activity_id: '10000000-0000-4000-8000-000000000003',
  org_id: orgId,
  run_id: runId,
  conversation_id: null,
  kind: 'invocation',
  step_key: 'data',
  agent_key: 'data',
  status: 'running',
  summary: 'Querying data',
  created_at: '2026-09-26T00:00:00Z',
  updated_at: '2026-09-26T00:00:00Z',
});
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useRunRuntime>;
function Harness({
  active = true,
  run = runId,
  onUpdate,
}: {
  active?: boolean;
  run?: string;
  onUpdate?: Parameters<typeof useRunRuntime>[4];
}) {
  const state = useRunRuntime(orgId, run, true, active, onUpdate);
  useEffect(() => {
    current = state;
  }, [state]);
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('durable run subscription', () => {
  it('keeps newer terminal job metadata even with an empty event page', () => {
    const job = {
      job_id: runId,
      conversation_id: orgId,
      user_message_id: orgId,
      assistant_message_id: orgId,
      status: 'running',
      run_id: runId,
      error_code: null,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
    const event = AgentExecutionEventSchema.parse({
      event_id: orgId,
      org_id: orgId,
      job_id: runId,
      invocation_id: null,
      sequence: 120,
      type: 'turn_claimed',
      data: {},
      created_at: record.created_at,
    });
    const running = AgentTurnJobSnapshotSchema.parse({ job, invocations: [], events: [event] });
    const failed = AgentTurnJobSnapshotSchema.parse({
      job: { ...job, status: 'failed', updated_at: '2026-09-26T00:01:00Z' },
      invocations: [],
      events: [],
    });
    const merged = newerExecutionSnapshot(running, failed);
    expect(merged.job.status).toBe('failed');
    expect(merged.events).toEqual([event]);
  });

  it('consumes persisted SSE status and stops polling at terminal completion', async () => {
    const terminalRun = RunSchema.parse({
      run_id: runId,
      org_id: orgId,
      created_by: orgId,
      status: 'failed',
      request: {
        org_id: orgId,
        scope: { project_external_id: 'P', zone_external_id: null },
        data_as_of: '2026-09-19',
        question: 'Analyze',
        conversation_id: null,
      },
      created_at: record.created_at,
      updated_at: record.updated_at,
      idempotency_key: 'terminal',
      request_hash: 'terminal',
      entrypoint: 'interactive',
      occurrence_id: null,
      attempt: 1,
      fencing_token: 1,
      lease_until: null,
      error_code: 'AGENT_WORKFLOW_FAILED',
      report_artifact_id: null,
      cancel_requested: false,
      workflow_version: 'agent-v1',
    });
    const snapshot = { records: [{ ...record, status: 'failed' }], events: [], last_sequence: 2 };
    vi.mocked(getRunRuntime)
      .mockResolvedValueOnce({ records: [record], events: [], last_sequence: 1 })
      .mockRejectedValue(new Error('Unexpected terminal poll'));
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: snapshot\ndata: ${JSON.stringify({ run: terminalRun, runtime: snapshot })}\n\n` +
          'event: terminal\ndata: {"status":"failed"}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const actual = await vi.importActual<typeof import('../../src/frontend/lib/sse')>(
      '../../src/frontend/lib/sse',
    );
    vi.mocked(readSse).mockImplementation(actual.readSse);
    const update = vi.fn();
    await act(async () => root.render(<Harness onUpdate={update} />));
    expect(update).toHaveBeenCalledWith(terminalRun);
    expect(current.snapshot.records[0].status).toBe('failed');
    expect(current.connection).toBe('idle');
    expect(current.error).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledOnce();
    expect(getRunRuntime).toHaveBeenCalledOnce();
  });

  it('does not replace terminal state with a delayed running poll', () => {
    const completed = AgentTurnJobSnapshotSchema.parse({
      job: {
        job_id: runId,
        conversation_id: orgId,
        user_message_id: orgId,
        assistant_message_id: orgId,
        status: 'completed',
        run_id: runId,
        error_code: null,
        created_at: record.created_at,
        updated_at: '2026-09-26T00:01:00Z',
      },
      invocations: [],
      events: [],
    });
    const stale = {
      ...completed,
      job: { ...completed.job, status: 'running' as const, updated_at: '2026-09-26T00:00:30Z' },
    };
    expect(newerExecutionSnapshot(completed, stale)).toBe(completed);
    expect(newerExecutionSnapshot(stale, completed)).toEqual(completed);
    expect(
      newerExecutionSnapshot(completed, {
        ...stale,
        job: { ...stale.job, job_id: record.activity_id },
      }).job.job_id,
    ).toBe(record.activity_id);
  });

  it('reconnects from the last sequence and ignores a duplicate frame', async () => {
    const next = { ...record, status: 'completed' as const, summary: 'Retrieved data' };
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [record], events: [], last_sequence: 1 });
    vi.mocked(readSse)
      .mockImplementationOnce(async (_response, frame) => {
        const event = {
          event_id: '10000000-0000-4000-8000-000000000004',
          run_id: runId,
          sequence: 2,
          type: 'invocation',
          record: next,
          created_at: next.created_at,
        };
        frame({ event: 'runtime', id: '2', data: JSON.stringify(event) });
        frame({ event: 'runtime', id: '2', data: JSON.stringify({ ...event, record }) });
        throw new Error('Connection closed');
      })
      .mockImplementation(() => new Promise(() => undefined));
    await act(async () => root.render(<Harness />));
    expect(current.snapshot.records).toEqual([next]);
    expect(current.snapshot.events).toHaveLength(1);
    expect(current.connection).toBe('reconnecting');
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [next], events: [], last_sequence: 2 });
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain('after=2');
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ 'Last-Event-ID': '2' });
  });

  it('rehydrates a finished run without starting execution', async () => {
    const saved = {
      records: [{ ...record, status: 'completed' as const }],
      events: [],
      last_sequence: 9,
    };
    vi.mocked(getRunRuntime).mockResolvedValue(saved);
    await act(async () => root.render(<Harness active={false} />));
    expect(current.snapshot).toEqual(saved);
    expect(current.connection).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
    expect(readSse).not.toHaveBeenCalled();
  });

  it('aborts an old subscription when the selected run changes', async () => {
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [record], events: [], last_sequence: 1 });
    vi.mocked(readSse).mockImplementation(() => new Promise(() => undefined));
    await act(async () => root.render(<Harness />));
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(<Harness run="10000000-0000-4000-8000-000000000099" />));
    expect(signal?.aborted).toBe(true);
  });
});
