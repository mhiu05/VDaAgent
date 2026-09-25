import { afterEach, describe, expect, it } from 'vitest';
import { canTransitionAgentExecution, AgentExecutionEventDataSchema, isApprovedDurableAnalysisTurn, aggregatePersonaStageStatus } from '@vda/contracts';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../../tests/helpers/postgres';
import type { Repository } from './types';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
async function setup() {
  const { pg, repo } = await createTestRepository();
  resources.push({repo,close:() => pg.close()});
  return {pg,repo};
}
async function setRunStatus(pg: Awaited<ReturnType<typeof setup>>['pg'], runId: string, status: 'succeeded' | 'failed' | 'cancelled') {
  const rows = await pg.query('SELECT payload FROM runs WHERE org_id=$1 AND id=$2',[TEST_ORGS.alpha,runId]);
  const raw = (rows.rows[0] as {payload:unknown}).payload;
  const run = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string,unknown>;
  await pg.query('UPDATE runs SET status=$1,payload=$2 WHERE org_id=$3 AND id=$4',
    [status,JSON.stringify({...run,status,cancel_requested:status==='cancelled'}),TEST_ORGS.alpha,runId]);
}
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.repo.close();
    await resource.close();
  }
});
const input = {
  org_id: TEST_ORGS.alpha,
  client_turn_id: '60000000-0000-4000-8000-000000000099',
  text: 'Analyze the inventory',
  scope: {project_external_id:'P-ALPHA',zone_external_id:null},
  data_as_of: '2026-09-19',
};

