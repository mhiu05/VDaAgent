import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AnalysisRequestSchema, MessageSchema, RunSchema, RunTaskSchema } from '@vda/contracts';
import {
  createLegacyTestDatabase,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
} from '../../helpers/postgres';
import { retireLegacyRun } from '../../../scripts/maintenance/retire-legacy-run';
import { repairTerminalLegacyRun } from '../../../scripts/maintenance/repair-terminal-legacy-run';

const orgId = TEST_ORGS.alpha;
const runId = '60000000-0000-4000-8000-000000000001';
const laterId = '60000000-0000-4000-8000-000000000002';
const taskId = '70000000-0000-4000-8000-000000000001';
const conversationId = '50000000-0000-4000-8000-000000000001';
const userMessageId = '80000000-0000-4000-8000-000000000001';
const assistantMessageId = '80000000-0000-4000-8000-000000000002';
const createdAt = '2026-09-20T00:00:00.000Z';

describe('historical run maintenance', () => {
  it('previews, fences an expired run, and repairs only its old placeholders', async () => {
    const pg = await createLegacyTestDatabase();
    try {
      await pg.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [orgId, 'Alpha']);
      await pg.query(
        'INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES($1,$2,$3,$4,$5)',
        [orgId, conversationId, TEST_USERS.owner, 'interactive', 'Historical analysis'],
      );
      const request = AnalysisRequestSchema.parse({
        org_id: orgId,
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
        question: 'Historical analysis',
        conversation_id: conversationId,
      });
      const run = RunSchema.parse({
        run_id: runId,
        org_id: orgId,
        created_by: TEST_USERS.owner,
        request,
        status: 'running',
        created_at: createdAt,
        updated_at: createdAt,
        idempotency_key: 'historical-key',
        request_hash: 'historical-hash',
        entrypoint: 'interactive',
        occurrence_id: null,
        attempt: 1,
        fencing_token: 4,
        lease_until: '2026-09-21T00:00:00.000Z',
        error_code: null,
        report_artifact_id: null,
        cancel_requested: false,
      });
      async function insertRun(id: string, key: string, date: string) {
        const payload = { ...run, run_id: id, idempotency_key: key };
        await pg.query(
          `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,
          lease_until,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orgId,
            id,
            TEST_USERS.owner,
            key,
            payload.request_hash,
            payload.status,
            payload.lease_until,
            payload.fencing_token,
            date,
            JSON.stringify(payload),
          ],
        );
      }
      await insertRun(runId, 'historical-key', createdAt);
      await insertRun(laterId, 'later-key', '2026-09-22T00:00:00.000Z');
      const task = RunTaskSchema.parse({
        task_id: taskId,
        run_id: runId,
        org_id: orgId,
        kind: 'calculation',
        dependencies: [],
        status: 'running',
        attempt: 1,
        error_code: null,
      });
      await pg.query('INSERT INTO tasks(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
        orgId,
        taskId,
        runId,
        JSON.stringify(task),
      ]);
      for (const [messageId, role, status] of [
        [userMessageId, 'user', 'submitted'],
        [assistantMessageId, 'assistant', 'in_progress'],
      ] as const) {
        const message = MessageSchema.parse({
          message_id: messageId,
          org_id: orgId,
          conversation_id: conversationId,
          run_id: runId,
          client_turn_id: null,
          role,
          status,
          content: 'Historical analysis',
          parts: [{ type: 'text', text: 'Historical analysis' }],
          created_at: createdAt,
          updated_at: createdAt,
        });
        await pg.query(
          `INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status,
          created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orgId,
            messageId,
            conversationId,
            runId,
            JSON.stringify(message),
            role,
            status,
            createdAt,
            createdAt,
          ],
        );
      }
      for (const migration of [
        '20260921101524_agent_workflow_persistence.sql',
        '20260922130000_agent_stage_messages.sql',
        '20260924120000_durable_agent_execution.sql',
        '20260925082316_guard_run_workflow_version.sql',
      ])
        await pg.exec(await readFile(`src/backend/supabase/migrations/${migration}`, 'utf8'));

      const db = pgliteDriver(pg);
      const cutoverAt = new Date('2026-09-21T00:00:00Z');
      expect(
        (
          await retireLegacyRun(db, orgId, laterId, {
            date: new Date('2026-09-23T00:00:00Z'),
            cutoverAt,
          })
        ).reason,
      ).toBe('POST_CUTOVER_RUN');
      await expect(
        retireLegacyRun(db, orgId, laterId, {
          apply: true,
          date: new Date('2026-09-23T00:00:00Z'),
          cutoverAt,
        }),
      ).rejects.toThrow('POST_CUTOVER_RUN');
      expect(
        await retireLegacyRun(db, orgId, runId, {
          date: new Date('2026-09-22T00:00:00Z'),
        }),
      ).toMatchObject({ status: 'running', reason: null, pending_tasks: 1, active_assistants: 1 });
      expect(
        (await pg.query('SELECT status FROM runs WHERE id=$1', [runId])).rows[0],
      ).toMatchObject({ status: 'running' });
      await expect(
        retireLegacyRun(db, orgId, runId, {
          apply: true,
          date: new Date('2026-09-20T12:00:00Z'),
          cutoverAt,
        }),
      ).rejects.toThrow('LIVE_LEASE');
      await retireLegacyRun(db, orgId, runId, {
        apply: true,
        date: new Date('2026-09-22T00:00:00Z'),
        cutoverAt,
      });
      const retired = (await pg.query('SELECT payload FROM runs WHERE id=$1', [runId])).rows[0] as {
        payload: Record<string, unknown>;
      };
      expect(retired.payload).toMatchObject({
        status: 'failed',
        error_code: 'LEGACY_WORKFLOW_RETIRED',
        fencing_token: 5,
      });
      expect(retired.payload).not.toHaveProperty('workflow_version');
      expect(
        (await pg.query('SELECT payload FROM tasks WHERE id=$1', [taskId])).rows[0],
      ).toMatchObject({ payload: { status: 'cancelled', error_code: 'LEGACY_WORKFLOW_RETIRED' } });
      expect(
        (await pg.query('SELECT role,status FROM messages WHERE run_id=$1 ORDER BY role', [runId]))
          .rows,
      ).toEqual([
        { role: 'assistant', status: 'failed' },
        { role: 'user', status: 'completed' },
      ]);
      expect((await pg.query('SELECT id FROM events WHERE run_id=$1', [runId])).rows).toHaveLength(
        1,
      );

      await pg.query("UPDATE messages SET status='in_progress' WHERE id=$1", [assistantMessageId]);
      await pg.query("UPDATE messages SET status='submitted' WHERE id=$1", [userMessageId]);
      await pg.query('UPDATE tasks SET payload=$2 WHERE id=$1', [taskId, JSON.stringify(task)]);
      const olderThan = new Date('2029-01-01T00:00:00Z');
      expect(
        await repairTerminalLegacyRun(db, orgId, runId, {
          olderThan,
          date: new Date('2030-01-01T00:00:00Z'),
        }),
      ).toMatchObject({ reason: null, active_assistants: 1, submitted_users: 1, pending_tasks: 1 });
      await repairTerminalLegacyRun(db, orgId, runId, {
        olderThan,
        apply: true,
        date: new Date('2030-01-01T00:00:00Z'),
      });
      expect(
        (await pg.query('SELECT role,status FROM messages WHERE run_id=$1 ORDER BY role', [runId]))
          .rows,
      ).toEqual([
        { role: 'assistant', status: 'failed' },
        { role: 'user', status: 'completed' },
      ]);
      expect(
        (await pg.query('SELECT payload FROM tasks WHERE id=$1', [taskId])).rows[0],
      ).toMatchObject({ payload: { status: 'cancelled', error_code: 'TERMINAL_LEGACY_REPAIRED' } });
      expect(
        (await pg.query('SELECT payload FROM runs WHERE id=$1', [runId])).rows[0],
      ).toMatchObject({ payload: { status: 'failed', error_code: 'LEGACY_WORKFLOW_RETIRED' } });
    } finally {
      await pg.close();
    }
  }, 60_000);
});
