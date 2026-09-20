import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from './index.js';
import { parseInventoryCsv } from '@vda/domain';
import { CSV_COLUMNS, type AnalysisRequest } from '@vda/contracts';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
const resources: { repo: Repository; close: () => Promise<void> }[] = [];
async function setup() {
  const { pg, repo, uploads } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return { repo, uploads };
}
afterEach(async () => {
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});
const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
describe('durable tenant repository', () => {
  it('denies viewer writes and foreign tenant reads', async () => {
    const { repo } = await setup();
    await expect(repo.createRun(TEST_USERS.viewer, request, 'one')).rejects.toThrow(
      'VIEWER_READ_ONLY',
    );
    await expect(repo.catalog(TEST_USERS.owner, TEST_ORGS.beta)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
  });
  it('deduplicates actor keys but rejects changed request', async () => {
    const { repo } = await setup();
    const a = await repo.createRun(TEST_USERS.owner, request, 'one');
    const b = await repo.createRun(TEST_USERS.owner, request, 'one');
    expect(a.run_id).toBe(b.run_id);
    await expect(
      repo.createRun(TEST_USERS.owner, { ...request, question: 'other' }, 'one'),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('persists, pages, attaches and terminally finalizes an interactive turn', async () => {
    const { repo } = await setup();
    const turnInput = {
      org_id: TEST_ORGS.alpha,
      client_turn_id: '60000000-0000-4000-8000-000000000001',
      text: 'Show current available inventory',
      scope: request.scope,
      data_as_of: request.data_as_of,
    };
    const turn = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(turn.conversation).toMatchObject({ kind: 'interactive', title: turnInput.text });
    expect(turn.user_message).toMatchObject({ status: 'submitted', run_id: null });
    expect(turn.assistant_message).toMatchObject({ status: 'in_progress', run_id: null });
    await expect(
      repo.startTurn(TEST_USERS.owner, { ...turnInput, text: 'Changed request' }, 'turn-one'),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const repeated = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(repeated.assistant_message.message_id).toBe(turn.assistant_message.message_id);
    const run = await repo.attachRunToTurn(
      TEST_USERS.owner,
      {
        org_id: turnInput.org_id,
        conversation_id: turn.conversation.conversation_id,
        user_message_id: turn.user_message.message_id,
        assistant_message_id: turn.assistant_message.message_id,
        client_turn_id: turnInput.client_turn_id,
      },
      { ...request, conversation_id: turn.conversation.conversation_id },
      'run-for-turn',
    );
    const attachedReplay = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(attachedReplay).toMatchObject({
      idempotent_replay: true,
      assistant_message: { run_id: run.run_id, status: 'in_progress' },
    });
    const page = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      {
        limit: 30,
        cursor: null,
      },
    );
    expect(page.messages).toHaveLength(2);
    expect(page.messages.map((message) => message.run_id)).toEqual([run.run_id, run.run_id]);
    await repo.cancelRun(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id);
    const terminal = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      { limit: 30, cursor: null },
    );
    expect(terminal.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'cancelled',
      parts: expect.arrayContaining([
        expect.objectContaining({ type: 'run_ref', status: 'cancelled' }),
      ]),
    });
    expect(
      (await repo.listConversations(TEST_USERS.owner, TEST_ORGS.alpha, { limit: 30, cursor: null }))
        .conversations,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversation_id: turn.conversation.conversation_id }),
      ]),
    );
    await expect(
      repo.getConversation(TEST_USERS.beta, TEST_ORGS.alpha, turn.conversation.conversation_id),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(repo.startTurn(TEST_USERS.viewer, turnInput, 'viewer-turn')).rejects.toThrow(
      'VIEWER_READ_ONLY',
    );
  });
  it('claims exclusively across connections, rejects stale and cancelled leases', async () => {
    const { repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'one');
    const first = await repo.claimRun('first', new Date(Date.now() - 60000), 1000);
    expect(first).not.toBeNull();
    const second = await repo.claimRun('second');
    expect(second?.run.run_id).toBe(run.run_id);
    await expect(repo.assertLease(first!)).rejects.toThrow('LEASE_LOST');
    await expect(repo.readSnapshots(first!)).rejects.toThrow('LEASE_LOST');
    await expect(repo.addEvent(first!, 'stale')).rejects.toThrow('LEASE_LOST');
    await expect(repo.completeRun(first!, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'LEASE_LOST',
    );
    expect(await repo.claimRun('third')).toBeNull();
    await repo.cancelRun(TEST_USERS.owner, run.org_id, run.run_id);
    await expect(repo.assertLease(second!)).rejects.toThrow('LEASE_LOST');
  });
  it('pins rows and metric settings across retry and import', async () => {
    const { repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'one');
    const first = await repo.claimRun('first');
    const initial = await repo.readSnapshots(first!);
    expect(initial.rows).toHaveLength(12);
    await repo.failRun(first!, 'TEST');
    await repo.retryRun(TEST_USERS.owner, run.org_id, run.run_id);
    const second = await repo.claimRun('second');
    expect((await repo.readSnapshots(second!)).rows).toEqual(initial.rows);
    expect(await repo.getMetricConfig(second!)).toEqual({ slow_moving_threshold_days: 90 });
    expect(second?.fencing_token).toBeGreaterThan(first!.fencing_token);
  });
  it('validates whole CSV and never commits a partial batch', async () => {
    const { repo, uploads } = await setup();
    const header = CSV_COLUMNS.join(',');
    const valid =
      '2026-09-20,VN,Việt Nam (synthetic),P-ALPHA,Riverside (synthetic),Z-NORTH,North,U-13,RS-013,apartment,80,100,VND,available,2026-09-01,';
    const bad = valid.replace('U-13', 'U-14').replace(',100,VND', ',-10,VND');
    await expect(
      repo.importCsv(TEST_USERS.owner, {
        org_id: TEST_ORGS.alpha,
        source_name: 'test',
        csv: `${header}\n${valid}\n${bad}`,
      }),
    ).rejects.toThrow('CSV_ROW_3');
    expect(await repo.listImports(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
    const csv = `${header}\n${valid}`;
    const a = await repo.importCsv(TEST_USERS.owner, {
      org_id: TEST_ORGS.alpha,
      source_name: 'test',
      csv,
    });
    expect(uploads).toContainEqual(
      expect.objectContaining({
        bucket: 'source-imports',
        path: expect.stringContaining('/source.csv'),
      }),
    );
    expect(
      (
        await repo.importCsv(TEST_USERS.owner, {
          org_id: TEST_ORGS.alpha,
          source_name: 'test',
          csv,
        })
      ).import_id,
    ).toBe(a.import_id);
    expect(() => parseInventoryCsv(`${csv}\n${valid}`)).toThrow('DUPLICATE_SNAPSHOT');
  });
  it('pins definition versions and deduplicates simultaneous ticks', async () => {
    const { repo } = await setup();
    const def = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        name: 'Daily',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const due = new Date('2026-09-18T03:00:00Z');
    const a = await repo.tick(due);
    expect(a).toHaveLength(1);
    expect(a[0].definition_version).toBe(1);
    expect(await repo.tick(due)).toHaveLength(0);
    const edited = await repo.updateDefinition(
      TEST_USERS.owner,
      def.org_id,
      def.report_definition_id,
      {
        org_id: def.org_id,
        name: 'Changed',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '10:00',
        data_as_of_policy: 'previous_day',
        enabled: true,
      },
      due,
    );
    expect(edited.definition_version).toBe(2);
    expect(a[0].definition_snapshot.name).toBe('Daily');
  });
});