describe('durable agent execution', () => {
  it('terminalizes a linked job, messages and pending personas when run membership is revoked', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'revoked-run-claim');
    const orchestrator = (await repo.claimAgentTurnJob('turn-worker'))!;
    const run = await repo.startAgentAnalysis(orchestrator);
    const old = (await repo.claimRun('run-worker'))!;
    const succeeded = {task_id:crypto.randomUUID(),org_id:run.org_id,run_id:run.run_id,
      kind:'data' as const,dependencies:[],status:'succeeded' as const,attempt:1,error_code:null};
    const pending = {task_id:crypto.randomUUID(),org_id:run.org_id,run_id:run.run_id,
      kind:'comparison' as const,dependencies:[],status:'running' as const,attempt:1,error_code:null};
    await repo.setTask(old,succeeded);
    await repo.setTask(old,pending);
    await pg.query('DELETE FROM organization_members WHERE org_id=$1 AND user_id=$2',
      [TEST_ORGS.alpha,TEST_USERS.owner]);
    expect(await repo.claimRun('new-worker',new Date(Date.now()+60_000))).toBeNull();
    const state = (await pg.query('SELECT status,worker_id,lease_until,fencing_token,payload FROM runs WHERE id=$1',
      [run.run_id])).rows[0] as {status:string;worker_id:string|null;lease_until:Date|null;fencing_token:number;payload:{error_code:string}};
    expect(state).toMatchObject({status:'failed',worker_id:null,lease_until:null,
      fencing_token:old.fencing_token+1,payload:{error_code:'MEMBERSHIP_REVOKED'}});
    const taskRows = (await pg.query('SELECT payload FROM tasks WHERE run_id=$1',[run.run_id])).rows as Array<
      {payload:{task_id:string;status:string;error_code:string|null}}
    >;
    const tasks = taskRows.map(row => row.payload);
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({task_id:succeeded.task_id,status:'succeeded',error_code:null}),
      expect.objectContaining({task_id:pending.task_id,status:'failed',error_code:'MEMBERSHIP_REVOKED'}),
    ]));
    expect((await pg.query('SELECT status,error_code,worker_id,lease_until FROM agent_turn_jobs WHERE id=$1',
      [turn.job.job_id])).rows[0]).toMatchObject({status:'failed',error_code:'MEMBERSHIP_REVOKED',
        worker_id:null,lease_until:null});
    expect(((await pg.query('SELECT status FROM agent_invocations WHERE job_id=$1',
      [turn.job.job_id])).rows as Array<{status:string}>).every(row =>
        row.status !== 'running' && row.status !== 'waiting' && row.status !== 'queued')).toBe(true);
    expect((await pg.query('SELECT role,status FROM messages WHERE run_id=$1 AND role IN (\'assistant\',\'user\')',
      [run.run_id])).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({role:'assistant',status:'failed'}),
      expect.objectContaining({role:'user',status:'completed'}),
    ]));
    await expect(repo.setTask(old,{...pending,status:'succeeded'})).rejects.toThrow();
  });
  it('atomically links one agent-v1 run and releases the worker without duplicate chat placeholders', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'analysis-1');
    const lease = (await repo.claimAgentTurnJob('worker-analysis'))!;
    const run = await repo.startAgentAnalysis(lease);
    expect(run).toMatchObject({workflow_version:'agent-v1',status:'queued',run_id:expect.any(String)});
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.job).toMatchObject({status:'waiting',run_id:run.run_id,lease_until:null,worker_id:null});
    expect(state.invocations.sort((a,b) => ['root','data','compare','insight','report'].indexOf(a.step_key)-['root','data','compare','insight','report'].indexOf(b.step_key)).map(i => [i.step_key,i.agent_key,i.status,i.run_id])).toEqual([
      ['root','orchestrator','waiting',run.run_id],['data','data','queued',run.run_id],
      ['compare','compare','queued',run.run_id],['insight','insight','queued',run.run_id],['report','report','queued',run.run_id],
    ]);
    expect(state.events.map(e => e.type)).toEqual([
      'turn_queued','turn_claimed','invocation_started','invocation_queued','invocation_queued','invocation_queued','invocation_queued','run_linked','invocation_waiting','turn_waiting',
    ]);
    expect((await pg.query('SELECT id FROM messages WHERE org_id=$1 AND conversation_id=$2 AND role=\'user\'',
      [TEST_ORGS.alpha,turn.conversation.conversation_id])).rows).toHaveLength(1);
    expect((await pg.query('SELECT id FROM messages WHERE org_id=$1 AND conversation_id=$2 AND role=\'assistant\' AND sender_agent IS NULL',
      [TEST_ORGS.alpha,turn.conversation.conversation_id])).rows).toHaveLength(1);
    expect((await repo.claimRun('analysis-worker'))?.run.run_id).toBe(run.run_id);
  });
  it('rolls back run insertion when linking fails, then retries without a duplicate run', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'crash-link');
    const lease = (await repo.claimAgentTurnJob('worker-link'))!;
    await pg.exec(`CREATE FUNCTION private.fail_durable_link() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='waiting' THEN RAISE EXCEPTION 'injected crash'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_durable_link BEFORE UPDATE OF status ON agent_turn_jobs
      FOR EACH ROW EXECUTE FUNCTION private.fail_durable_link();`);
    await expect(repo.startAgentAnalysis(lease)).rejects.toThrow('injected crash');
    expect((await pg.query('SELECT id FROM runs WHERE org_id=$1 AND idempotency_key=$2',
      [TEST_ORGS.alpha,`agent-turn:${turn.job.job_id}:analysis-v1`])).rows).toHaveLength(0);
    await pg.exec('DROP TRIGGER fail_durable_link ON agent_turn_jobs; DROP FUNCTION private.fail_durable_link();');
    const run = await repo.startAgentAnalysis(lease);
    expect((await pg.query('SELECT id FROM runs WHERE org_id=$1 AND idempotency_key=$2',
      [TEST_ORGS.alpha,`agent-turn:${turn.job.job_id}:analysis-v1`])).rows).toMatchObject([{id:run.run_id}]);
    await expect(repo.startAgentAnalysis(lease)).rejects.toThrow('LEASE_LOST');
  });

  it.each(['failed','cancelled'] as const)('resumes a %s run without inventing an artifact', async status => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,`run-${status}`);
    const first = (await repo.claimAgentTurnJob('worker-first'))!;
    const run = await repo.startAgentAnalysis(first);
    await setRunStatus(pg,run.run_id,status);
    const resumed = (await repo.claimAgentTurnJob('worker-resume'))!;
    const result = await repo.resumeAgentAnalysis(resumed);
    expect(result).toEqual({status,run_id:run.run_id,artifact_id:null});
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.job.status).toBe(status);
    expect(state.invocations.every(i => i.status === status)).toBe(true);
    const assistant = (await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,turn.conversation.conversation_id))
      .find(m => m.message_id === turn.assistant_message.message_id)!;
    expect(assistant.status).toBe(status);
    expect(assistant.parts.some(p => p.type === 'artifact_ref')).toBe(false);
    expect(assistant.parts).toContainEqual(expect.objectContaining({type:'run_ref',run_id:run.run_id,status}));
  });

  it('fails safely when a succeeded run has no validated Data artifact', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'missing-artifact');
    const first = (await repo.claimAgentTurnJob('worker-first'))!;
    const run = await repo.startAgentAnalysis(first);
    await setRunStatus(pg,run.run_id,'succeeded');
    const resumed = (await repo.claimAgentTurnJob('worker-resume'))!;
    await expect(repo.resumeAgentAnalysis(resumed)).rejects.toThrow('DATA_ARTIFACT_MISSING');
    await repo.failAgentTurnJob(resumed,'DATA_ARTIFACT_MISSING');
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.job).toMatchObject({status:'failed',error_code:'DATA_ARTIFACT_MISSING'});
  });

  it('rejects a reclaimed stale worker before run creation', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'stale-before-run');
    const old = (await repo.claimAgentTurnJob('worker-old',new Date(Date.now()-120000),1000))!;
    const current = (await repo.claimAgentTurnJob('worker-new'))!;
    await expect(repo.startAgentAnalysis(old)).rejects.toThrow('LEASE_LOST');
    const run = await repo.startAgentAnalysis(current);
    expect((await pg.query('SELECT id FROM runs WHERE org_id=$1 AND idempotency_key=$2',
      [TEST_ORGS.alpha,`agent-turn:${turn.job.job_id}:analysis-v1`])).rows).toMatchObject([{id:run.run_id}]);
  });

  it('reserves a fresh retry budget for resume after the run was durably linked', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'phase-budget');
    await repo.claimAgentTurnJob('worker-1',new Date(Date.now()-180000),1000);
    await repo.claimAgentTurnJob('worker-2',new Date(Date.now()-120000),1000);
    const third = (await repo.claimAgentTurnJob('worker-3'))!;
    expect(third.job.attempt).toBe(3);
    const run = await repo.startAgentAnalysis(third);
    await setRunStatus(pg,run.run_id,'failed');
    const resumed = (await repo.claimAgentTurnJob('worker-4'))!;
    expect(resumed.job).toMatchObject({job_id:turn.job.job_id,attempt:1,run_id:run.run_id});
    expect((await repo.resumeAgentAnalysis(resumed)).status).toBe('failed');
  });

  it('fails on claim when the initiating membership was revoked while waiting', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'revoked-resume');
    const first = (await repo.claimAgentTurnJob('worker-first'))!;
    const run = await repo.startAgentAnalysis(first);
    await setRunStatus(pg,run.run_id,'succeeded');
    await pg.query('DELETE FROM organization_members WHERE org_id=$1 AND user_id=$2',[TEST_ORGS.alpha,TEST_USERS.owner]);
    expect(await repo.claimAgentTurnJob('worker-resume')).toBeNull();
    const rows = await pg.query('SELECT status,error_code FROM agent_turn_jobs WHERE org_id=$1 AND id=$2',
      [TEST_ORGS.alpha,turn.job.job_id]);
    expect(rows.rows).toMatchObject([{status:'failed',error_code:'MEMBERSHIP_REVOKED'}]);
  });
  it('defines finite transitions and rejects unbounded event data', () => {
    expect(canTransitionAgentExecution('queued','running')).toBe(true);
    expect(canTransitionAgentExecution('completed','running')).toBe(false);
    expect(() => AgentExecutionEventDataSchema.parse({prompt:'private'})).toThrow();
    expect(() => AgentExecutionEventDataSchema.parse({error_code:'lowercase'})).toThrow();
    expect(isApprovedDurableAnalysisTurn(input)).toBe(true);
    expect(isApprovedDurableAnalysisTurn({...input,text:'Why did inventory decline?'})).toBe(false);
    expect(isApprovedDurableAnalysisTurn({...input,text:'Run arbitrary SQL for inventory'})).toBe(false);
    expect(isApprovedDurableAnalysisTurn({...input,text:'Show the weather'})).toBe(false);
    expect(aggregatePersonaStageStatus(['pending','pending'])).toBe('queued');
    expect(aggregatePersonaStageStatus(['succeeded','running'])).toBe('running');
    expect(aggregatePersonaStageStatus(['succeeded','succeeded'])).toBe('completed');
    expect(aggregatePersonaStageStatus(['succeeded','failed'])).toBe('failed');
    expect(aggregatePersonaStageStatus(['cancelled','succeeded'])).toBe('cancelled');
  });

  it('reconstructs the latest persona snapshot by conversation after reload', async () => {
    const {repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'latest-snapshot');
    expect(await repo.getLatestAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.conversation.conversation_id)).toMatchObject({
      job:{job_id:turn.job.job_id,status:'queued'},
      invocations:[{step_key:'root',agent_key:'orchestrator'}],
    });
    expect(await repo.getLatestAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,'81000000-0000-4000-8000-000000000099')).toBeNull();
  });

  it('projects every agent-v1 persona from persisted task transitions and deduplicates replay', async () => {
    const {repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'persona-projection');
    const agentLease = (await repo.claimAgentTurnJob('projection-orchestrator'))!;
    const run = await repo.startAgentAnalysis(agentLease);
    const lease = (await repo.claimRun('projection-analysis'))!;
    const taskIds: Record<string,string> = {};
    const set = async (kind: 'data'|'comparison'|'analyst'|'insight'|'chart'|'report'|'reviewer'|'publication', status: 'pending'|'running'|'succeeded') => {
      taskIds[kind] ??= `89000000-0000-4000-8000-${String(Object.keys(taskIds).length+1).padStart(12,'0')}`;
      const task = {task_id:taskIds[kind],run_id:run.run_id,org_id:TEST_ORGS.alpha,kind,dependencies:[],status,attempt:1,error_code:null};
      await repo.setTask(lease,task);
      return task;
    };
    await set('data','running');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='data')?.status).toBe('running');
    await set('data','succeeded');
    await set('comparison','running');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='compare')?.status).toBe('running');
    await set('comparison','succeeded');
    await set('analyst','succeeded');
    await set('insight','running');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='insight')?.status).toBe('running');
    await set('insight','succeeded');
    await set('chart','succeeded');
    await set('report','succeeded');
    await set('reviewer','running');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='report')?.status).toBe('running');
    await set('reviewer','succeeded');
    const publication = await set('publication','pending');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='report')?.status).toBe('running');
    await repo.setTask(lease,publication);
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id)).invocations.find(x=>x.step_key==='report')?.status).toBe('running');
    await set('publication','succeeded');
    const projected = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(projected.invocations.map(x=>[x.step_key,x.status])).toEqual(expect.arrayContaining([
      ['data','completed'],['compare','completed'],['insight','completed'],['report','completed'],
    ]));
    const reportEvents = projected.events.filter(x=>x.invocation_id===projected.invocations.find(i=>i.step_key==='report')?.invocation_id);
    expect(reportEvents.filter(x=>x.type==='invocation_started')).toHaveLength(1);
  });

  it('commits the message pair, job, root, and first ordered event together with idempotent replay', async () => {
    const {pg,repo} = await setup();
    const first = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'durable-1');
    const replay = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'durable-1');
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.job.job_id).toBe(first.job.job_id);
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,first.job.job_id);
    expect(state.job.status).toBe('queued');
    expect((await repo.getAgentTurnJobForMessage(TEST_USERS.owner,TEST_ORGS.alpha,
      first.user_message.message_id))?.job_id).toBe(first.job.job_id);
    expect(state.invocations).toMatchObject([{agent_key:'orchestrator',step_key:'root',depth:0}]);
    expect(state.events.map(e => [e.sequence,e.type])).toEqual([[1,'turn_queued']]);
    expect((await pg.query('SELECT id FROM messages WHERE org_id=$1 AND conversation_id=$2',[TEST_ORGS.alpha,first.conversation.conversation_id])).rows).toHaveLength(2);
    await expect(repo.enqueueAgentTurn(TEST_USERS.owner,{...input,text:'Changed'},'durable-1')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(repo.getAgentTurnJob(TEST_USERS.beta,TEST_ORGS.beta,first.job.job_id)).rejects.toThrow('AGENT_JOB_NOT_FOUND');
    await expect(repo.enqueueAgentTurn(TEST_USERS.viewer,{...input,client_turn_id:'60000000-0000-4000-8000-000000000098'},'viewer')).rejects.toThrow();
  });

  it('does not convert an in-flight legacy turn into durable work during a flag change', async () => {
    const {repo} = await setup();
    await repo.startTurn(TEST_USERS.owner,input,'legacy-key');
    await expect(repo.enqueueAgentTurn(TEST_USERS.owner,input,'legacy-key')).rejects.toThrow('TURN_NOT_DURABLE');
  });

  it('fences a cancelled lease and finalizes the placeholder', async () => {
    const {repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'durable-2');
    const lease = await repo.claimAgentTurnJob('worker-a');
    expect(lease?.job.job_id).toBe(turn.job.job_id);
    expect(await repo.claimAgentTurnJob('worker-b')).toBeNull();
    const cancelled = await repo.cancelAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(cancelled.status).toBe('cancelled');
    await expect(repo.renewAgentTurnLease(lease!)).rejects.toThrow('LEASE_LOST');
    await expect(repo.failAgentTurnJob(lease!,'EXAMPLE')).rejects.toThrow('LEASE_LOST');
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.events.map(e => e.sequence)).toEqual([1,2,3,4]);
    expect(state.events.at(-1)?.type).toBe('turn_cancelled');
    const messages = await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,turn.conversation.conversation_id);
    expect(messages.find(m => m.message_id === turn.assistant_message.message_id)?.status).toBe('cancelled');
  });

  it('requires the run lifecycle after durable linkage and forbids same-run retry', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'linked-lifecycle');
    const lease = (await repo.claimAgentTurnJob('linked-worker'))!;
    const run = await repo.startAgentAnalysis(lease);
    await expect(repo.cancelAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id))
      .rejects.toThrow('AGENT_JOB_HAS_RUN');
    await setRunStatus(pg,run.run_id,'failed');
    await expect(repo.retryRun(TEST_USERS.owner,TEST_ORGS.alpha,run.run_id))
      .rejects.toThrow('DURABLE_RUN_RETRY_REQUIRES_NEW_TURN');
  });

  it('keeps invocation steps idempotent and rejects cross-job parents', async () => {
    const {pg,repo} = await setup();
    const first = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'tree-1');
    const second = await repo.enqueueAgentTurn(TEST_USERS.owner,{...input,client_turn_id:'60000000-0000-4000-8000-000000000097'},'tree-2');
    const lease = (await repo.claimAgentTurnJob('worker-tree'))!;
    const firstRoot = (await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,first.job.job_id)).invocations[0];
    const secondRoot = (await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,second.job.job_id)).invocations[0];
    await expect(pg.query(
      "INSERT INTO agent_invocations(org_id,id,job_id,step_key,agent_key,depth) VALUES($1,$2,$3,'other-root','orchestrator',0)",
      [TEST_ORGS.alpha,'60000000-0000-4000-8000-000000000095',first.job.job_id],
    )).rejects.toThrow();
    const child = await repo.createAgentInvocation(lease,firstRoot.invocation_id,'analysis:1','analyst');
    await expect(repo.completeAgentTurnJob(lease,'Too early')).rejects.toThrow('INVOCATIONS_PENDING');
    expect(await repo.createAgentInvocation(lease,firstRoot.invocation_id,'analysis:1','analyst')).toEqual(child);
    await expect(repo.createAgentInvocation(lease,secondRoot.invocation_id,'analysis:2','analyst')).rejects.toThrow('INVOCATION_PARENT_NOT_FOUND');
    await expect(repo.createAgentInvocation(lease,firstRoot.invocation_id,'analysis:1','reviewer')).rejects.toThrow('INVOCATION_STEP_CONFLICT');
    await expect(pg.query(
      "INSERT INTO agent_invocations(org_id,id,job_id,parent_id,step_key,agent_key,depth) VALUES($1,$2,$3,$4,'illegal','analyst',1)",
      [TEST_ORGS.alpha,'60000000-0000-4000-8000-000000000096',first.job.job_id,secondRoot.invocation_id],
    )).rejects.toThrow();
    expect((await repo.setAgentInvocationStatus(lease,child.invocation_id,'running')).status).toBe('running');
    expect((await repo.setAgentInvocationStatus(lease,child.invocation_id,'completed')).status).toBe('completed');
    await expect(repo.setAgentInvocationStatus(lease,child.invocation_id,'running')).rejects.toThrow('INVALID_INVOCATION_TRANSITION');
    const answer = await repo.completeAgentTurnJob(lease,'Inventory analysis is ready.');
    expect(answer.status).toBe('completed');
    await expect(repo.renewAgentTurnLease(lease)).rejects.toThrow('LEASE_LOST');
  });

  it('applies tenant RLS and denies direct authenticated writes', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'rls-1');
    const visible = await pg.transaction(async tx => {
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[TEST_USERS.viewer]);
      await tx.exec('SET LOCAL ROLE authenticated');
      return {
        jobs:(await tx.query('SELECT id FROM agent_turn_jobs WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
        invocations:(await tx.query('SELECT id FROM agent_invocations WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
        events:(await tx.query('SELECT id FROM agent_execution_events WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
      };
    });
    expect(visible.jobs).toMatchObject([{id:turn.job.job_id}]);
    expect(visible.invocations).toHaveLength(1);
    expect(visible.events).toHaveLength(1);
    const hidden = await pg.transaction(async tx => {
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[TEST_USERS.beta]);
      await tx.exec('SET LOCAL ROLE authenticated');
      return {
        jobs:(await tx.query('SELECT id FROM agent_turn_jobs WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
        invocations:(await tx.query('SELECT id FROM agent_invocations WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
        events:(await tx.query('SELECT id FROM agent_execution_events WHERE org_id=$1',[TEST_ORGS.alpha])).rows,
      };
    });
    expect(hidden).toEqual({jobs:[],invocations:[],events:[]});
    await expect(pg.transaction(async tx => {
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[TEST_USERS.owner]);
      await tx.exec('SET LOCAL ROLE authenticated');
      await tx.query("DELETE FROM agent_execution_events WHERE org_id=$1 AND job_id=$2",[TEST_ORGS.alpha,turn.job.job_id]);
    })).rejects.toThrow();
  });

  it('reclaims expired work with a new fence and caps attempts', async () => {
    const {repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'durable-3');
    const first = (await repo.claimAgentTurnJob('worker-a',new Date(Date.now()-120000),1000))!;
    const second = (await repo.claimAgentTurnJob('worker-b'))!;
    expect(second.fencing_token).toBeGreaterThan(first.fencing_token);
    await expect(repo.failAgentTurnJob(first,'STALE')).rejects.toThrow('LEASE_LOST');
    const third = (await repo.claimAgentTurnJob('worker-c',new Date(Date.now()+120000)))!;
    expect(third.job.attempt).toBe(3);
    await expect(repo.claimAgentTurnJob('worker-d',new Date(Date.now()+240000))).resolves.toBeNull();
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.job).toMatchObject({status:'failed',error_code:'MAX_ATTEMPTS'});
  });

  it('releases a waiting worker and wakes the job after its AnalysisRun finishes', async () => {
    const {pg,repo} = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'waiting-1');
    const lease = (await repo.claimAgentTurnJob('worker-a'))!;
    const run = await repo.createRun(TEST_USERS.owner,{
      org_id:TEST_ORGS.alpha,scope:input.scope,data_as_of:input.data_as_of,
      question:input.text,conversation_id:turn.conversation.conversation_id,
    },'waiting-run');
    await repo.waitAgentTurnForRun(lease,run.run_id);
    expect(await repo.claimAgentTurnJob('worker-b')).toBeNull();
    await expect(repo.renewAgentTurnLease(lease)).rejects.toThrow('LEASE_LOST');
    await pg.query("UPDATE runs SET status='succeeded' WHERE org_id=$1 AND id=$2",[TEST_ORGS.alpha,run.run_id]);
    const resumed = await repo.claimAgentTurnJob('worker-b');
    expect(resumed?.job).toMatchObject({job_id:turn.job.job_id,status:'running',attempt:1,run_id:run.run_id});
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,turn.job.job_id);
    expect(state.events.map(e => e.type)).toEqual(['turn_queued','turn_claimed','invocation_started','turn_waiting','turn_queued','turn_claimed','invocation_started']);
  });
});
