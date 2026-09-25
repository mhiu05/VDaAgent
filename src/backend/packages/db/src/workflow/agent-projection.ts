import {
  AGENT_V1_PERSONA_STAGES,
  AgentExecutionEventDataSchema,
  AgentExecutionEventSchema,
  aggregatePersonaStageStatus,
  type AgentExecutionEventType,
  type AgentExecutionStatus,
} from '@vda/contracts';
import { randomUUID } from 'node:crypto';
import type { Driver } from '../driver';
import { json } from '../mapping/rows';

const eventFor: Partial<Record<AgentExecutionStatus, AgentExecutionEventType>> = {
  queued: 'invocation_queued', running: 'invocation_started', waiting: 'invocation_waiting',
  completed: 'invocation_completed', failed: 'invocation_failed', cancelled: 'invocation_cancelled',
};

/** Persist the fixed agent-v1 persona view alongside each canonical task transition. */
export async function syncAgentInvocationsFromRun(tx: Driver, orgId: string, runId: string) {
  const jobs = await tx.query(
    "SELECT id,event_sequence FROM agent_turn_jobs WHERE org_id=$1 AND run_id=$2 AND status NOT IN ('failed','cancelled')",
    [orgId, runId],
  );
  if (!jobs.length) return;
  const tasks = (await tx.query('SELECT id,payload FROM tasks WHERE org_id=$1 AND run_id=$2', [orgId, runId]))
    .map((row) => ({ id: String(row.id), task: json(row) as { kind?: string; status?: string; error_code?: string | null } }));

  for (const current of jobs) {
    const jobId = String(current.id);
    const invocations = await tx.query(
      "SELECT id,step_key,status FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key IN ('data','compare','insight','report') FOR UPDATE",
      [orgId, jobId],
    );
    for (const key of ['data', 'compare', 'insight', 'report'] as const) {
      const invocation = invocations.find((item) => item.step_key === key);
      if (!invocation) continue; // Historical durable snapshots remain honest.
      const stageKinds = AGENT_V1_PERSONA_STAGES[key];
      const stages = stageKinds.map((kind) => tasks.find((item) => item.task.kind === kind)?.task.status ?? 'pending')
        .map((status) => status === 'running' || status === 'succeeded' || status === 'failed' || status === 'cancelled' ? status : 'pending') as ('pending'|'running'|'succeeded'|'failed'|'cancelled')[];
      const next = aggregatePersonaStageStatus(stages);
      if (invocation.status === next) continue;
      const changed = await tx.query(
        'UPDATE agent_invocations SET status=$4,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND id=$3 RETURNING id',
        [orgId, jobId, invocation.id, next],
      );
      if (!changed.length) continue;
      const type = eventFor[next];
      if (!type) continue;
      const failedTask = stages.includes('failed')
        ? tasks.find((item) => stageKinds.includes(item.task.kind ?? '') && item.task.status === 'failed')
        : undefined;
      const errorCode = typeof failedTask?.task.error_code === 'string' && /^[A-Z0-9_]{1,100}$/.test(failedTask.task.error_code)
        ? failedTask.task.error_code
        : undefined;
      const safe = AgentExecutionEventDataSchema.parse({ run_id: runId, ...(errorCode ? {error_code:errorCode} : {}) });
      const seq = await tx.query('UPDATE agent_turn_jobs SET event_sequence=event_sequence+1 WHERE org_id=$1 AND id=$2 RETURNING event_sequence', [orgId, jobId]);
      const event = AgentExecutionEventSchema.parse({
        event_id: randomUUID(), org_id: orgId, job_id: jobId, invocation_id: String(invocation.id),
        sequence: Number(seq[0].event_sequence), type, data: safe, created_at: new Date().toISOString(),
      });
      await tx.query(
        'INSERT INTO agent_execution_events(org_id,id,job_id,invocation_id,sequence,type,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [event.org_id,event.event_id,event.job_id,event.invocation_id,event.sequence,event.type,JSON.stringify(event.data)],
      );
    }
  }
}
