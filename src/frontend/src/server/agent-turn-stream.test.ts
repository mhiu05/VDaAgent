import { describe, expect, it } from 'vitest';
import { AgentTurnStreamEventV1Schema, type AgentTurnAccepted } from '@vda/contracts';
import { agentTurnStream } from './agent-turn-stream';

const accepted: AgentTurnAccepted = {
  conversation_id: '30000000-0000-4000-8000-000000000001',
  user_message_id: '40000000-0000-4000-8000-000000000001',
  assistant_message_id: '50000000-0000-4000-8000-000000000001',
  run_id: null,
  assistant_status: 'completed',
};

async function frames(response: Response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((block) => block.split('\n'))
    .flatMap((lines) => {
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      return event && data
        ? [{ event, value: AgentTurnStreamEventV1Schema.parse(JSON.parse(data)) }]
        : [];
    });
}

describe('agent turn SSE stream', () => {
  it('emits ordered safe activity followed by the persisted terminal state', async () => {
    const response = agentTurnStream({
      execute: async (emit) => {
        emit({
          version: 'agent-activity-v1',
          sequence: 0,
          type: 'context_started',
          label: 'understanding_context',
          capability: null,
          run_id: null,
          artifact_id: null,
          error_code: null,
        });
        emit({
          version: 'agent-activity-v1',
          sequence: 1,
          type: 'answer_completed',
          label: 'answer_ready',
          capability: null,
          run_id: null,
          artifact_id: null,
          error_code: null,
        });
        return accepted;
      },
      requestSignal: new AbortController().signal,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect(await frames(response)).toEqual([
      expect.objectContaining({
        event: 'activity',
        value: expect.objectContaining({ type: 'activity', sequence: 0 }),
      }),
      expect.objectContaining({
        event: 'activity',
        value: expect.objectContaining({ type: 'activity', sequence: 1 }),
      }),
      expect.objectContaining({
        event: 'terminal',
        value: expect.objectContaining({ type: 'terminal', sequence: 2, accepted }),
      }),
    ]);
  });

  it('never puts a raw submission failure in the stream', async () => {
    const response = agentTurnStream({
      execute: async () => {
        throw new Error('provider prompt and secret');
      },
      requestSignal: new AbortController().signal,
    });

    const body = await response.text();
    expect(body).not.toContain('provider prompt');
    expect(body).toContain('PROVIDER_UNAVAILABLE');
  });

  it('preserves a normalized runtime error without exposing its message', async () => {
    const response = agentTurnStream({
      execute: async () => {
        const error = Object.assign(new Error('private authorization detail'), {
          code: 'NO_AUTHORIZED_RESULT',
        });
        throw error;
      },
      requestSignal: new AbortController().signal,
    });

    const terminal = (await frames(response)).find((item) => item.event === 'terminal');
    expect(terminal?.value).toMatchObject({
      type: 'terminal',
      accepted: null,
      error_code: 'NO_AUTHORIZED_RESULT',
    });
  });

  it('propagates a disconnected response cancellation to the runtime signal', async () => {
    let received: AbortSignal | undefined;
    const response = agentTurnStream({
      execute: async (_emit, signal) => {
        received = signal;
        return new Promise<AgentTurnAccepted>(() => undefined);
      },
      requestSignal: new AbortController().signal,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await Promise.resolve();
    await reader?.cancel();
    expect(received?.aborted).toBe(true);
  });
});
