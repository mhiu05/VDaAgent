import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalDeliveryLease, Repository } from '@vda/db';
import type { ExternalChannelAdapter } from '../../src/backend/agents/external/telegram';
import { dispatchExternalDelivery } from '../../src/backend/worker/external-delivery';

const lease: ExternalDeliveryLease = {
  delivery_id: '10000000-0000-4000-8000-000000000001',
  event_key: '42',
  chat_id: '123',
  external_user_id: '456',
  conversation_id: '20000000-0000-4000-8000-000000000001',
  assistant_message_id: '30000000-0000-4000-8000-000000000001',
  org_id: '40000000-0000-4000-8000-000000000001',
  user_id: '50000000-0000-4000-8000-000000000001',
  worker_id: 'test-worker',
  attempts: 1,
};

afterEach(() => vi.restoreAllMocks());

describe('external delivery dispatcher', () => {
  it('sends only a concise terminal answer and records delivery', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = {
      getMessage: vi.fn(async () => ({ status: 'completed', content: 'Inventory is ageing.' })),
      finishExternalDelivery: vi.fn(async () => undefined),
    } as unknown as Repository;
    const adapter: ExternalChannelAdapter = { send: vi.fn(async () => undefined) };
    await dispatchExternalDelivery(repo, lease, adapter);
    expect(adapter.send).toHaveBeenCalledWith('123', 'Inventory is ageing.');
    expect(repo.finishExternalDelivery).toHaveBeenCalledWith(lease, { sent: true });
  });

  it('retains the delivery for a bounded retry when transport fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = {
      getMessage: vi.fn(async () => ({ status: 'completed', content: 'Inventory is ageing.' })),
      finishExternalDelivery: vi.fn(async () => undefined),
    } as unknown as Repository;
    const adapter: ExternalChannelAdapter = {
      send: vi.fn(async () => {
        throw new Error('TELEGRAM_SEND_503');
      }),
    };
    await dispatchExternalDelivery(repo, lease, adapter);
    expect(repo.finishExternalDelivery).toHaveBeenCalledWith(lease, {
      sent: false,
      error_code: 'TELEGRAM_SEND_503',
    });
  });
});
