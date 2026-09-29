import { describe, expect, it } from 'vitest';
import { AgentTurnStreamEventV1Schema, type AgentTurnAccepted } from '@vda/contracts';
import { agentTurnStream } from '../../src/frontend/server/agent-turn-stream';

const accepted: AgentTurnAccepted = {
  conversation_id: '30000000-0000-4000-8000-000000000001',
  user_message_id: '40000000-0000-4000-8000-000000000001',
  assistant_message_id: '50000000-0000-4000-8000-000000000001',
  run_id: null,
  assistant_status: 'completed',
};
async function events(response: Response) {
  const body = await response.text();
  return body.split('\n\n').flatMap((block) => {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
    return event && data
      ? [{ event, value: AgentTurnStreamEventV1Schema.parse(JSON.parse(data)) }]
      : [];
  });
}

describe('request-bound turn stream', () => {
  it('emits ordered bounded activity and then the accepted terminal state', async () => {
    const stream = agentTurnStream({
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
    expect(stream.status).toBe(202);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect((await events(stream)).map((item) => [item.event, item.value.sequence])).toEqual([
      ['activity', 0],
      ['activity', 1],
      ['terminal', 2],
    ]);
  });

  it('serializes only public error codes', async () => {
    const generic = agentTurnStream({
      execute: async () => {
        throw new Error('private provider prompt and secret');
      },
      requestSignal: new AbortController().signal,
    });
    const body = await generic.text();
    expect(body).toContain('PROVIDER_UNAVAILABLE');
    expect(body).not.toContain('private provider prompt');

    const normalized = agentTurnStream({
      execute: async () => {
        throw Object.assign(new Error('private authorization detail'), {
          code: 'NO_AUTHORIZED_RESULT',
        });
      },
      requestSignal: new AbortController().signal,
    });
    expect((await events(normalized)).at(-1)?.value).toMatchObject({
      type: 'terminal',
      accepted: null,
      error_code: 'NO_AUTHORIZED_RESULT',
    });
  });

  it('aborts runtime work when the response body is cancelled', async () => {
    let runtimeSignal: AbortSignal | undefined;
    const stream = agentTurnStream({
      execute: async (_emit, signal) => {
        runtimeSignal = signal;
        return new Promise<AgentTurnAccepted>(() => undefined);
      },
      requestSignal: new AbortController().signal,
    });
    const reader = stream.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(runtimeSignal?.aborted).toBe(true);
  });
});
