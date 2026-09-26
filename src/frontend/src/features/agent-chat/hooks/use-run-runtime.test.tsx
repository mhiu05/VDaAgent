// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeActivityRecordSchema } from '@vda/contracts';
import { getRunRuntime } from '../api/runtime';
import { readSse } from '../../../lib/sse';
import { useRunRuntime } from './use-run-runtime';
import { newerExecutionSnapshot } from './use-agent-execution';
import { AgentTurnJobSnapshotSchema } from '../api/conversations';

vi.mock('../api/runtime', async (original) => ({ ...await original<typeof import('../api/runtime')>(), getRunRuntime: vi.fn() }));
vi.mock('../../../lib/sse', () => ({ readSse: vi.fn() }));
const org = '10000000-0000-4000-8000-000000000001';
const run = '10000000-0000-4000-8000-000000000002';
const record = RuntimeActivityRecordSchema.parse({ activity_id: '10000000-0000-4000-8000-000000000003', org_id: org, run_id: run, conversation_id: null, kind: 'invocation', step_key: 'data', agent_key: 'data', status: 'running', summary: 'Querying data', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z' });
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useRunRuntime>;
function Harness({ active = true, streaming = true, runId = run }: { active?: boolean; streaming?: boolean; runId?: string }) {
  current = useRunRuntime(org, runId, streaming, active);
  return null;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { headers: { 'content-type': 'text/event-stream' } })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('durable runtime subscription', () => {
  it('never replaces terminal SSE state with a delayed running poll response', () => {
    const completed = AgentTurnJobSnapshotSchema.parse({ job: {
      job_id: run, conversation_id: org, user_message_id: org, assistant_message_id: org,
      status: 'completed', run_id: run, error_code: null,
      created_at: record.created_at, updated_at: '2026-09-26T00:01:00Z',
    }, invocations: [], events: [] });
    const stale = { ...completed, job: { ...completed.job, status: 'running' as const, updated_at: '2026-09-26T00:00:30Z' } };
    expect(newerExecutionSnapshot(completed, stale)).toBe(completed);
    expect(newerExecutionSnapshot(stale, completed)).toBe(completed);
    expect(newerExecutionSnapshot(completed, { ...stale, job: { ...stale.job, job_id: record.activity_id } }).job.job_id).toBe(record.activity_id);
  });
  it('reconnects with the last persisted sequence and ignores replayed events', async () => {
    const next = { ...record, status: 'completed' as const, summary: 'Retrieved data' };
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [record], events: [], last_sequence: 1 });
    vi.mocked(readSse).mockImplementationOnce(async (_response, frame) => {
      const event = { event_id: '10000000-0000-4000-8000-000000000004', run_id: run, sequence: 2, type: 'invocation', record: next, created_at: next.created_at };
      frame({ event: 'runtime', id: '2', data: JSON.stringify(event) });
      frame({ event: 'runtime', id: '2', data: JSON.stringify({ ...event, record }) });
      throw new Error('Connection closed');
    }).mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<Harness />));
    expect(current.snapshot.records).toEqual([next]);
    expect(current.snapshot.events).toHaveLength(1);
    expect(current.connection).toBe('reconnecting');
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [next], events: [], last_sequence: 2 });
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain('after=2');
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ 'Last-Event-ID': '2' });
  });

  it('rehydrates finished runs after refresh without starting new execution', async () => {
    const saved = { records: [{ ...record, status: 'completed' as const }], events: [], last_sequence: 9 };
    vi.mocked(getRunRuntime).mockResolvedValue(saved);
    await act(async () => root.render(<Harness active={false} />));
    expect(current.snapshot).toEqual(saved);
    expect(current.connection).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
    expect(readSse).not.toHaveBeenCalled();
  });

  it('aborts subscriptions on thread/run changes', async () => {
    vi.mocked(getRunRuntime).mockResolvedValue({ records: [record], events: [], last_sequence: 1 });
    vi.mocked(readSse).mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<Harness />));
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(<Harness runId="10000000-0000-4000-8000-000000000099" />));
    expect(signal?.aborted).toBe(true);
  });
});
