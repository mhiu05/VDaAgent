import { createHash, randomUUID } from 'node:crypto';
import {
  AgentExecutionEventDataSchema, AgentExecutionEventSchema, AgentInvocationSchema,
  AgentTurnJobSchema, canTransitionAgentExecution,
  MessageSchema,
  AgentTurnRequestSchema, isApprovedDurableAnalysisTurn,
  ArtifactSchema, ArtifactValidationSchema, RunTaskSchema,
  ReportRecordSchema,
  AGENT_V1_PERSONA_STAGES,
  RunStatusSchema,
  resolveReportIntent,
  type AgentExecutionEvent, type AgentExecutionStatus, type AgentInvocation,
  type AgentTurnJob, type AgentTurnRequest, type AnalysisRequest, type AnalysisRun,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver, Row } from '../driver';
import { fail } from '../errors';
import { asTimestamp } from '../mapping/conversation';
import { json } from '../mapping/rows';
import { verifyArtifact } from '@vda/domain';
import { readRun } from './run-repository';
import { ConversationRepository } from './conversation-repository';
import { syncAgentInvocationsFromRun } from '../workflow/agent-projection';
import { validateMessageContext } from '../authorization/context-references';
import { specialistPlan } from '../workflow/specialist-plan';
import { verifiedSpecialistResult, specialistResultParts } from '../transactions/finish-agent-artifact-run';
import type { AgentJobLease, AgentTurn, TurnContext, AgentTurnExecution, AgentTurnExecutionResult } from '../types';
const maxAttempts = 3;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type RunBuilder = (tx: Driver, user: string, request: AnalysisRequest, key: string, turn: TurnContext) => Promise<AnalysisRun>;
const iso = (value: unknown) => value == null ? null : asTimestamp(value);
function job(row: Row): AgentTurnJob {
  return AgentTurnJobSchema.parse({
    job_id: row.id, org_id: row.org_id, conversation_id: row.conversation_id,
    user_message_id: row.user_message_id, assistant_message_id: row.assistant_message_id,
    created_by: row.created_by, status: row.status, run_id: row.run_id,
    attempt: Number(row.attempt), fencing_token: Number(row.fencing_token),
    worker_id: row.worker_id, lease_until: iso(row.lease_until), error_code: row.error_code,
    created_at: asTimestamp(row.created_at), updated_at: asTimestamp(row.updated_at),
  });
}
function invocation(row: Row): AgentInvocation {
  return AgentInvocationSchema.parse({
    invocation_id: row.id, org_id: row.org_id, job_id: row.job_id,
    parent_invocation_id: row.parent_id, step_key: row.step_key, agent_key: row.agent_key,
    depth: Number(row.depth), status: row.status, run_id: row.run_id,
    analysis_stage_id: row.analysis_stage_id, created_at: asTimestamp(row.created_at),
    updated_at: asTimestamp(row.updated_at),
  });
}
function event(row: Row): AgentExecutionEvent {
  return AgentExecutionEventSchema.parse({
    event_id: row.id, org_id: row.org_id, job_id: row.job_id,
    invocation_id: row.invocation_id, sequence: Number(row.sequence),
    type: row.type, data: row.data, created_at: asTimestamp(row.created_at),
  });
}
async function appendEvent(
  tx: Driver, current: AgentTurnJob, type: AgentExecutionEvent['type'],
  data: AgentExecutionEvent['data'] = {}, invocationId: string | null = null,
) {
  const safe = AgentExecutionEventDataSchema.parse(data);
  const sequence = await tx.query(
    'UPDATE agent_turn_jobs SET event_sequence=event_sequence+1 WHERE org_id=$1 AND id=$2 RETURNING event_sequence',
    [current.org_id, current.job_id],
  );
  await tx.query(
    'INSERT INTO agent_execution_events(org_id,id,job_id,invocation_id,sequence,type,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [current.org_id, randomUUID(), current.job_id, invocationId, sequence[0].event_sequence, type, JSON.stringify(safe)],
  );
}
async function terminalMessages(tx: Driver, current: AgentTurnJob, status: 'failed' | 'cancelled', code: string) {
  const conversation = new ConversationRepository(tx);
  const assistant = await conversation.message(tx, current.org_id, current.assistant_message_id, true);
  if (assistant.status === 'in_progress') {
    const linkedRun = current.run_id
      ? (await tx.query('SELECT status FROM runs WHERE org_id=$1 AND id=$2', [current.org_id,current.run_id]))[0]
      : undefined;
    const linkedStatus = RunStatusSchema.safeParse(linkedRun?.status);
    assistant.status = status;
    assistant.content = status === 'cancelled' ? 'Yêu cầu đã được hủy.' : 'Không thể hoàn tất yêu cầu.';
    assistant.parts = [
      { type: 'text', text: assistant.content },
      ...(current.run_id && linkedStatus.success
        ? [{type:'run_ref' as const,run_id:current.run_id,status:linkedStatus.data}]
        : []),
      { type: 'error', code, retryable: false },
    ];
    assistant.updated_at = new Date().toISOString();
    await conversation.updateMessage(tx, assistant);
  }
  const userMessage = await conversation.message(tx, current.org_id, current.user_message_id, true);
  if (userMessage.status === 'submitted') {
    userMessage.status = 'completed';
    userMessage.updated_at = new Date().toISOString();
    await conversation.updateMessage(tx, userMessage);
  }
  await conversation.touchConversation(tx, current.org_id, current.conversation_id);
}
async function lockedJob(tx: Driver, org: string, id: string) {
  const rows = await tx.query('SELECT * FROM agent_turn_jobs WHERE org_id=$1 AND id=$2 FOR UPDATE', [org,id]);
  if (!rows[0]) fail('AGENT_JOB_NOT_FOUND', 404);
  return job(rows[0]);
}
async function fencedJob(tx: Driver, lease: AgentJobLease) {
  const current = await lockedJob(tx, lease.job.org_id, lease.job.job_id);
  await authorizeInTransaction(tx, current.created_by, current.org_id, true);
  if (current.status !== 'running' || current.worker_id !== lease.worker_id ||
      current.fencing_token !== lease.fencing_token || !current.lease_until ||
      current.lease_until <= new Date().toISOString()) fail('LEASE_LOST', 409);
  return current;
}
export class AgentExecutionRepository {
  constructor(private readonly db: Driver, private readonly buildAnalysisRun: RunBuilder) {}

