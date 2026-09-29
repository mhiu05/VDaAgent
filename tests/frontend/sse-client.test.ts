import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTurnRequest } from '@vda/contracts';
import { readSse, sendTurnStream } from '../../src/frontend/lib/sse';

const orgId = '10000000-0000-4000-8000-000000000001';
const turnId = '20000000-0000-4000-8000-000000000001';
const conversationId = '30000000-0000-4000-8000-000000000001';
const input: Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'> = {
  text: 'Inspect the authorized result.',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  workspace_context: {
    version: 1,
    mode: 'agent_chat',
    org_id: orgId,
    conversation_id: null,
    scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
    data_as_of: '2026-09-19',
    active_run_ref: null,
    active_report_ref: null,
    active_artifact_ref: null,
    dashboard_selection: null,
    drilldown: null,
    evidence_ref: null,
  },
};
const activity = {
  version: 'agent-turn-stream-v1',
  sequence: 0,
  type: 'activity',
  activity: {
    version: 'agent-activity-v1',
    sequence: 0,
    type: 'context_started',
    label: 'understanding_context',
    capability: null,
    run_id: null,
    artifact_id: null,
    error_code: null,
  },
};
const terminal = {
  version: 'agent-turn-stream-v1',
  sequence: 1,
  type: 'terminal',
  accepted: {
    conversation_id: conversationId,
    user_message_id: '40000000-0000-4000-8000-000000000001',
    assistant_message_id: '50000000-0000-4000-8000-000000000001',
    run_id: null,
    assistant_status: 'completed',
  },
  error_code: null,
};
const identity = { client_turn_id: turnId, idempotency_key: 'turn-stream' };

function response(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('browser SSE delivery', () => {
  it('cancels the response body when a frame handler rejects persisted data', async () => {
    const cancel = vi.fn();
    const stream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: runtime\ndata: invalid\n\n'));
        },
        cancel,
      }),
    );
    const failure = new Error('Invalid persisted event');
    await expect(
      readSse(stream, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(failure);
    expect(stream.body?.locked).toBe(false);
  });

  it('accepts a large bounded snapshot but rejects it at the default chat frame limit', async () => {
    const payload = JSON.stringify({ records: [{ summary: 'x'.repeat(70_000) }] });
    const frame = `event: snapshot\ndata: ${payload}\n\n`;
    const seen = vi.fn();
    await readSse(response([frame]), seen, 2_000_000);
    expect(seen).toHaveBeenCalledWith({ event: 'snapshot', id: null, data: payload });
    await expect(readSse(response([frame]), vi.fn())).rejects.toThrow();
  });

  it('handles comments and fragmented CRLF frames', async () => {
    const frames: Array<{ event: string; id: string | null; data: string }> = [];
    await readSse(
      response([
        ': connected\r\n\r\nevent: activity\r\nid: 0\r\ndata: ',
        JSON.stringify(activity),
        '\r\n\r\nevent: terminal\r\ndata: ',
        JSON.stringify(terminal),
        '\r\n\r\n',
      ]),
      (frame) => frames.push(frame),
    );
    expect(frames).toEqual([
      { event: 'activity', id: '0', data: JSON.stringify(activity) },
      { event: 'terminal', id: null, data: JSON.stringify(terminal) },
    ]);
  });

  it('preserves turn identity and ordered activity on the stream request', async () => {
    const fetchMock = vi.fn(async () =>
      response([
        `event: activity\ndata: ${JSON.stringify(activity)}\n\n`,
        `event: terminal\ndata: ${JSON.stringify(terminal)}\n\n`,
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    await expect(
      sendTurnStream(orgId, input, identity, (event) => seen.push(event.type)),
    ).resolves.toMatchObject({ conversation_id: conversationId, assistant_status: 'completed' });
    expect(seen).toEqual(['context_started']);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/conversations/stream?org_id=${orgId}`);
    expect(options.headers).toMatchObject({ 'Idempotency-Key': identity.idempotency_key });
    expect(JSON.parse(options.body as string)).toMatchObject({
      client_turn_id: turnId,
      workspace_context: { org_id: orgId, mode: 'agent_chat' },
    });
  });

  it('rejects a duplicate sequence before accepting a terminal frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([
          `event: activity\ndata: ${JSON.stringify(activity)}\n\n`,
          `event: terminal\ndata: ${JSON.stringify({ ...terminal, sequence: 0 })}\n\n`,
        ]),
      ),
    );
    await expect(sendTurnStream(orgId, input, identity, vi.fn())).rejects.toThrow();
  });
});
