import { randomUUID } from 'node:crypto';
import {
  ThreadContextSchema, RuntimeActivityInputSchema,
  RuntimeActivityRecordSchema, RuntimeActivityEventSchema, MemoryInputSchema,
  resolveReportIntent,
  type ThreadContext, type MessageContextRef, type RuntimeActivityInput,
  type RuntimeActivityRecord, type RunRuntimeSnapshot,
  type MemoryInput, type MemoryEntry, type MemoryQuery, type ReportRecord, type AnalysisRun,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver, Row } from '../driver';
import { fail } from '../errors';
import { asTimestamp } from '../mapping/conversation';
import { json } from '../mapping/rows';
import { readRun } from './run-repository';
import { fenceRun } from '../workflow/lease-repository';
import type { Lease } from '../types';
import { resolveContextReference } from '../authorization/context-references';
import { writeRuntimeRecord } from '../workflow/runtime-activity-store';

const decode = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
const now = () => new Date().toISOString();

export class WorkspaceRepository {
  constructor(private readonly db: Driver) {}

  getContextReference(user: string, org: string, ref: MessageContextRef) {
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx, user, org);
      return resolveContextReference(tx, org, ref);
    });
  }

  getThreadContext(user: string, org: string, conversationId: string): Promise<ThreadContext> {
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx, user, org);
      const rows = await tx.query('SELECT context FROM conversations WHERE org_id=$1 AND id=$2', [org, conversationId]);
      if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
      return ThreadContextSchema.parse(decode(rows[0].context));
    });
  }

  updateThreadContext(user: string, org: string, conversationId: string, value: ThreadContext): Promise<ThreadContext> {
    const context = ThreadContextSchema.parse(value);
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx, user, org, true);
      const rows = await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2 FOR UPDATE', [org, conversationId]);
      if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
      for (const id of context.dataset_ids) await resolveContextReference(tx, org, {type:'dataset', id});
      for (const id of [...context.referenced_artifact_ids, ...(context.active_artifact_id ? [context.active_artifact_id] : [])])
        await resolveContextReference(tx, org, {type:'artifact', id});
      if (context.active_report_id) await resolveContextReference(tx, org, {type:'report', id:context.active_report_id});
      if (context.current_run_id) {
        const run = await readRun(tx, org, context.current_run_id);
        if (run.request.conversation_id !== conversationId) fail('THREAD_RUN_MISMATCH', 422);
      }
      await tx.query('UPDATE conversations SET context=$3::jsonb,updated_at=now() WHERE org_id=$1 AND id=$2', [org, conversationId, JSON.stringify(context)]);
      return context;
    });
  }

  recordRuntimeActivity(lease: Lease, value: RuntimeActivityInput): Promise<RuntimeActivityRecord> {
    const input = RuntimeActivityInputSchema.parse(value);
    return this.db.transaction(async tx => {
      const run = await fenceRun(tx, lease);
      const rows = await tx.query('SELECT payload FROM runtime_activities WHERE org_id=$1 AND run_id=$2 AND kind=$3 AND step_key=$4 FOR UPDATE', [run.org_id, run.run_id, input.kind, input.step_key]);
      const prior = rows[0] ? RuntimeActivityRecordSchema.parse(json(rows[0])) : null;
      if (prior && (prior.agent_key !== input.agent_key || prior.parent_step_key !== input.parent_step_key)) fail('RUNTIME_STEP_CONFLICT', 409);
      if (input.parent_step_key) {
        const parent = await tx.query("SELECT id FROM runtime_activities WHERE org_id=$1 AND run_id=$2 AND kind='invocation' AND step_key=$3", [run.org_id, run.run_id, input.parent_step_key]);
        if (!parent[0]) fail('RUNTIME_PARENT_NOT_FOUND', 422);
      }
      if (input.parent_message_id && !(await tx.query("SELECT id FROM runtime_activities WHERE org_id=$1 AND run_id=$2 AND id=$3 AND kind='message'", [run.org_id,run.run_id,input.parent_message_id]))[0]) fail('RUNTIME_MESSAGE_PARENT_NOT_FOUND',422);
      const refs = [...new Set(input.artifact_refs ?? [])];
      const artifacts = refs.length ? await tx.query('SELECT id,kind FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=ANY($3::text[])',[run.org_id,run.run_id,refs]) : [];
      if (artifacts.length !== refs.length) fail('RUNTIME_ARTIFACT_MISMATCH',422);
      const visible = new Set(artifacts.filter(row=>!['report_draft','review_result'].includes(String(row.kind))).map(row=>String(row.id)));
      const publicRefs = refs.filter(id=>visible.has(id));
      if (input.artifact_refs) input.artifact_refs = publicRefs;
      // Evidence paths are meaningful only alongside a public artifact from this run.
      if (input.evidence_refs) input.evidence_refs = input.evidence_refs.filter(ref => publicRefs.some(id => ref === id || ref.startsWith(`${id}:`)));
      const date = now();
      const record: RuntimeActivityRecord = { ...input, activity_id: prior?.activity_id ?? randomUUID(), org_id:run.org_id, run_id:run.run_id, conversation_id:run.request.conversation_id, created_at:prior?.created_at ?? date, updated_at:date };
      if (prior && JSON.stringify({...prior, updated_at:date}) === JSON.stringify(record)) return prior;
      if (prior && input.kind === 'message') fail('RUNTIME_MESSAGE_IMMUTABLE', 409);
      // Completed calls replay exactly; failed/cancelled calls may restart under a new run lease.
      if (prior?.status === 'completed' && input.status !== 'completed') return prior;
      if (!prior) {
        const count = await tx.query('SELECT count(*)::int AS total FROM runtime_activities WHERE org_id=$1 AND run_id=$2',[run.org_id,run.run_id]);
        if (Number(count[0].total) >= 500) fail('RUNTIME_ACTIVITY_LIMIT',422);
      }
      await writeRuntimeRecord(tx, record);
      if (input.kind === 'tool' && input.status === 'completed') {
        await tx.query(`INSERT INTO agent_memory(org_id,id,layer,conversation_id,run_id,scope_key,memory_key,summary,artifact_refs,expires_at)
          VALUES($1,$2,'working',$3,$4,$4,$5,$6,$7::jsonb,now()+interval '1 day')
          ON CONFLICT(org_id,layer,scope_key,memory_key) DO UPDATE SET summary=excluded.summary,artifact_refs=excluded.artifact_refs,expires_at=excluded.expires_at,updated_at=now()`,
          [run.org_id,randomUUID(),run.request.conversation_id,run.run_id,input.step_key,input.summary || 'Tool completed',JSON.stringify(publicRefs)]);
      }
      return record;
    });
  }

  getRunRuntime(user: string, org: string, runId: string, afterSequence = 0): Promise<RunRuntimeSnapshot> {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) fail('INVALID_EVENT_CURSOR',422);
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org);
      await readRun(tx,org,runId);
      const records = (await tx.query('SELECT payload FROM runtime_activities WHERE org_id=$1 AND run_id=$2 ORDER BY created_at,id',[org,runId])).map(row => RuntimeActivityRecordSchema.parse(json(row)));
      const events = (await tx.query('SELECT payload FROM runtime_activity_events WHERE org_id=$1 AND run_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 500',[org,runId,afterSequence])).map(row => RuntimeActivityEventSchema.parse(json(row)));
      // Cursor only acknowledges events actually included; reconnect never skips a page.
      return {records,events,last_sequence:events.at(-1)?.sequence ?? afterSequence};
    });
  }

  saveMemory(user: string, org: string, value: MemoryInput): Promise<MemoryEntry> {
    const input = MemoryInputSchema.parse(value);
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org,true);
      if (input.conversation_id && !(await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2',[org,input.conversation_id]))[0]) fail('CONVERSATION_NOT_FOUND',404);
      if (input.run_id) {
        const run = await readRun(tx,org,input.run_id);
        if (input.conversation_id && run.request.conversation_id !== input.conversation_id) fail('MEMORY_SCOPE_MISMATCH',422);
      }
      for (const id of input.artifact_refs) await resolveContextReference(tx,org,{type:'artifact',id});
      const scope = input.layer === 'working' ? input.run_id! : input.layer === 'episodic' ? input.conversation_id! : 'workspace';
      const expires = input.expires_at ?? (input.layer === 'working' ? new Date(Date.now()+86400000).toISOString() : null);
      const rows = await tx.query(`INSERT INTO agent_memory(org_id,id,layer,conversation_id,run_id,scope_key,memory_key,summary,artifact_refs,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        ON CONFLICT(org_id,layer,scope_key,memory_key) DO UPDATE SET summary=excluded.summary,artifact_refs=excluded.artifact_refs,expires_at=excluded.expires_at,updated_at=now() RETURNING *`,
        [org,randomUUID(),input.layer,input.conversation_id ?? null,input.run_id ?? null,scope,input.key,input.summary,JSON.stringify(input.artifact_refs),expires]);
      return memoryFromRow(rows[0]);
    });
  }

  listMemory(user: string, org: string, options: MemoryQuery = {}): Promise<MemoryEntry[]> {
    const limit = Math.max(1, Math.min(50, options.limit ?? 12));
    const query = (options.query ?? '').trim().slice(0,500);
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org);
      if (options.conversation_id && !(await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2',[org,options.conversation_id]))[0]) fail('CONVERSATION_NOT_FOUND',404);
      if (options.run_id) {
        const run = await readRun(tx,org,options.run_id);
        if (options.conversation_id && run.request.conversation_id !== options.conversation_id) fail('MEMORY_SCOPE_MISMATCH',422);
      }
      const rows = await tx.query(`WITH candidates AS (
        SELECT *, CASE WHEN $4='' THEN 0 ELSE ts_rank(to_tsvector('simple',summary),plainto_tsquery('simple',$4)) END AS relevance
        FROM agent_memory WHERE org_id=$1 AND (expires_at IS NULL OR expires_at>now()) AND
        (layer='workspace' OR (layer='episodic' AND conversation_id=$2) OR (layer='working' AND run_id=$3))
        AND ($4='' OR to_tsvector('simple',summary) @@ plainto_tsquery('simple',$4))
      ), ranked AS (
        SELECT *,row_number() OVER (PARTITION BY layer ORDER BY relevance DESC,updated_at DESC,id) AS layer_rank FROM candidates
      ) SELECT * FROM ranked WHERE layer_rank<=8
        ORDER BY layer_rank,relevance DESC,updated_at DESC,id LIMIT $5`,[org,options.conversation_id ?? null,options.run_id ?? null,query,limit]);
      return rows.map(memoryFromRow);
    });
  }
}

