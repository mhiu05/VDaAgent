import { randomUUID } from 'node:crypto';
import { RunTaskSchema, type AnalysisRun, type RunEvent } from '@vda/contracts';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { normalizeRun } from '../mapping/run';
import { json } from '../mapping/rows';
import { ConversationRepository } from '../repositories/conversation-repository';
import { updateRun } from '../repositories/run-repository';

const retirementCode = 'LEGACY_WORKFLOW_RETIRED';
const active = new Set(['queued', 'running']);

function inspect(run: AnalysisRun, storedCreatedAt: Date, date: Date, cutoverAt?: Date) {
  if (run.workflow_version !== 'legacy-v1') return 'NOT_LEGACY';
  if (cutoverAt && storedCreatedAt > cutoverAt) return 'POST_CUTOVER_RUN';
  if (!active.has(run.status)) return 'RUN_TERMINAL';
  if (run.lease_until && run.lease_until > date.toISOString()) return 'LIVE_LEASE';
  return null;
}

export type LegacyRetirementPreview = {
  run_id: string;
  org_id: string;
  status: AnalysisRun['status'];
  reason: string | null;
  pending_tasks: number;
  active_assistants: number;
};

/** Scoped administrative recovery. The caller owns the cutover inventory and audit log. */
export async function retireLegacyRun(
  db: Driver,
  orgId: string,
  runId: string,
  options: { apply?: boolean; date?: Date; cutoverAt?: Date } = {},
): Promise<LegacyRetirementPreview> {
  if (options.apply && !options.cutoverAt) fail('CUTOVER_TIME_REQUIRED', 422);
  const date = options.date ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `SELECT payload,created_at,lease_until FROM runs WHERE org_id=$1 AND id=$2${options.apply ? ' FOR UPDATE' : ''}`,
      [orgId, runId],
    );
    if (!rows[0]) fail('RUN_NOT_FOUND', 404);
    const run = normalizeRun(rows[0]);
    const hadStoredVersion = Object.prototype.hasOwnProperty.call(
      json(rows[0]),
      'workflow_version',
    );
    const storedLease = rows[0].lease_until == null ? null : new Date(String(rows[0].lease_until));
    const storedCreatedAt = new Date(String(rows[0].created_at));
    const reason =
      storedLease && storedLease.getTime() > date.getTime()
        ? 'LIVE_LEASE'
        : inspect(run, storedCreatedAt, date, options.cutoverAt);
    const taskRows = await tx.query(
      `SELECT id,payload FROM tasks WHERE org_id=$1 AND run_id=$2${options.apply ? ' FOR UPDATE' : ''}`,
      [orgId, runId],
    );
    const pendingTasks = taskRows
      .map((row) => RunTaskSchema.parse(json(row)))
      .filter((task) => task.status === 'pending' || task.status === 'running');
    const assistantRows = await tx.query(
      `SELECT id FROM messages WHERE org_id=$1 AND run_id=$2 AND role='assistant' AND sender_agent IS NULL AND status='in_progress'${options.apply ? ' FOR UPDATE' : ''}`,
      [orgId, runId],
    );
    const userRows = await tx.query(
      `SELECT id FROM messages WHERE org_id=$1 AND run_id=$2 AND role='user' AND status='submitted'${options.apply ? ' FOR UPDATE' : ''}`,
      [orgId, runId],
    );
    const preview = {
      run_id: runId,
      org_id: orgId,
      status: run.status,
      reason,
      pending_tasks: pendingTasks.length,
      active_assistants: assistantRows.length,
    };
    if (!options.apply) return preview;
    if (reason) fail(reason, 409);

    run.status = 'failed';
    run.error_code = retirementCode;
    run.lease_until = null;
    run.fencing_token++;
    if (!hadStoredVersion) delete run.workflow_version;
    await updateRun(tx, run);
    for (const task of pendingTasks) {
      const retired = { ...task, status: 'cancelled' as const, error_code: retirementCode };
      await tx.query('UPDATE tasks SET payload=$4 WHERE org_id=$1 AND run_id=$2 AND id=$3', [
        orgId,
        runId,
        task.task_id,
        JSON.stringify(retired),
      ]);
    }
    const event: RunEvent = {
      event_id: randomUUID(),
      org_id: orgId,
      run_id: runId,
      task_id: null,
      created_at: date.toISOString(),
      message: 'legacy workflow retired',
    };
    await tx.query('INSERT INTO events(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
      orgId,
      event.event_id,
      runId,
      JSON.stringify(event),
    ]);
    const conversation = new ConversationRepository(tx);
    for (const row of assistantRows) {
      const assistant = await conversation.message(tx, orgId, String(row.id), true);
      if (assistant.status !== 'in_progress') continue;
      assistant.status = 'failed';
      assistant.content = 'Lượt phân tích cũ đã dừng sau khi chuyển hệ thống.';
      assistant.parts = [
        { type: 'text', text: assistant.content },
        { type: 'run_ref', run_id: runId, status: 'failed' },
        { type: 'error', code: retirementCode, retryable: false },
      ];
      assistant.updated_at = date.toISOString();
      await conversation.updateMessage(tx, assistant);
      await conversation.touchConversation(
        tx,
        orgId,
        assistant.conversation_id,
        assistant.updated_at,
      );
    }
    for (const row of userRows) {
      const message = await conversation.message(tx, orgId, String(row.id), true);
      if (message.status !== 'submitted') continue;
      message.status = 'completed';
      message.updated_at = date.toISOString();
      await conversation.updateMessage(tx, message);
    }
    return preview;
  });
}
