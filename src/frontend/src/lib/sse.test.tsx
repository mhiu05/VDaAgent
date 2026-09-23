import { describe, expect, it, vi } from 'vitest';
import type { AgentTurnRequest } from '@vda/contracts';
import { readSse, sendTurnStream } from './sse';

const encoder = new TextEncoder();
const input: Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'> = {
  text: 'Inspect the authorized result.',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  workspace_context: {
    version: 1,
    mode: 'agent_chat',
    org_id: '10000000-0000-4000-8000-000000000001',
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
const activity =
  '{"version":"agent-turn-stream-v1","sequence":0,"type":"activity","activity":{"version":"agent-activity-v1","sequence":0,"type":"context_started","label":"understanding_context","capability":null,"run_id":null,"artifact_id":null,"error_code":null}}';
const terminal =
  '{"version":"agent-turn-stream-v1","sequence":1,"type":"terminal","accepted":{"conversation_id":"30000000-0000-4000-8000-000000000001","user_message_id":"40000000-0000-4000-8000-000000000001","assistant_message_id":"50000000-0000-4000-8000-000000000001","run_id":null,"assistant_status":"completed"},"error_code":null}';

function sseResponse(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  );
}

describe('fetch SSE client', () => {
  it('handles comments and fragmented CRLF frames', async () => {
    const frames: { event: string; data: string }[] = [];
    await readSse(
      sseResponse([
        ': connected\r\n\r\nevent: activity\r\nid: 0\r\ndata: ',
        activity,
        '\r\n\r\nevent: terminal\r\ndata: ',
        terminal,
        '\r\n\r\n',
      ]),
      (frame) => frames.push({ event: frame.event, data: frame.data }),
    );
    expect(frames).toEqual([
      { event: 'activity', data: activity },
      { event: 'terminal', data: terminal },
    ]);
  });

  it('parses ordered stream events and preserves the caller turn identity', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: activity\ndata: ',
        activity,
        '\n\nevent: terminal\ndata: ',
        terminal,
        '\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    await expect(
      sendTurnStream(
        '10000000-0000-4000-8000-000000000001',
        input,
        {
          client_turn_id: '20000000-0000-4000-8000-000000000001',
          idempotency_key: 'turn-stream',
        },
        (event) => seen.push(event.type),
      ),
    ).resolves.toMatchObject({ assistant_status: 'completed' });
    expect(seen).toEqual(['context_started']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'turn-stream' }),
      }),
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const request = calls[0]![1];
    expect(JSON.parse(request.body as string).workspace_context).toMatchObject({
      version: 1,
      mode: 'agent_chat',
    });
    vi.unstubAllGlobals();
  });

  it('rejects a stream with a non-monotonic event sequence', async () => {
    const duplicate =
      '{"version":"agent-turn-stream-v1","sequence":0,"type":"terminal","accepted":{"conversation_id":"30000000-0000-4000-8000-000000000001","user_message_id":"40000000-0000-4000-8000-000000000001","assistant_message_id":"50000000-0000-4000-8000-000000000001","run_id":null,"assistant_status":"completed"},"error_code":null}';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: activity\ndata: ',
          activity,
          '\n\nevent: terminal\ndata: ',
          duplicate,
          '\n\n',
        ]),
      ),
    );
    await expect(
      sendTurnStream(
        '10000000-0000-4000-8000-000000000001',
        input,
        {
          client_turn_id: '20000000-0000-4000-8000-000000000001',
          idempotency_key: 'turn-stream',
        },
        () => undefined,
      ),
    ).rejects.toThrow('invalid');
    vi.unstubAllGlobals();
  });
});
