import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestRepository,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
} from '../../../../tests/helpers/postgres.js';
import { reconcileStalledTurn } from './reconcile-stalled-turn';

const resources: {
  repo: Awaited<ReturnType<typeof createTestRepository>>['repo'];
  close: () => Promise<void>;
}[] = [];
async function setup() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return { pg, repo, db: pgliteDriver(pg) };
}
afterEach(async () => {
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});

const input = {
  org_id: TEST_ORGS.alpha,
  client_turn_id: '60000000-0000-4000-8000-000000000081',
  text: 'Inspect inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};
const cutoff = new Date('2021-01-01T00:00:00Z');
async function backdate(
  pg: Awaited<ReturnType<typeof createTestRepository>>['pg'],
  turnId: string,
) {
  await pg.query(
    'UPDATE messages SET created_at=$1,updated_at=$1 WHERE org_id=$2 AND client_turn_id=$3',
    ['2020-01-01T00:00:00Z', input.org_id, turnId],
  );
}

describe('stalled turn reconciliation', () => {
  it('previews, requires owner stop, and terminalizes only an unlinked old placeholder', async () => {
    const { pg, repo, db } = await setup();
    const turn = await repo.startTurn(TEST_USERS.owner, input, 'stalled-turn');
    await backdate(pg, input.client_turn_id);
    const ids = [input.org_id, turn.conversation.conversation_id, input.client_turn_id] as const;
    const preview = await reconcileStalledTurn(db, ...ids, { olderThan: cutoff });
    expect(preview).toMatchObject({
      reason: null,
      user_message_id: turn.user_message.message_id,
      assistant_message_id: turn.assistant_message.message_id,
    });
    expect(
      (await repo.startTurn(TEST_USERS.owner, input, 'stalled-turn')).assistant_message.status,
    ).toBe('in_progress');
    await expect(
      reconcileStalledTurn(db, ...ids, { olderThan: cutoff, apply: true }),
    ).rejects.toThrow('TURN_OWNER_STOP_REQUIRED');
    await reconcileStalledTurn(db, ...ids, { olderThan: cutoff, apply: true, ownerStopped: true });
    const replay = await repo.startTurn(TEST_USERS.owner, input, 'stalled-turn');
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

  it('refuses a recent turn and a turn linked to a run', async () => {
    const { pg, repo, db } = await setup();
    const turn = await repo.startTurn(TEST_USERS.owner, input, 'linked-turn');
    const ids = [input.org_id, turn.conversation.conversation_id, input.client_turn_id] as const;
    expect(
      (await reconcileStalledTurn(db, ...ids, { olderThan: new Date('2020-01-01T00:00:00Z') }))
        .reason,
    ).toBe('TURN_TOO_RECENT');
    await backdate(pg, input.client_turn_id);
    const run = await repo.attachRunToTurn(
      TEST_USERS.owner,
      {
        org_id: input.org_id,
        conversation_id: ids[1],
        user_message_id: turn.user_message.message_id,
        assistant_message_id: turn.assistant_message.message_id,
        client_turn_id: input.client_turn_id,
      },
      {
        org_id: input.org_id,
        scope: input.scope,
        data_as_of: input.data_as_of,
        question: input.text,
        conversation_id: ids[1],
      },
      'linked-run',
    );
    expect((await reconcileStalledTurn(db, ...ids, { olderThan: cutoff })).reason).toBe(
      'TURN_HAS_RUN',
    );
    await expect(
      reconcileStalledTurn(db, ...ids, { olderThan: cutoff, apply: true, ownerStopped: true }),
    ).rejects.toThrow('TURN_HAS_RUN');
    expect((await repo.getRun(TEST_USERS.owner, input.org_id, run.run_id)).run.status).toBe(
      'queued',
    );
  });

  it('refuses a durable job before it has a run', async () => {
    const { repo, db } = await setup();
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner, input, 'durable-turn');
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
