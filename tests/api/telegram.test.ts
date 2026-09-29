import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '@vda/db';
import type { AgentTurnRequest } from '@vda/contracts';
import { telegramWebhook } from '../../src/frontend/server/api/routes/telegram';
import type { ExternalChannelAdapter } from '../../src/backend/agents/external/telegram';

const org = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const assistant = '30000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function configure() {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
  vi.stubEnv(
    'TELEGRAM_BINDINGS_JSON',
    JSON.stringify([
      {
        chat_id: '123',
        telegram_user_id: '456',
        user_id: user,
        org_id: org,
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        timezone: 'Asia/Bangkok',
      },
    ]),
  );
}

function update(text: string, from = 456, updateId = 42, chat = 123) {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
    body: JSON.stringify({
      update_id: updateId,
      message: { message_id: 7, date: 1_780_000_000, from: { id: from }, chat: { id: chat }, text },
    }),
  });
}

describe('Telegram webhook adapter', () => {
  it('verifies the secret and exact chat/user binding before any repository work', async () => {
    configure();
    const repo = { ensureExternalConversation: vi.fn() } as unknown as Repository;
    const denied = update('Analyze inventory');
    denied.headers.set('x-telegram-bot-api-secret-token', 'wrong');
    await expect(telegramWebhook(denied, repo)).rejects.toThrow('TELEGRAM_WEBHOOK_DENIED');
    expect((await telegramWebhook(update('Analyze inventory', 999), repo)).status).toBe(200);
    expect((await telegramWebhook(update('Analyze inventory', 456, 42, 999), repo)).status).toBe(
      200,
    );
    expect(repo.ensureExternalConversation).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized webhook payloads before repository work', async () => {
    configure();
    const repo = { ensureExternalConversation: vi.fn() } as unknown as Repository;
    const request = (body: string) =>
      new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
        body,
      });
    await expect(telegramWebhook(request('{'), repo)).rejects.toThrow('TELEGRAM_UPDATE_INVALID');
    await expect(telegramWebhook(request('x'.repeat(16_385)), repo)).rejects.toThrow(
      'TELEGRAM_UPDATE_TOO_LARGE',
    );
    expect(repo.ensureExternalConversation).not.toHaveBeenCalled();
  });

  it('routes an authorized question through the canonical turn identity and delivery record', async () => {
    configure();
    const repo = {
      ensureExternalConversation: vi.fn(async () => undefined),
      enqueueExternalDelivery: vi.fn(async () => undefined),
    } as unknown as Repository;
    const submit = vi.fn(
      async (_user: string, _input: AgentTurnRequest, _key: string, _conversation?: string) => ({
        conversation_id: '40000000-0000-4000-8000-000000000001',
        user_message_id: '50000000-0000-4000-8000-000000000001',
        assistant_message_id: assistant,
        run_id: null,
        assistant_status: 'submitted' as const,
      }),
    );
    const adapter: ExternalChannelAdapter = { send: vi.fn(async () => undefined) };
    expect(
      (await telegramWebhook(update('Analyze inventory'), repo, { submit, adapter })).status,
    ).toBe(200);
    expect(
      (await telegramWebhook(update('Analyze inventory'), repo, { submit, adapter })).status,
    ).toBe(200);
    expect(submit).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        org_id: org,
        text: 'Analyze inventory',
        use_case: 'slow_moving_inventory',
        data_as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      'telegram:42',
      expect.any(String),
    );
    expect(submit.mock.calls[0]?.[1].client_turn_id).toBe(submit.mock.calls[1]?.[1].client_turn_id);
    expect(submit.mock.calls[0]?.[1].data_as_of).toBe(submit.mock.calls[1]?.[1].data_as_of);
    expect(repo.enqueueExternalDelivery).toHaveBeenCalledWith(
      user,
      org,
      expect.objectContaining({ event_key: '42', assistant_message_id: assistant }),
    );
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('answers a status command from the existing conversation without submitting a turn', async () => {
    configure();
    const repo = {
      ensureExternalConversation: vi.fn(async () => undefined),
      getLatestAgentTurnJob: vi.fn(async () => ({ job: { status: 'running' } })),
    } as unknown as Repository;
    const submit = vi.fn();
    const adapter: ExternalChannelAdapter = { send: vi.fn(async () => undefined) };
    await telegramWebhook(update('/status'), repo, { submit, adapter });
    expect(adapter.send).toHaveBeenCalledWith('123', expect.stringContaining('đang được xử lý'));
    expect(submit).not.toHaveBeenCalled();
  });
});
