import { afterEach, describe, expect, it } from 'vitest';
import { createTestRepository, pgliteDriver, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { reconcileStalledTurn } from '../../../scripts/maintenance/reconcile-stalled-turn';

const resources: Array<() => Promise<void>> = [];
async function fixture() {
  const { pg, repo } = await createTestRepository();
  resources.push(async () => {
    await repo.close();
    await pg.close();
  });
  return { pg, repo, db: pgliteDriver(pg) };
}
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
});

const input = {
  org_id: TEST_ORGS.alpha,
  client_turn_id: '60000000-0000-4000-8000-000000000081',
  text: 'Inspect inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};
const cutoff = new Date('2021-01-01T00:00:00Z');
async function backdate(pg: Awaited<ReturnType<typeof createTestRepository>>['pg']) {
  await pg.query(
    'UPDATE messages SET created_at=$1,updated_at=$1 WHERE org_id=$2 AND client_turn_id=$3',
    ['2020-01-01T00:00:00Z', input.org_id, input.client_turn_id],
  );
}

describe('stalled turn operator guard', () => {
  it('previews an old unlinked turn and requires an explicit stopped owner before repair', async () => {
    const { pg, repo, db } = await fixture();
    const started = await repo.startTurn(TEST_USERS.owner, input, 'stalled-root');
    await backdate(pg);
    const ids = [input.org_id, started.conversation.conversation_id, input.client_turn_id] as const;
    expect(await reconcileStalledTurn(db, ...ids, { olderThan: cutoff })).toMatchObject({
      reason: null,
      user_message_id: started.user_message.message_id,
      assistant_message_id: started.assistant_message.message_id,
    });
    expect(
      (await repo.startTurn(TEST_USERS.owner, input, 'stalled-root')).assistant_message.status,
    ).toBe('in_progress');
    await expect(
      reconcileStalledTurn(db, ...ids, { olderThan: cutoff, apply: true }),
    ).rejects.toThrow('TURN_OWNER_STOP_REQUIRED');
    await reconcileStalledTurn(db, ...ids, { olderThan: cutoff, apply: true, ownerStopped: true });
    const replay = await repo.startTurn(TEST_USERS.owner, input, 'stalled-root');
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.user_message.status).toBe('completed');
    expect(replay.assistant_message).toMatchObject({ status: 'failed', run_id: null });
    expect(replay.assistant_message.parts).toContainEqual({
      type: 'error',
      code: 'TURN_INTERRUPTED',
      retryable: false,
    });
    expect((await reconcileStalledTurn(db, ...ids, { olderThan: cutoff })).reason).toBe(
      'TURN_TERMINAL',
    );
  });

  it('refuses recent turns and old turns already linked to an analysis', async () => {
    const { pg, repo, db } = await fixture();
    const started = await repo.startTurn(TEST_USERS.owner, input, 'linked-root');
    const ids = [input.org_id, started.conversation.conversation_id, input.client_turn_id] as const;
    expect(
      (await reconcileStalledTurn(db, ...ids, { olderThan: new Date('2020-01-01T00:00:00Z') }))
        .reason,
    ).toBe('TURN_TOO_RECENT');
    await backdate(pg);
    const run = await repo.attachRunToTurn(
      TEST_USERS.owner,
      {
        org_id: input.org_id,
        conversation_id: ids[1],
        user_message_id: started.user_message.message_id,
        assistant_message_id: started.assistant_message.message_id,
        client_turn_id: input.client_turn_id,
      },
      {
        org_id: input.org_id,
        scope: input.scope,
        data_as_of: input.data_as_of,
        question: input.text,
        conversation_id: ids[1],
      },
      'linked-run-root',
    );
    expect((await reconcileStalledTurn(db, ...ids, { olderThan: cutoff })).reason).toBe(
      'TURN_HAS_RUN',
    );
    await expect(
      reconcileStalledTurn(db, ...ids, {
        olderThan: cutoff,
        apply: true,
        ownerStopped: true,
      }),
    ).rejects.toThrow('TURN_HAS_RUN');
    expect((await repo.getRun(TEST_USERS.owner, input.org_id, run.run_id)).run.status).toBe(
      'queued',
    );
  });

  it('refuses to rewrite an accepted durable job before it has a run', async () => {
    const { repo, db } = await fixture();
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner, input, 'durable-root');
    const preview = await reconcileStalledTurn(
      db,
      input.org_id,
      accepted.conversation.conversation_id,
      input.client_turn_id,
      { olderThan: cutoff },
    );
    expect(preview.reason).toBe('TURN_HAS_JOB');
  });
});
