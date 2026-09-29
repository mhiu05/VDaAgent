import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';

const resources: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) await resource.close();
});

describe('private external-channel delivery', () => {
  it('deduplicates webhook occurrences and sends only after the canonical assistant is terminal', async () => {
    const { repo, pg } = await createTestRepository();
    resources.push({
      close: async () => {
        await repo.close();
        await pg.close();
      },
    });
    await pg.exec(
      await readFile(
        'src/backend/supabase/migrations/20260929093000_external_channel_deliveries.sql',
        'utf8',
      ),
    );
    const conversationId = randomUUID();
    const conversation = await repo.ensureExternalConversation(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversationId,
    );
    expect(conversation.conversation_id).toBe(conversationId);
    expect(
      (await repo.ensureExternalConversation(TEST_USERS.owner, TEST_ORGS.alpha, conversationId))
        .conversation_id,
    ).toBe(conversationId);
    await expect(
      repo.ensureExternalConversation(TEST_USERS.beta, TEST_ORGS.alpha, conversationId),
    ).rejects.toThrow();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        client_turn_id: randomUUID(),
        text: 'Analyze inventory',
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
      },
      'telegram:42',
      conversationId,
    );
    const delivery = {
      delivery_id: randomUUID(),
      event_key: '42',
      chat_id: '123',
      external_user_id: '456',
      conversation_id: conversationId,
      assistant_message_id: turn.assistant_message.message_id,
    };
    await repo.enqueueExternalDelivery(TEST_USERS.owner, TEST_ORGS.alpha, delivery);
    await repo.enqueueExternalDelivery(TEST_USERS.owner, TEST_ORGS.alpha, delivery);
    expect((await pg.query('SELECT id FROM external_channel_deliveries')).rows).toHaveLength(1);
    expect(await repo.claimExternalDelivery('delivery-worker')).toBeNull();
    const turnLease = await repo.claimAgentTurnJob('turn-worker', new Date(), 120_000);
    expect(turnLease).not.toBeNull();
    await repo.completeAgentTurnJob(turnLease!, 'Evidence-backed answer.');
    const claimed = await repo.claimExternalDelivery('delivery-worker');
    expect(claimed).toMatchObject({ delivery_id: delivery.delivery_id, attempts: 1 });
    expect(await repo.claimExternalDelivery('another-worker')).toBeNull();
    await repo.finishExternalDelivery(claimed!, { sent: true });
    expect(await repo.claimExternalDelivery('delivery-worker')).toBeNull();
  }, 30_000);
});
