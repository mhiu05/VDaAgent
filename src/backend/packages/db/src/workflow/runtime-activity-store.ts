import { randomUUID } from 'node:crypto';
import { RuntimeActivityRecordSchema, type RuntimeActivityRecord, type RuntimeActivityEvent, type AnalysisRun } from '@vda/contracts';
import type { Driver } from '../driver';
import { json } from '../mapping/rows';
const now = () => new Date().toISOString();

export async function writeRuntimeRecord(tx: Driver, record: RuntimeActivityRecord) {
  await tx.query(`INSERT INTO runtime_activities(org_id,id,run_id,conversation_id,kind,step_key,status,payload,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT(org_id,run_id,kind,step_key)
    DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`,
    [record.org_id,record.activity_id,record.run_id,record.conversation_id,record.kind,record.step_key,record.status,JSON.stringify(record),record.created_at,record.updated_at]);
  const cursor = await tx.query('UPDATE runs SET runtime_sequence=runtime_sequence+1 WHERE org_id=$1 AND id=$2 RETURNING runtime_sequence',[record.org_id,record.run_id]);
  const event: RuntimeActivityEvent = { event_id:randomUUID(),run_id:record.run_id,sequence:Number(cursor[0].runtime_sequence),type:record.kind,record,created_at:record.updated_at };
  await tx.query('INSERT INTO runtime_activity_events(org_id,id,run_id,activity_id,sequence,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[record.org_id,event.event_id,record.run_id,record.activity_id,event.sequence,JSON.stringify(event)]);
}

export async function terminalizeRuntimeActivities(tx: Driver, run: AnalysisRun, status: 'failed'|'cancelled', code: string) {
  const rows = await tx.query("SELECT payload FROM runtime_activities WHERE org_id=$1 AND run_id=$2 AND status IN ('queued','running','waiting') FOR UPDATE",[run.org_id,run.run_id]);
  for (const row of rows) await writeRuntimeRecord(tx,{...RuntimeActivityRecordSchema.parse(json(row)),status,error_code:code,updated_at:now()});
}

