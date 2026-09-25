import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/http/api-client';
import { sendTurnStream } from '../../../lib/sse';
import { sendTurn } from './conversations';
import { deliverAgentTurn } from './turn-delivery';

vi.mock('../../../lib/sse', () => ({ sendTurnStream: vi.fn() }));
vi.mock('./conversations', () => ({ sendTurn: vi.fn() }));

const input = { text: 'Inspect inventory' } as Parameters<typeof deliverAgentTurn>[1];
const identity = { client_turn_id: 'turn-1', idempotency_key: 'key-1' };
const accepted = { conversation_id: 'conversation-1', run_id: 'run-1' };

describe('agent turn delivery', () => {
  beforeEach(() => {
    vi.mocked(sendTurnStream).mockReset();
    vi.mocked(sendTurn).mockReset();
  });

  it.each([404, 406])(
    'retries an unavailable stream over JSON with the same identity (%i)',
    async (status) => {
      vi.mocked(sendTurnStream).mockRejectedValue(new ApiError('Stream unavailable', status));
      vi.mocked(sendTurn).mockResolvedValue(accepted as Awaited<ReturnType<typeof sendTurn>>);
      const onActivity = vi.fn();

      await expect(
        deliverAgentTurn('org-1', input, identity, 'conversation-1', true, onActivity),
      ).resolves.toBe(accepted);
      expect(sendTurnStream).toHaveBeenCalledWith(
        'org-1',
        input,
        identity,
        onActivity,
        'conversation-1',
      );
      expect(sendTurn).toHaveBeenCalledWith('org-1', input, identity, 'conversation-1');
    },
  );

  it('does not retry a stream failure that may represent an accepted turn', async () => {
    const failure = new ApiError('Stream interrupted', 502);
    vi.mocked(sendTurnStream).mockRejectedValue(failure);

    await expect(deliverAgentTurn('org-1', input, identity, undefined, true, vi.fn())).rejects.toBe(
      failure,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });
});
