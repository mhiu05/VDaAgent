import { randomUUID } from 'node:crypto';
import { RunTaskSchema, type AnalysisRun, type MessageStatus } from '@vda/contracts';
import type { Driver } from '../driver';
import { json } from '../mapping/rows';
import { ConversationRepository } from '../repositories/conversation-repository';
import { syncAgentInvocationsFromRun } from './agent-projection';
import { terminalizeRuntimeActivities } from './runtime-activity-store';

/** Close projections in the same transaction that terminalizes the canonical run. */
export async function terminalizeRun(
  tx: Driver,
  run: AnalysisRun,
  status: Extract<MessageStatus, 'failed' | 'cancelled'>,
  code: string,
) {
  const date = new Date().toISOString();
  await terminalizeRuntimeActivities(tx,run,status,code);
  const tasks = await tx.query(
    'SELECT id,payload FROM tasks WHERE org_id=$1 AND run_id=$2 FOR UPDATE',
    [run.org_id, run.run_id],
  );
  for (const row of tasks) {
    const task = RunTaskSchema.parse(json(row));
    if (task.status !== 'pending' && task.status !== 'running') continue;
    await tx.query('UPDATE tasks SET payload=$4 WHERE org_id=$1 AND run_id=$2 AND id=$3', [
      run.org_id,
      run.run_id,
      task.task_id,
      JSON.stringify({ ...task, status, error_code: code }),
    ]);
  }
  if (run.workflow_version === 'agent-v1')
    await syncAgentInvocationsFromRun(tx, run.org_id, run.run_id);
  const jobs = await tx.query(
    'SELECT id,user_message_id,assistant_message_id,conversation_id,status FROM agent_turn_jobs WHERE org_id=$1 AND run_id=$2 FOR UPDATE',
    [run.org_id, run.run_id],
  );
  for (const job of jobs) {
    if (['completed', 'failed', 'cancelled'].includes(String(job.status))) continue;
    const updated = await tx.query(
      `UPDATE agent_turn_jobs SET status=$3,error_code=$4,worker_id=NULL,lease_until=NULL,
       fencing_token=fencing_token+1,event_sequence=event_sequence+1,updated_at=$5
       WHERE org_id=$1 AND id=$2 RETURNING event_sequence`,
      [run.org_id, job.id, status, code, date],
    );
    await tx.query(
      "UPDATE agent_invocations SET status=$3,updated_at=$4 WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",
      [run.org_id, job.id, status, date],
    );
    await tx.query(
      `INSERT INTO agent_execution_events(org_id,id,job_id,sequence,type,data)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        run.org_id,
        randomUUID(),
        job.id,
        updated[0].event_sequence,
        status === 'cancelled' ? 'turn_cancelled' : 'turn_failed',
        JSON.stringify({ run_id: run.run_id, error_code: code }),
      ],
    );
  }
  const conversation = new ConversationRepository(tx);
  const messageRows = await tx.query(
    `SELECT id,role FROM messages WHERE org_id=$1 AND run_id=$2 AND
     ((role='assistant' AND (sender_agent IS NULL OR client_turn_id IS NOT NULL) AND status='in_progress') OR
      (role='user' AND status='submitted')) FOR UPDATE`,
    [run.org_id, run.run_id],
  );
  for (const row of messageRows) {
    const message = await conversation.message(tx, run.org_id, String(row.id));
    if (message.role === 'assistant') {
      message.status = status;
      message.content =
        status === 'cancelled' ? 'Lượt phân tích đã bị hủy.' : 'Lượt phân tích không thể hoàn tất.';
      message.parts = [
        { type: 'text', text: message.content },
        { type: 'run_ref', run_id: run.run_id, status: run.status },
        { type: 'error', code, retryable: false },
      ];
    } else message.status = 'completed';
    message.updated_at = date;
    await conversation.updateMessage(tx, message);
    await conversation.touchConversation(tx, run.org_id, message.conversation_id, date);
  }
}
