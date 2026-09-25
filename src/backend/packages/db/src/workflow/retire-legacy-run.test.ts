import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AnalysisRequestSchema, MessageSchema, RunSchema, RunTaskSchema } from '@vda/contracts';
import {
  createLegacyTestDatabase,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
} from '../../../../tests/helpers/postgres.js';
import { retireLegacyRun } from './retire-legacy-run';
import { repairTerminalLegacyRun } from './repair-terminal-legacy-run';

const org = TEST_ORGS.alpha;
const actor = TEST_USERS.owner;
const conversationId = '50000000-0000-4000-8000-000000000001';
const runId = '60000000-0000-4000-8000-000000000001';
const taskId = '70000000-0000-4000-8000-000000000001';
const date = '2026-09-20T00:00:00.000Z';

describe('scoped legacy retirement', () => {
  it('previews without writes, fences an expired run, and preserves historical identity', async () => {
    const pg = await createLegacyTestDatabase();
    try {
      await pg.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [org, 'Alpha']);
      await pg.query(
        'INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES($1,$2,$3,$4,$5)',
        [org, conversationId, actor, 'interactive', 'Historical analysis'],
      );
      const request = AnalysisRequestSchema.parse({
        org_id: org,
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
        question: 'Historical analysis',
        conversation_id: conversationId,
      });
      const run = RunSchema.parse({
        run_id: runId,
        org_id: org,
        created_by: actor,
        request,
        status: 'running',
        created_at: date,
        updated_at: date,
        idempotency_key: 'old-key',
        request_hash: 'old-hash',
        entrypoint: 'interactive',
        occurrence_id: null,
        attempt: 1,
        fencing_token: 4,
        lease_until: '2026-09-21T00:00:00.000Z',
        error_code: null,
        report_artifact_id: null,
        cancel_requested: false,
      });
      await pg.query(
        `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,
        lease_until,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          org,
          runId,
          actor,
          run.idempotency_key,
          run.request_hash,
          run.status,
          run.lease_until,
          run.fencing_token,
          run.created_at,
          JSON.stringify(run),
        ],
      );
      const laterRunId = '60000000-0000-4000-8000-000000000002';
      const laterRun = { ...run, run_id: laterRunId, idempotency_key: 'later-key' };
      await pg.query(
        `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,
        lease_until,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          org,
          laterRunId,
          actor,
          laterRun.idempotency_key,
          laterRun.request_hash,
          laterRun.status,
          laterRun.lease_until,
          laterRun.fencing_token,
          '2026-09-22T00:00:00.000Z',
          JSON.stringify(laterRun),
        ],
      );
      const task = RunTaskSchema.parse({
        task_id: taskId,
        run_id: runId,
        org_id: org,
        kind: 'calculation',
        dependencies: [],
        status: 'running',
        attempt: 1,
        error_code: null,
      });
      await pg.query('INSERT INTO tasks(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
        org,
        taskId,
        runId,
        JSON.stringify(task),
      ]);
      for (const [id, role, status] of [
        ['80000000-0000-4000-8000-000000000001', 'user', 'submitted'],
        ['80000000-0000-4000-8000-000000000002', 'assistant', 'in_progress'],
      ] as const) {
        const message = MessageSchema.parse({
          message_id: id,
          org_id: org,
          conversation_id: conversationId,
          run_id: runId,
          client_turn_id: null,
          role,
          status,
          content: 'Historical analysis',
          parts: [{ type: 'text', text: 'Historical analysis' }],
          created_at: date,
          updated_at: date,
        });
        await pg.query(
          `INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status,
          created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [org, id, conversationId, runId, JSON.stringify(message), role, status, date, date],
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
      expect(
        (
          await retireLegacyRun(db, org, laterRunId, {
            date: new Date('2026-09-23T00:00:00Z'),
            cutoverAt: new Date('2026-09-21T00:00:00Z'),
          })
        ).reason,
      ).toBe('POST_CUTOVER_RUN');
      await expect(
        retireLegacyRun(db, org, laterRunId, {
          apply: true,
          date: new Date('2026-09-23T00:00:00Z'),
          cutoverAt: new Date('2026-09-21T00:00:00Z'),
        }),
      ).rejects.toThrow('POST_CUTOVER_RUN');
      const before = await retireLegacyRun(db, org, runId, {
        date: new Date('2026-09-22T00:00:00Z'),
      });
      expect(before).toMatchObject({
        status: 'running',
        reason: null,
        pending_tasks: 1,
        active_assistants: 1,
      });
      expect(
        (await pg.query('SELECT status FROM runs WHERE id=$1', [runId])).rows[0],
      ).toMatchObject({ status: 'running' });
      await expect(
        retireLegacyRun(db, org, runId, {
          apply: true,
          date: new Date('2026-09-20T12:00:00Z'),
          cutoverAt: new Date('2026-09-21T00:00:00Z'),
        }),
      ).rejects.toThrow('LIVE_LEASE');
      await retireLegacyRun(db, org, runId, {
        apply: true,
        date: new Date('2026-09-22T00:00:00Z'),
        cutoverAt: new Date('2026-09-21T00:00:00Z'),
      });
      const stored = (await pg.query('SELECT payload FROM runs WHERE id=$1', [runId])).rows[0] as {
        payload: Record<string, unknown>;
      };
      expect(stored.payload).toMatchObject({
        status: 'failed',
        error_code: 'LEGACY_WORKFLOW_RETIRED',
        fencing_token: 5,
      });
      expect(stored.payload).not.toHaveProperty('workflow_version');
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
      // A terminal historical run can still carry old in-progress placeholders.
      await pg.query("UPDATE messages SET status='in_progress' WHERE id=$1", [
        '80000000-0000-4000-8000-000000000002',
      ]);
      await pg.query("UPDATE messages SET status='submitted' WHERE id=$1", [
        '80000000-0000-4000-8000-000000000001',
      ]);
      const pending = { ...task, status: 'running' as const };
      await pg.query('UPDATE tasks SET payload=$2 WHERE id=$1', [taskId, JSON.stringify(pending)]);
      const olderThan = new Date('2029-01-01T00:00:00.000Z');
      expect(
        await repairTerminalLegacyRun(db, org, runId, {
          olderThan,
          date: new Date('2030-01-01T00:00:00.000Z'),
        }),
      ).toMatchObject({
        reason: null,
        active_assistants: 1,
        submitted_users: 1,
        pending_tasks: 1,
      });
      await repairTerminalLegacyRun(db, org, runId, {
        olderThan,
        apply: true,
        date: new Date('2030-01-01T00:00:00.000Z'),
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
  });
});