  private async executionInput(tx: Driver, current: AgentTurnJob): Promise<AgentTurnExecution> {
    const messages = await tx.query('SELECT conversation_id,client_turn_id,role,payload FROM messages WHERE org_id=$1 AND id=$2 FOR UPDATE',[current.org_id,current.user_message_id]);
    const row = messages[0];
    if (!row || row.role !== 'user' || row.conversation_id !== current.conversation_id) fail('TURN_MISMATCH',409);
    const metadata = (json(row) as Record<string,unknown>).agent_turn as Record<string,unknown> | undefined;
    const parsed = AgentTurnRequestSchema.safeParse(metadata?.request);
    if (!parsed.success || metadata?.actor_id !== current.created_by ||
        metadata?.request_hash !== hash(JSON.stringify(parsed.data)) ||
        typeof metadata?.idempotency_key !== 'string' || !metadata.idempotency_key ||
        parsed.data.org_id !== current.org_id || parsed.data.client_turn_id !== row.client_turn_id)
      fail('UNSUPPORTED_DURABLE_REQUEST',422);
    await validateMessageContext(tx,current.org_id,current.conversation_id,parsed.data.context_refs,parsed.data.reply_to_message_id);
    return {input:parsed.data,idempotency_key:metadata.idempotency_key,context:{org_id:current.org_id,conversation_id:current.conversation_id,user_message_id:current.user_message_id,assistant_message_id:current.assistant_message_id,client_turn_id:parsed.data.client_turn_id}};
  }

  getExecution(lease: AgentJobLease): Promise<AgentTurnExecution> {
    return this.db.transaction(async tx => this.executionInput(tx,await fencedJob(tx,lease)));
  }