function memoryFromRow(row: Row): MemoryEntry {
  return { ...MemoryInputSchema.parse({layer:row.layer,conversation_id:row.conversation_id,run_id:row.run_id,key:row.memory_key,summary:row.summary,artifact_refs:decode(row.artifact_refs),expires_at:row.expires_at ? asTimestamp(row.expires_at) : null}),memory_id:String(row.id),org_id:String(row.org_id),created_at:asTimestamp(row.created_at),updated_at:asTimestamp(row.updated_at) };
}

/** Allocate immutable versions under the thread lock, so concurrent updates cannot reuse a version. */
export async function versionPublishedReport(tx: Driver, run: AnalysisRun, record: ReportRecord): Promise<ReportRecord> {
  const conversationId = run.request.conversation_id;
  let parent: string | null = null;
  let context = ThreadContextSchema.parse({});
  if (conversationId) {
    const threads = await tx.query('SELECT context FROM conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',[run.org_id,conversationId]);
    if (!threads[0]) fail('CONVERSATION_NOT_FOUND',404);
    context = ThreadContextSchema.parse(decode(threads[0].context));
    const messages = await tx.query("SELECT payload FROM messages WHERE org_id=$1 AND conversation_id=$2 AND run_id=$3 AND role='user' ORDER BY created_at LIMIT 1",[run.org_id,conversationId,run.run_id]);
    const message = messages[0] ? json(messages[0]) as Record<string,unknown> : {};
    const refs = Array.isArray(message.context_refs) ? message.context_refs as MessageContextRef[] : [];
    const explicitReports = refs.filter(ref => ref.type === 'report');
    const turn = message.agent_turn as { request?: {workspace_context?:{active_report_ref?:{report_id?:string}}} } | undefined;
    const updating = resolveReportIntent({text:run.request.question,report_intent:message.report_intent}) === 'update';
    if (updating) {
      if (explicitReports.length > 1) fail('REPORT_CONTEXT_AMBIGUOUS',422);
      const captured = message.thread_context_snapshot ? ThreadContextSchema.parse(decode(message.thread_context_snapshot)) : context;
      let replyReport: string | null = null;
      if (typeof message.reply_to_message_id === 'string') {
        const replies = await tx.query('SELECT payload FROM messages WHERE org_id=$1 AND conversation_id=$2 AND id=$3',[run.org_id,conversationId,message.reply_to_message_id]);
        const reply = replies[0] ? json(replies[0]) as {parts?: Array<{type:string;report_id?:string}>} : {};
        const reports = reply.parts?.filter(part=>part.type==='report_ref' && part.report_id) ?? [];
        if (!explicitReports.length && !turn?.request?.workspace_context?.active_report_ref?.report_id && reports.length>1) fail('REPORT_CONTEXT_AMBIGUOUS',422);
        replyReport = reports[0]?.report_id ?? null;
      }
      parent = explicitReports[0]?.id ?? turn?.request?.workspace_context?.active_report_ref?.report_id ?? replyReport ?? captured.active_report_id;
      if (!parent) fail('REPORT_CONTEXT_REQUIRED',422);
    }
  }
  let lineage = record.report_id;
  let version = 1;
  if (parent) {
    const parents = await tx.query('SELECT id FROM reports WHERE org_id=$1 AND id=$2 FOR UPDATE',[run.org_id,parent]);
    if (!parents[0]) fail('REPORT_NOT_FOUND',404);
    // Historical reports are adopted as v1 without modifying their payload/hash.
    await tx.query('INSERT INTO report_versions(org_id,report_id,lineage_id,version,conversation_id) VALUES($1,$2,$2,1,$3) ON CONFLICT(org_id,report_id) DO NOTHING',[run.org_id,parent,conversationId]);
    const roots = await tx.query('SELECT lineage_id FROM report_versions WHERE org_id=$1 AND report_id=$2',[run.org_id,parent]);
    lineage = String(roots[0].lineage_id);
    // Lock the lineage root as well when updates originate in different threads.
    await tx.query('SELECT id FROM reports WHERE org_id=$1 AND id=$2 FOR UPDATE',[run.org_id,lineage]);
    const latest = await tx.query('SELECT version FROM report_versions WHERE org_id=$1 AND lineage_id=$2 ORDER BY version DESC LIMIT 1',[run.org_id,lineage]);
    version = Number(latest[0].version)+1;
  }
  await tx.query('INSERT INTO report_versions(org_id,report_id,lineage_id,version,parent_report_id,conversation_id) VALUES($1,$2,$3,$4,$5,$6)',[run.org_id,record.report_id,lineage,version,parent,conversationId]);
  if (conversationId) await tx.query('UPDATE conversations SET context=$3::jsonb,updated_at=now() WHERE org_id=$1 AND id=$2',[run.org_id,conversationId,JSON.stringify({...context,current_run_id:run.run_id,active_report_id:record.report_id,active_artifact_id:record.artifact_id})]);
  if (conversationId) await tx.query(`INSERT INTO agent_memory(org_id,id,layer,conversation_id,run_id,scope_key,memory_key,summary,artifact_refs)
    VALUES($1,$2,'episodic',$3,$4,$3,$4,$5,$6::jsonb) ON CONFLICT(org_id,layer,scope_key,memory_key) DO NOTHING`,
    [run.org_id,randomUUID(),conversationId,run.run_id,`Completed analysis: ${run.request.question.slice(0,2000)}. Published report version ${version}.`,JSON.stringify([record.artifact_id])]);
  return {...record,conversation_id:conversationId,lineage_id:lineage,version,parent_report_id:parent};
}

export function enrichReport(row: Row): ReportRecord {
  const report = json(row) as ReportRecord;
  return {...report,lineage_id:row.lineage_id ? String(row.lineage_id) : report.report_id,version:Number(row.version ?? 1),parent_report_id:row.parent_report_id ? String(row.parent_report_id) : null,conversation_id:row.conversation_id ? String(row.conversation_id) : null};
}
