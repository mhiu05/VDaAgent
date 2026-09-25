import { randomUUID } from 'node:crypto';
import { RunTaskSchema, type RunEvent } from '@vda/contracts';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { normalizeRun } from '../mapping/run';
import { json } from '../mapping/rows';
import { ConversationRepository } from '../repositories/conversation-repository';

const code = 'TERMINAL_LEGACY_REPAIRED';

/** Repair only stale projections of an already terminal historical run. */
export async function repairTerminalLegacyRun(
  db: Driver,
  orgId: string,
  runId: string,
  options: { olderThan: Date; apply?: boolean; date?: Date },
) {
  if (Number.isNaN(options.olderThan.getTime())) fail('INVALID_CUTOFF', 422);
  const date = options.date ?? new Date();
  if (options.olderThan > date) fail('FUTURE_CUTOFF', 422);
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `SELECT payload,lease_until FROM runs WHERE org_id=$1 AND id=$2${options.apply ? ' FOR UPDATE NOWAIT' : ''}`,
      [orgId, runId],
    );
    if (!rows[0]) fail('RUN_NOT_FOUND', 404);
    const run = normalizeRun(rows[0]);
    const lease = rows[0].lease_until ? new Date(String(rows[0].lease_until)) : null;
    const reason =
      run.workflow_version !== 'legacy-v1'
        ? 'NOT_LEGACY'
        : !['succeeded', 'failed', 'cancelled'].includes(run.status)
          ? 'RUN_ACTIVE'
          : lease && lease > date
            ? 'LIVE_LEASE'
            : new Date(run.updated_at) > options.olderThan
              ? 'RUN_TOO_RECENT'
              : null;
    const messages = await tx.query(
      `SELECT id,role,updated_at FROM messages WHERE org_id=$1 AND run_id=$2 AND
       ((role='assistant' AND (sender_agent IS NULL OR client_turn_id IS NOT NULL) AND status='in_progress') OR
        (role='user' AND status='submitted'))${options.apply ? ' FOR UPDATE NOWAIT' : ''}`,
      [orgId, runId],
    );
    const tasks = (
      await tx.query(
        `SELECT id,payload FROM tasks WHERE org_id=$1 AND run_id=$2${options.apply ? ' FOR UPDATE NOWAIT' : ''}`,
        [orgId, runId],
      )
    )
      .map((row) => RunTaskSchema.parse(json(row)))
      .filter((task) => task.status === 'pending' || task.status === 'running');
    const preview = {
      org_id: orgId,
      run_id: runId,
      status: run.status,
      reason,
      active_assistants: messages.filter((row) => row.role === 'assistant').length,
      submitted_users: messages.filter((row) => row.role === 'user').length,
      pending_tasks: tasks.length,
    };
    if (!options.apply) return preview;
    if (reason) fail(reason, 409);
    if (messages.some((row) => new Date(String(row.updated_at)) > options.olderThan))
      fail('MESSAGE_TOO_RECENT', 409);
    const linkedJobs = await tx.query(
      'SELECT id FROM agent_turn_jobs WHERE org_id=$1 AND run_id=$2 LIMIT 1',
      [orgId, runId],
    );
    if (linkedJobs.length) fail('RUN_HAS_DURABLE_JOB', 409);
    for (const task of tasks) {
      await tx.query('UPDATE tasks SET payload=$4 WHERE org_id=$1 AND run_id=$2 AND id=$3', [
        orgId,
        runId,
        task.task_id,
        JSON.stringify({ ...task, status: 'cancelled', error_code: code }),
      ]);
    }
    const report =
      run.status === 'succeeded'
        ? (
            await tx.query(
              'SELECT id FROM reports WHERE org_id=$1 AND run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
              [orgId, runId],
            )
          )[0]
        : null;
    const conversation = new ConversationRepository(tx);
    for (const row of messages) {
      const message = await conversation.message(tx, orgId, String(row.id));
      if (message.role === 'user') message.status = 'completed';
      else {
        message.status =
          run.status === 'succeeded' ? 'completed' : (run.status as 'failed' | 'cancelled');
        message.content =
          run.status === 'succeeded'
            ? 'Lượt phân tích đã hoàn thành. Xem kết quả đã lưu.'
            : 'Lượt phân tích lịch sử đã kết thúc.';
        message.parts = [
          { type: 'text', text: message.content },
          { type: 'run_ref', run_id: runId, status: run.status },
          ...(report
            ? [{ type: 'report_ref' as const, run_id: runId, report_id: String(report.id) }]
            : []),
          ...(run.status === 'succeeded'
            ? []
            : [
                {
                  type: 'error' as const,
                  code: /^[A-Z0-9_]{1,100}$/.test(run.error_code ?? '') ? run.error_code! : code,
                  retryable: false,
                },
              ]),
        ];
      }
      message.updated_at = date.toISOString();
      await conversation.updateMessage(tx, message);
      await conversation.touchConversation(tx, orgId, message.conversation_id, message.updated_at);
    }
    if (tasks.length || messages.length) {
      const event: RunEvent = {
        event_id: randomUUID(),
        org_id: orgId,
        run_id: runId,
        task_id: null,
        created_at: date.toISOString(),
        message: 'terminal legacy projections repaired',
      };
      await tx.query('INSERT INTO events(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
        orgId,
        event.event_id,
        runId,
        JSON.stringify(event),
      ]);
    }
    return preview;
  });
}