  async finalizeExecution(lease: AgentJobLease, result: AgentTurnExecutionResult): Promise<void> {
    await this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      if (current.run_id) fail('RUN_FINALIZATION_REQUIRED',409);
      const pending = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND parent_id IS NOT NULL AND status IN ('queued','running','waiting') LIMIT 1",[current.org_id,current.job_id]);
      if (result.status === 'completed' && pending[0]) fail('INVOCATIONS_PENDING',409);
      const conversation = new ConversationRepository(tx);
      const prior = await conversation.message(tx,current.org_id,current.assistant_message_id,true);
      if (prior.status !== 'in_progress') fail('TURN_TERMINAL',409);
      const assistant = MessageSchema.parse({...prior,...result,updated_at:new Date().toISOString()});
      await conversation.updateMessage(tx,assistant);
      const userMessage = await conversation.message(tx,current.org_id,current.user_message_id,true);
      if (userMessage.status === 'submitted') await conversation.updateMessage(tx,{...userMessage,status:'completed',updated_at:assistant.updated_at});
      const error = assistant.parts.find(part=>part.type === 'error');
      const code = error?.type === 'error' ? error.code : null;
      await tx.query('UPDATE agent_turn_jobs SET status=$3,error_code=$4,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2',[current.org_id,current.job_id,result.status,code]);
      const active = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting') ORDER BY depth DESC",[current.org_id,current.job_id]);
      await tx.query("UPDATE agent_invocations SET status=$3,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",[current.org_id,current.job_id,result.status]);
      const type = result.status === 'completed' ? 'invocation_completed' : result.status === 'failed' ? 'invocation_failed' : 'invocation_cancelled';
      for (const row of active) await appendEvent(tx,current,type,code ? {error_code:code} : {},String(row.id));
      await appendEvent(tx,current,result.status === 'completed' ? 'turn_completed' : result.status === 'failed' ? 'turn_failed' : 'turn_cancelled',code ? {error_code:code} : {});
      await conversation.touchConversation(tx,current.org_id,current.conversation_id,assistant.updated_at);
    });
  }

  async enqueue(user: string, input: AgentTurnRequest, key: string, conversationId?: string): Promise<AgentTurn & { job: AgentTurnJob }> {
    let created: AgentTurnJob | undefined;
    const turn = await new ConversationRepository(this.db).startTurn(user,input,key,conversationId,async (tx, accepted) => {
      const org = accepted.conversation.org_id;
      const prior = await tx.query('SELECT * FROM agent_turn_jobs WHERE org_id=$1 AND user_message_id=$2', [org,accepted.user_message.message_id]);
      if (prior[0]) { created = job(prior[0]); return; }
      if (accepted.idempotent_replay) fail('TURN_NOT_DURABLE',409);
      if (accepted.assistant_message.status !== 'in_progress') fail('TURN_TERMINAL', 409);
      const id = randomUUID();
      const root = randomUUID();
      const rows = await tx.query(
        `INSERT INTO agent_turn_jobs(org_id,id,conversation_id,user_message_id,assistant_message_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [org,id,accepted.conversation.conversation_id,accepted.user_message.message_id,accepted.assistant_message.message_id,user],
      );
      created = job(rows[0]);
      await tx.query(
        `INSERT INTO agent_invocations(org_id,id,job_id,step_key,agent_key,depth) VALUES($1,$2,$3,'root','orchestrator',0)`,
        [org,root,id],
      );
      await appendEvent(tx,created,'turn_queued',{},root);
    });
    return { ...turn, job: created! };
  }

  async get(user: string, org: string, id: string, after = 0) {
    if (!Number.isInteger(after) || after < 0) fail('INVALID_EVENT_CURSOR', 422);
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org);
      const jobRows = await tx.query('SELECT * FROM agent_turn_jobs WHERE org_id=$1 AND id=$2',[org,id]);
      if (!jobRows[0]) fail('AGENT_JOB_NOT_FOUND',404);
      const current = job(jobRows[0]);
      const invocations = (await tx.query('SELECT * FROM agent_invocations WHERE org_id=$1 AND job_id=$2 ORDER BY created_at,id LIMIT 100', [org,id])).map(invocation);
      const events = (await tx.query('SELECT * FROM agent_execution_events WHERE org_id=$1 AND job_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 100', [org,id,after])).map(event);
      return { job: current, invocations, events };
    });
  }

  async getForUserMessage(user: string, org: string, userMessageId: string): Promise<AgentTurnJob | null> {
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org);
      const rows = await tx.query(
        'SELECT * FROM agent_turn_jobs WHERE org_id=$1 AND user_message_id=$2',
        [org,userMessageId],
      );
      return rows[0] ? job(rows[0]) : null;
    });
  }

  async getLatestForConversation(user: string, org: string, conversationId: string) {
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org);
      const rows = await tx.query(
        'SELECT id FROM agent_turn_jobs WHERE org_id=$1 AND conversation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
        [org,conversationId],
      );
      if (!rows[0]) return null;
      const id = String(rows[0].id);
      const jobRows = await tx.query('SELECT * FROM agent_turn_jobs WHERE org_id=$1 AND id=$2',[org,id]);
      const current = job(jobRows[0]);
      const invocations = (await tx.query('SELECT * FROM agent_invocations WHERE org_id=$1 AND job_id=$2 ORDER BY depth,created_at,id LIMIT 100',[org,id])).map(invocation);
      const events = (await tx.query('SELECT * FROM agent_execution_events WHERE org_id=$1 AND job_id=$2 ORDER BY sequence DESC LIMIT 100',[org,id])).reverse().map(event);
      return { job:current, invocations, events };
    });
  }

  async claim(worker: string, date = new Date(), leaseMs = 30000): Promise<AgentJobLease | null> {
    if (!worker || worker.length > 160 || leaseMs < 1000 || leaseMs > 120000) fail('INVALID_LEASE', 422);
    return this.db.transaction(async tx => {
      const ready = await tx.query(
        `SELECT j.* FROM agent_turn_jobs j JOIN runs r ON r.org_id=j.org_id AND r.id=j.run_id
         WHERE j.status='waiting' AND r.status IN ('succeeded','failed','cancelled')
         ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      );
      if (ready[0]) {
        const waiting = job(ready[0]);
        await tx.query("UPDATE agent_turn_jobs SET status='queued',updated_at=now() WHERE org_id=$1 AND id=$2",[waiting.org_id,waiting.job_id]);
        await tx.query("UPDATE agent_invocations SET status='queued',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root'",[waiting.org_id,waiting.job_id]);
        await appendEvent(tx,waiting,'turn_queued',{run_id:waiting.run_id!});
      }
      const rows = await tx.query(
        `SELECT * FROM agent_turn_jobs WHERE status='queued' OR (status='running' AND lease_until<$1)
         ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [date.toISOString()],
      );
      if (!rows[0]) return null;
      const current = job(rows[0]);
      let error: string | null = current.attempt >= maxAttempts ? 'MAX_ATTEMPTS' : null;
      if (!error) try { await authorizeInTransaction(tx,current.created_by,current.org_id,true); }
        catch { error = 'MEMBERSHIP_REVOKED'; }
      if (error) {
        await tx.query("UPDATE agent_turn_jobs SET status='failed',worker_id=NULL,lease_until=NULL,error_code=$3,updated_at=$4,fencing_token=fencing_token+1 WHERE org_id=$1 AND id=$2",[current.org_id,current.job_id,error,date.toISOString()]);
        await tx.query("UPDATE agent_invocations SET status='failed',updated_at=$3 WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",[current.org_id,current.job_id,date.toISOString()]);
        await appendEvent(tx,current,'turn_failed',{error_code:error});
        await terminalMessages(tx,current,'failed',error);
        return null;
      }
      const updated = await tx.query(
        `UPDATE agent_turn_jobs SET status='running',attempt=attempt+1,fencing_token=fencing_token+1,
         worker_id=$3,lease_until=$4,updated_at=$5 WHERE org_id=$1 AND id=$2 RETURNING *`,
        [current.org_id,current.job_id,worker,new Date(date.getTime()+leaseMs).toISOString(),date.toISOString()],
      );
      const claimed = job(updated[0]);
      await tx.query("UPDATE agent_invocations SET status='running',updated_at=$3 WHERE org_id=$1 AND job_id=$2 AND step_key='root'",[current.org_id,current.job_id,date.toISOString()]);
      await appendEvent(tx,claimed,'turn_claimed');
      const roots = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key='root'",[current.org_id,current.job_id]);
      if (!roots[0]) fail('INVOCATION_ROOT_MISSING',409);
      await appendEvent(tx,claimed,'invocation_started',{},String(roots[0].id));
      return {job:claimed,worker_id:worker,fencing_token:claimed.fencing_token};
    });
  }

  async renew(lease: AgentJobLease, ms = 30000) {
    if (ms < 1000 || ms > 120000) fail('INVALID_LEASE',422);
    await this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      await tx.query('UPDATE agent_turn_jobs SET lease_until=$3,updated_at=$4 WHERE org_id=$1 AND id=$2',
        [current.org_id,current.job_id,new Date(Date.now()+ms).toISOString(),new Date().toISOString()]);
    });
  }

  /** Run insertion, turn attachment, invocation link, and lease release commit together. */
  async startAnalysis(lease: AgentJobLease, options: {planned?:boolean} = {}): Promise<AnalysisRun> {
    return this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      if (current.run_id) fail('RUN_ALREADY_LINKED',409);
      const {input} = await this.executionInput(tx,current);
      if (!options.planned && !isApprovedDurableAnalysisTurn(input)) fail('UNSUPPORTED_DURABLE_REQUEST',422);
      const request: AnalysisRequest = {
        org_id: current.org_id, scope: input.scope, data_as_of: input.data_as_of,
        question: input.text, conversation_id: current.conversation_id,
        use_case: input.use_case, agent_target: resolveReportIntent(input) ? 'report' : input.agent_target ?? null,
      };
      const run = await this.buildAnalysisRun(
        tx,current.created_by,request,`agent-turn:${current.job_id}:analysis-v1`,{
          org_id:current.org_id,conversation_id:current.conversation_id,
          user_message_id:current.user_message_id,assistant_message_id:current.assistant_message_id,
          client_turn_id:input.client_turn_id,
        },
      );
      if (run.workflow_version !== 'agent-v1' || run.org_id !== current.org_id ||
          run.created_by !== current.created_by || run.request.conversation_id !== current.conversation_id)
        fail('DURABLE_RUN_MISMATCH',409);
      const roots = await tx.query(
        "SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key='root'",
        [current.org_id,current.job_id],
      );
      if (!roots[0]) fail('INVOCATION_ROOT_MISSING',409);
      const rootId = String(roots[0].id);
      const personaInvocations: Array<{ id: string; key: string }> = [];
      const personaKeys = specialistPlan(run.request.agent_target)?.personas ?? ['data','compare','insight','report'] as const;
      for (const key of personaKeys) {
        const id = randomUUID();
        await tx.query(
          `INSERT INTO agent_invocations(org_id,id,job_id,parent_id,step_key,agent_key,depth,status,run_id)
           VALUES($1,$2,$3,$4,$5,$5,1,'queued',$6)`,
          [current.org_id,id,current.job_id,rootId,key,run.run_id],
        );
        personaInvocations.push({id,key});
      }
      await tx.query(
        "UPDATE agent_turn_jobs SET status='waiting',run_id=$3,attempt=0,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",
        [current.org_id,current.job_id,run.run_id],
      );
      await tx.query(
        "UPDATE agent_invocations SET status='waiting',run_id=$3,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root'",
        [current.org_id,current.job_id,run.run_id],
      );
      for (const child of personaInvocations) await appendEvent(tx,current,'invocation_queued',{},child.id);
      await appendEvent(tx,current,'run_linked',{run_id:run.run_id},rootId);
      await appendEvent(tx,current,'invocation_waiting',{run_id:run.run_id},rootId);
      await appendEvent(tx,current,'turn_waiting',{run_id:run.run_id});
      return run;
    });
  }

  /** Resolve the terminal run and finalize the initiating reply under one job fence. */
  async resumeAnalysis(lease: AgentJobLease) {
    return this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      if (!current.run_id) fail('RUN_NOT_LINKED',409);
      const run = await readRun(tx,current.org_id,current.run_id);
      if (run.workflow_version !== 'agent-v1' || run.created_by !== current.created_by ||
          run.request.conversation_id !== current.conversation_id ||
          run.idempotency_key !== `agent-turn:${current.job_id}:analysis-v1`)
        fail('DURABLE_RUN_MISMATCH',409);
      if (run.status === 'failed' || run.status === 'cancelled') {
        const cancelled = run.status === 'cancelled';
        const status: 'cancelled' | 'failed' = cancelled ? 'cancelled' : 'failed';
        const code = cancelled ? 'RUN_CANCELLED' : 'RUN_FAILED';
        await tx.query(
          'UPDATE agent_turn_jobs SET status=$3,worker_id=NULL,lease_until=NULL,error_code=$4,updated_at=now() WHERE org_id=$1 AND id=$2',
          [current.org_id,current.job_id,status,code],
        );
        await tx.query(
          "UPDATE agent_invocations SET status=$3,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",
          [current.org_id,current.job_id,status],
        );
        const terminated = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key IN ('root','data') ORDER BY depth DESC",
          [current.org_id,current.job_id]);
        for (const row of terminated) await appendEvent(tx,current,cancelled ? 'invocation_cancelled' : 'invocation_failed',
          {run_id:run.run_id,error_code:code},String(row.id));
        await appendEvent(tx,current,cancelled ? 'turn_cancelled' : 'turn_failed',{run_id:run.run_id,error_code:code});
        await terminalMessages(tx,current,status,code);
        return {status,run_id:run.run_id,artifact_id:null};
      }
      if (run.status !== 'succeeded') fail('RUN_NOT_TERMINAL',409);
      if (specialistPlan(run.request.agent_target) && run.report_artifact_id === null) {
        const artifact = await verifiedSpecialistResult(tx,run);
        const conversation = new ConversationRepository(tx);
        const assistant = await conversation.message(tx,current.org_id,current.assistant_message_id,true);
        if (assistant.status !== 'in_progress' || assistant.run_id !== run.run_id) fail('TURN_TERMINAL',409);
        // The specialist's canonical stage message already owns its per-run sender slot.
        Object.assign(assistant,{status:'completed',...specialistResultParts(run,artifact),updated_at:new Date().toISOString()});
        await conversation.updateMessage(tx,assistant);
        const userMessage = await conversation.message(tx,current.org_id,current.user_message_id,true);
        if (userMessage.status==='submitted') await conversation.updateMessage(tx,{...userMessage,status:'completed',updated_at:assistant.updated_at});
        await syncAgentInvocationsFromRun(tx,current.org_id,run.run_id);
        const pending = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND parent_id IS NOT NULL AND status<>'completed'",[current.org_id,current.job_id]);
        if (pending.length) fail('SPECIALIST_INVOCATIONS_INCOMPLETE',409);
        const roots = await tx.query("UPDATE agent_invocations SET status='completed',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root' RETURNING id",[current.org_id,current.job_id]);
        if (!roots[0]) fail('INVOCATION_ROOT_MISSING',409);
        await tx.query("UPDATE agent_turn_jobs SET status='completed',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",[current.org_id,current.job_id]);
        await appendEvent(tx,current,'invocation_completed',{run_id:run.run_id,artifact_id:artifact.artifact_id},String(roots[0].id));
        await appendEvent(tx,current,'turn_completed',{run_id:run.run_id,artifact_id:artifact.artifact_id});
        await conversation.touchConversation(tx,current.org_id,current.conversation_id,assistant.updated_at);
        return {status:'completed' as const,run_id:run.run_id,artifact_id:artifact.artifact_id};
      }

      const artifactRows = await tx.query(
        "SELECT artifact_key,payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND artifact_key IN ('data_analysis_pack','data.query_result')",
        [current.org_id,run.run_id],
      );
      const byKey = new Map(artifactRows.map(row => [String(row.artifact_key),row]));
      const packRow = byKey.get('data_analysis_pack');
      const resultRow = byKey.get('data.query_result');
      if (!packRow || !resultRow) fail('DATA_ARTIFACT_MISSING',409);
      const packParsed = ArtifactSchema.safeParse(json(packRow));
      const resultParsed = ArtifactSchema.safeParse(json(resultRow));
      if (!packParsed.success || !resultParsed.success || packParsed.data.kind !== 'data_analysis_pack' ||
          resultParsed.data.kind !== 'query_result') fail('DATA_ARTIFACT_INVALID',409);
      const pack = packParsed.data;
      const result = resultParsed.data;
      try { verifyArtifact(pack); verifyArtifact(result); }
      catch { fail('DATA_ARTIFACT_INVALID',409); }
      if (pack.org_id !== current.org_id || pack.run_id !== run.run_id ||
          result.org_id !== current.org_id || result.run_id !== run.run_id ||
          pack.payload.dataset.query_result_artifact_id !== result.artifact_id ||
          !pack.input_refs.includes(result.artifact_id) ||
          pack.payload.dataset.row_count !== result.payload.row_count)
        fail('DATA_ARTIFACT_LINEAGE_MISMATCH',409);
      const validations = (await tx.query(
        'SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND id IN ($3,$4)',
        [current.org_id,run.run_id,pack.artifact_id,result.artifact_id],
      )).flatMap(row => {
        const parsed = ArtifactValidationSchema.safeParse(json(row));
        return parsed.success ? [parsed.data] : [];
      });
      if (![pack.artifact_id,result.artifact_id].every(id => validations.some(v =>
        v.valid && v.artifact_id === id && v.org_id === current.org_id && v.run_id === run.run_id)))
        fail('DATA_ARTIFACT_VALIDATION_REQUIRED',409);
      const tasks = await tx.query('SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2 AND id=$3',
        [current.org_id,run.run_id,pack.task_id]);
      const task = RunTaskSchema.safeParse(json(tasks[0] ?? {}));
      if (!task.success || task.data.kind !== 'data' || task.data.status !== 'succeeded' ||
          task.data.task_id !== result.task_id || task.data.run_id !== run.run_id)
        fail('DATA_STAGE_NOT_SUCCEEDED',409);
      const childRows = await tx.query(
        "SELECT id,status,run_id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key='data' FOR UPDATE",
        [current.org_id,current.job_id],
      );
      const child = childRows[0];
      if (!child || child.run_id !== run.run_id || !['waiting','completed'].includes(String(child.status)))
        fail('DATA_INVOCATION_MISMATCH',409);
      const requiredStages = new Set(['coordinator',...Object.values(AGENT_V1_PERSONA_STAGES).flat()]);
      const stageRows = await tx.query('SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2',
        [current.org_id,run.run_id]);
      const stageStatus = new Map<string,string>(stageRows.map(row => {
        const stage = RunTaskSchema.parse(json(row));
        return [stage.kind,stage.status] as const;
      }));
      if ([...requiredStages].some(kind => stageStatus.get(kind) !== 'succeeded'))
        fail('AGENT_STAGES_INCOMPLETE',409);
      if (!run.report_artifact_id) fail('PUBLISHED_REPORT_REQUIRED',409);
      const published = await tx.query(
        'SELECT payload FROM reports WHERE org_id=$1 AND run_id=$2 AND artifact_id=$3',
        [current.org_id,run.run_id,run.report_artifact_id],
      );
      const report = published[0] ? ReportRecordSchema.safeParse(json(published[0])) : null;
      if (!report?.success || report.data.org_id !== current.org_id ||
          report.data.run_id !== run.run_id || report.data.artifact_id !== run.report_artifact_id)
        fail('PUBLISHED_REPORT_REQUIRED',409);
      await syncAgentInvocationsFromRun(tx,current.org_id,run.run_id);
      const personas = await tx.query(
        "SELECT step_key,status FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key IN ('data','compare','insight','report')",
        [current.org_id,current.job_id],
      );
      if (personas.length !== 4 || personas.some(persona => persona.status !== 'completed'))
        fail('PERSONA_STAGES_INCOMPLETE',409);
      const content = `Đã hoàn tất phân tích tồn kho cho ${pack.payload.dataset.row_count} bản ghi. Kết quả dữ liệu đã được xác thực và liên kết với lượt phân tích.`;
      const conversation = new ConversationRepository(tx);
      const assistant = await conversation.message(tx,current.org_id,current.assistant_message_id,true);
      if (assistant.status !== 'in_progress' || assistant.run_id !== run.run_id)
        fail('TURN_TERMINAL',409);
      assistant.status = 'completed';
      assistant.content = content;
      assistant.parts = [
        {type:'text',text:content},
        {type:'run_ref',run_id:run.run_id,status:'succeeded'},
        {type:'artifact_ref',run_id:run.run_id,artifact_id:pack.artifact_id,kind:'data_analysis_pack'},
      ];
      assistant.content = `${content} Báo cáo đã được xuất bản.`;
      assistant.parts[0] = {type:'text',text:assistant.content};
      assistant.parts.push({type:'report_ref',run_id:run.run_id,report_id:report.data.report_id});
      assistant.updated_at = new Date().toISOString();
      await conversation.updateMessage(tx,assistant);
      const userMessage = await conversation.message(tx,current.org_id,current.user_message_id,true);
      if (userMessage.status === 'submitted') {
        userMessage.status = 'completed';
        userMessage.updated_at = assistant.updated_at;
        await conversation.updateMessage(tx,userMessage);
      }
      const activeInvocations = await tx.query(
        "SELECT id,step_key,status FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key='root' AND status NOT IN ('completed','failed','cancelled') FOR UPDATE",
        [current.org_id,current.job_id],
      );
      await tx.query("UPDATE agent_invocations SET status='completed',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root' AND status NOT IN ('completed','failed','cancelled')",
        [current.org_id,current.job_id]);
      await tx.query("UPDATE agent_turn_jobs SET status='completed',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",
        [current.org_id,current.job_id]);
      const roots = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key='root'",
        [current.org_id,current.job_id]);
      if (!roots[0]) fail('INVOCATION_ROOT_MISSING',409);
      for (const item of activeInvocations) await appendEvent(tx,current,'invocation_completed',
        {run_id:run.run_id,...(item.step_key === 'data' ? {artifact_id:pack.artifact_id} : item.step_key === 'report' && report?.success ? {artifact_id:report.data.artifact_id} : {})},String(item.id));
      await appendEvent(tx,current,'turn_completed',{run_id:run.run_id,artifact_id:pack.artifact_id});
      await conversation.touchConversation(tx,current.org_id,current.conversation_id,assistant.updated_at);
      return {status:'completed' as const,run_id:run.run_id,artifact_id:pack.artifact_id};
    });
  }

  async fail(lease: AgentJobLease, code: string) {
    const safe = AgentExecutionEventDataSchema.parse({error_code:code});
    await this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      await tx.query("UPDATE agent_turn_jobs SET status='failed',worker_id=NULL,lease_until=NULL,error_code=$3,updated_at=now() WHERE org_id=$1 AND id=$2",[current.org_id,current.job_id,code]);
      await tx.query("UPDATE agent_invocations SET status='failed',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",[current.org_id,current.job_id]);
      await appendEvent(tx,current,'turn_failed',safe);
      await terminalMessages(tx,current,'failed',code);
    });
  }

  async complete(lease: AgentJobLease, content: string) {
    const answer = MessageSchema.shape.content.parse(content.trim());
    if (!answer) fail('EMPTY_AGENT_ANSWER',422);
    return this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      if (current.run_id) fail('RUN_FINALIZATION_REQUIRED',409);
      const pending = await tx.query("SELECT id FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND parent_id IS NOT NULL AND status IN ('queued','running','waiting') LIMIT 1",[current.org_id,current.job_id]);
      if (pending[0]) fail('INVOCATIONS_PENDING',409);
      const conversation = new ConversationRepository(tx);
      const assistant = await conversation.message(tx,current.org_id,current.assistant_message_id,true);
      if (assistant.status !== 'in_progress') fail('TURN_TERMINAL',409);
      assistant.status = 'completed';
      assistant.content = answer;
      assistant.parts = [{type:'text',text:answer}];
      assistant.updated_at = new Date().toISOString();
      await conversation.updateMessage(tx,assistant);
      const userMessage = await conversation.message(tx,current.org_id,current.user_message_id,true);
      if (userMessage.status === 'submitted') {
        userMessage.status = 'completed';
        userMessage.updated_at = assistant.updated_at;
        await conversation.updateMessage(tx,userMessage);
      }
      await tx.query("UPDATE agent_turn_jobs SET status='completed',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",[current.org_id,current.job_id]);
      await tx.query("UPDATE agent_invocations SET status='completed',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root'",[current.org_id,current.job_id]);
      await appendEvent(tx,current,'turn_completed');
      await conversation.touchConversation(tx,current.org_id,current.conversation_id,assistant.updated_at);
      return assistant;
    });
  }

  async waitForRun(lease: AgentJobLease, runId: string) {
    await this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      const run = await tx.query('SELECT id FROM runs WHERE org_id=$1 AND id=$2',[current.org_id,runId]);
      if (!run[0]) fail('RUN_NOT_FOUND',404);
      await tx.query("UPDATE agent_turn_jobs SET status='waiting',run_id=$3,attempt=0,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",[current.org_id,current.job_id,runId]);
      await tx.query("UPDATE agent_invocations SET status='waiting',run_id=$3,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND step_key='root'",[current.org_id,current.job_id,runId]);
      await appendEvent(tx,current,'turn_waiting',{run_id:runId});
    });
  }

  async createInvocation(lease: AgentJobLease, parentId: string, stepKey: string, agentKey: string) {
    AgentInvocationSchema.shape.step_key.parse(stepKey);
    AgentInvocationSchema.shape.agent_key.parse(agentKey);
    return this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      const existing = await tx.query('SELECT * FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND step_key=$3',
        [current.org_id,current.job_id,stepKey]);
      if (existing[0]) {
        const prior = invocation(existing[0]);
        if (prior.parent_invocation_id !== parentId || prior.agent_key !== agentKey) fail('INVOCATION_STEP_CONFLICT',409);
        return prior;
      }
      const parents = await tx.query('SELECT * FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND id=$3',
        [current.org_id,current.job_id,parentId]);
      if (!parents[0]) fail('INVOCATION_PARENT_NOT_FOUND',404);
      const parent = invocation(parents[0]);
      const depth = parent.depth+1;
      if (depth > 16) fail('INVOCATION_DEPTH_LIMIT',422);
      const count = await tx.query('SELECT count(*)::integer AS total FROM agent_invocations WHERE org_id=$1 AND job_id=$2',
        [current.org_id,current.job_id]);
      if (Number(count[0].total) >= 100) fail('INVOCATION_COUNT_LIMIT',422);
      const rows = await tx.query(
        `INSERT INTO agent_invocations(org_id,id,job_id,parent_id,step_key,agent_key,depth)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [current.org_id,randomUUID(),current.job_id,parentId,stepKey,agentKey,depth],
      );
      const child = invocation(rows[0]);
      await appendEvent(tx,current,'invocation_queued',{},child.invocation_id);
      return child;
    });
  }

  async setInvocationStatus(lease: AgentJobLease, id: string, status: AgentExecutionStatus) {
    AgentInvocationSchema.shape.status.parse(status);
    return this.db.transaction(async tx => {
      const current = await fencedJob(tx,lease);
      const rows = await tx.query('SELECT * FROM agent_invocations WHERE org_id=$1 AND job_id=$2 AND id=$3 FOR UPDATE',
        [current.org_id,current.job_id,id]);
      if (!rows[0]) fail('INVOCATION_NOT_FOUND',404);
      const prior = invocation(rows[0]);
      if (prior.status === status) return prior;
      if (!canTransitionAgentExecution(prior.status,status)) fail('INVALID_INVOCATION_TRANSITION',409);
      const updated = await tx.query('UPDATE agent_invocations SET status=$4,updated_at=now() WHERE org_id=$1 AND job_id=$2 AND id=$3 RETURNING *',
        [current.org_id,current.job_id,id,status]);
      const type = {
        running:'invocation_started',waiting:'invocation_waiting',completed:'invocation_completed',
        failed:'invocation_failed',cancelled:'invocation_cancelled',queued:'invocation_queued',
      } as const;
      await appendEvent(tx,current,type[status],{},id);
      return invocation(updated[0]);
    });
  }

  async cancel(user: string, org: string, id: string) {
    return this.db.transaction(async tx => {
      await authorizeInTransaction(tx,user,org,true);
      const current = await lockedJob(tx,org,id);
      if (current.status === 'cancelled') return current;
      if (current.run_id) fail('AGENT_JOB_HAS_RUN', 409);
      if (!canTransitionAgentExecution(current.status,'cancelled')) fail('AGENT_JOB_TERMINAL',409);
      const updated = await tx.query("UPDATE agent_turn_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL,fencing_token=fencing_token+1,error_code='CANCELLED',updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *",[org,id]);
      await tx.query("UPDATE agent_invocations SET status='cancelled',updated_at=now() WHERE org_id=$1 AND job_id=$2 AND status IN ('queued','running','waiting')",[org,id]);
      await appendEvent(tx,current,'turn_cancelled',{error_code:'CANCELLED'});
      await terminalMessages(tx,current,'cancelled','CANCELLED');
      return job(updated[0]);
    });
  }
}
