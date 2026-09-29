import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/frontend/lib/http/api-client';
import { sendTurnStream } from '../../src/frontend/lib/sse';
import { sendTurn } from '../../src/frontend/features/agent-chat/api/conversations';
import { deliverAgentTurn } from '../../src/frontend/features/agent-chat/api/turn-delivery';

vi.mock('../../src/frontend/lib/sse', () => ({ sendTurnStream: vi.fn() }));
vi.mock('../../src/frontend/features/agent-chat/api/conversations', () => ({ sendTurn: vi.fn() }));

const identity = { client_turn_id: 'turn-1', idempotency_key: 'key-1' };
const input = { text: 'Inspect inventory' } as Parameters<typeof deliverAgentTurn>[1];
const accepted = { conversation_id: 'conversation-1', run_id: 'run-1' };

describe('turn delivery identity', () => {
  beforeEach(() => {
    vi.mocked(sendTurnStream).mockReset();
    vi.mocked(sendTurn).mockReset();
  });

  it.each([404, 406])(
    'uses JSON with the same identity when streaming is unavailable (%i)',
    async (status) => {
      vi.mocked(sendTurnStream).mockRejectedValue(new ApiError('Unavailable', status));
      vi.mocked(sendTurn).mockResolvedValue(accepted as Awaited<ReturnType<typeof sendTurn>>);
      await expect(
        deliverAgentTurn('org-1', input, identity, 'conversation-1', true, vi.fn()),
      ).resolves.toBe(accepted);
      expect(sendTurn).toHaveBeenCalledOnce();
      expect(sendTurn).toHaveBeenCalledWith('org-1', input, identity, 'conversation-1');
    },
  );

  it('does not submit again after an ambiguous accepted stream failure', async () => {
    const failure = new ApiError('Interrupted', 502);
    vi.mocked(sendTurnStream).mockRejectedValue(failure);
    await expect(deliverAgentTurn('org-1', input, identity, undefined, true, vi.fn())).rejects.toBe(
      failure,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });
});
