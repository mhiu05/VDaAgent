import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadContextSchema, type AnalysisRun, type ReportRecord } from '@vda/contracts';
import { createTestRepository, pgliteDriver, TEST_ORGS, TEST_USERS } from '../../../tests/helpers/postgres';
import { versionPublishedReport } from './repositories/workspace-repository';
import { executeCoordinatorAndData } from '../../agents/src/analysis-v1/stages/coordinator-data';

const resources: Array<Awaited<ReturnType<typeof createTestRepository>>> = [];
async function setup() { const resource = await createTestRepository(); resources.push(resource); return resource; }
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.repo.close(); await resource.pg.close(); } });
const request = {org_id:TEST_ORGS.alpha,scope:{project_external_id:'P-ALPHA',zone_external_id:null},data_as_of:'2026-09-19',question:'Analyze inventory',conversation_id:null};
const turn = () => ({org_id:TEST_ORGS.alpha,client_turn_id:randomUUID(),scope:request.scope,data_as_of:request.data_as_of,text:'Analyze inventory'});

describe('thread workspace persistence', () => {
  it('completes a durable Data artifact without publishing a report and rejects unvalidated or stale completion', async () => {
    const {repo,pg} = await setup();
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,{...turn(),agent_target:'data'},'partial-data');
    const job = (await repo.claimAgentTurnJob('partial-planner',new Date(),120000))!;
    const run = await repo.startAgentAnalysis(job,{planned:true});
    const lease = (await repo.claimRun('partial-data-worker',new Date(),120000))!;
    await expect(repo.finishAgentArtifactRun(lease,randomUUID())).rejects.toThrow('SPECIALIST_STAGES_INCOMPLETE');
    const result = await executeCoordinatorAndData(repo,lease);
    const artifact = result.data_analysis_pack;
    await expect(repo.finishAgentArtifactRun(lease,result.calculation.artifact_id)).rejects.toThrow('SPECIALIST_ARTIFACT_MISMATCH');
    await pg.query('DELETE FROM validations WHERE org_id=$1 AND id=$2',[run.org_id,artifact.artifact_id]);
    await expect(repo.finishAgentArtifactRun(lease,artifact.artifact_id)).rejects.toThrow('SPECIALIST_ARTIFACT_VALIDATION_REQUIRED');
    await repo.validateArtifact(lease,{artifact_id:artifact.artifact_id,org_id:run.org_id,run_id:run.run_id,valid:true,validated_at:new Date().toISOString(),validator_version:'mvp-validator-v1',checks:['test']});
    await expect(repo.finishAgentArtifactRun({...lease,fencing_token:lease.fencing_token-1},artifact.artifact_id)).rejects.toThrow('LEASE_LOST');
    await repo.finishAgentArtifactRun(lease,artifact.artifact_id);
    expect((await repo.getRun(TEST_USERS.owner,run.org_id,run.run_id)).run).toMatchObject({status:'succeeded',report_artifact_id:null});
    expect(await repo.listReports(TEST_USERS.owner,run.org_id)).toHaveLength(0);
    const resumed = (await repo.claimAgentTurnJob('partial-resume',new Date(),120000))!;
    expect(await repo.resumeAgentAnalysis(resumed)).toMatchObject({status:'completed',artifact_id:artifact.artifact_id});
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,run.org_id,accepted.job.job_id);
    expect(state.invocations.map(invocation=>invocation.step_key).sort()).toEqual(['data','root']);
    expect(state.invocations.every(invocation=>invocation.status==='completed')).toBe(true);
    const answer = await repo.getMessage(TEST_USERS.owner,run.org_id,accepted.conversation.conversation_id,accepted.assistant_message.message_id);
    expect(answer.parts).toContainEqual({type:'artifact_ref',run_id:run.run_id,artifact_id:artifact.artifact_id,kind:'data_analysis_pack'});
    expect(answer.parts.some(part=>part.type==='report_ref')).toBe(false);
    expect((await repo.listMemory(TEST_USERS.owner,run.org_id)).find(memory=>memory.key==='system:dataset_schema')?.summary).toContain('Semantic version:');
  });
  it('loads durable specialist requests and atomically finalizes references under the job fence', async () => {
    const {repo,pg} = await setup();
    const input = {...turn(),agent_target:'data' as const,text:'Explain the current inventory'};
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'specialist-execution');
    const lease = (await repo.claimAgentTurnJob('specialist-worker',new Date(),120000))!;
    const execution = await repo.getAgentTurnExecution(lease);
    expect(execution).toMatchObject({input:{agent_target:'data'},idempotency_key:'specialist-execution',context:{conversation_id:accepted.conversation.conversation_id}});
    await expect(repo.finalizeAgentTurnExecution({...lease,fencing_token:lease.fencing_token-1},{status:'completed',content:'Ready',parts:[{type:'text',text:'Ready'}],sender_agent:'data'})).rejects.toThrow('LEASE_LOST');
    await repo.finalizeAgentTurnExecution(lease,{status:'completed',content:'Ready',parts:[{type:'text',text:'Ready'}],sender_agent:'data'});
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    expect(state.job.status).toBe('completed');
    expect(state.invocations.every(invocation=>invocation.status==='completed')).toBe(true);
    expect((await repo.getMessage(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id,accepted.assistant_message.message_id)).sender_agent).toBe('data');
    const planned = await repo.enqueueAgentTurn(TEST_USERS.owner,{...turn(),agent_target:'report',text:'Create an executive report'},'planned-specialist');
    const plannedLease = (await repo.claimAgentTurnJob('planner',new Date(),120000))!;
    expect((await repo.startAgentAnalysis(plannedLease,{planned:true})).request.agent_target).toBe('report');
    expect((await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,planned.job.job_id)).job.status).toBe('waiting');
    const corrupt = await repo.enqueueAgentTurn(TEST_USERS.owner,turn(),'corrupt-execution');
    const corruptLease = (await repo.claimAgentTurnJob('corrupt-worker',new Date(),120000))!;
    await pg.query("UPDATE messages SET payload=jsonb_set(payload,'{agent_turn,request,text}','\"changed\"'::jsonb) WHERE org_id=$1 AND id=$2",[TEST_ORGS.alpha,corrupt.user_message.message_id]);
    await expect(repo.getAgentTurnExecution(corruptLease)).rejects.toThrow('UNSUPPORTED_DURABLE_REQUEST');
  });
  it('persists per-thread defaults and message overrides while rejecting foreign references and replies', async () => {
    const {repo} = await setup();
    const first = await repo.startTurn(TEST_USERS.owner,turn(),'thread-context');
    const conversation = first.conversation.conversation_id;
    const imports = await repo.listImports(TEST_USERS.owner,TEST_ORGS.alpha);
    const dataset = imports[0].import_id;
    const context = ThreadContextSchema.parse({dataset_ids:[dataset]});
    await repo.updateThreadContext(TEST_USERS.owner,TEST_ORGS.alpha,conversation,context);
    expect(await repo.getThreadContext(TEST_USERS.viewer,TEST_ORGS.alpha,conversation)).toEqual(context);
    const override = await repo.startTurn(TEST_USERS.owner,{...turn(),context_refs:[{type:'dataset',id:dataset}],reply_to_message_id:first.user_message.message_id},'override',conversation);
    expect((await repo.getMessage(TEST_USERS.owner,TEST_ORGS.alpha,conversation,override.user_message.message_id)).context_refs).toEqual([{type:'dataset',id:dataset}]);
    expect(await repo.getThreadContext(TEST_USERS.owner,TEST_ORGS.alpha,conversation)).toEqual(context);
    await expect(repo.updateThreadContext(TEST_USERS.viewer,TEST_ORGS.alpha,conversation,context)).rejects.toThrow('VIEWER_READ_ONLY');
    await expect(repo.getThreadContext(TEST_USERS.beta,TEST_ORGS.alpha,conversation)).rejects.toThrow('WORKSPACE_FORBIDDEN');
    const betaImports = await repo.listImports(TEST_USERS.beta,TEST_ORGS.beta);
    await expect(repo.startTurn(TEST_USERS.owner,{...turn(),context_refs:[{type:'dataset',id:betaImports[0].import_id}]},'foreign',conversation)).rejects.toThrow('CONTEXT_REFERENCE_NOT_FOUND');
    const other = await repo.startTurn(TEST_USERS.owner,turn(),'other');
    await expect(repo.startTurn(TEST_USERS.owner,{...turn(),reply_to_message_id:other.user_message.message_id},'foreign-reply',conversation)).rejects.toThrow('REPLY_MESSAGE_NOT_FOUND');
  });

  it('fences durable calls, replays a monotonic event cursor, preserves messages, and cascades cancellation', async () => {
    const {repo,pg} = await setup();
    const run = await repo.createRun(TEST_USERS.owner,request,'runtime-run');
    const lease = (await repo.claimRun('runtime-worker',new Date(),120000))!;
    const root = {kind:'invocation' as const,step_key:'team:main',agent_key:'main',status:'running' as const,summary:'Coordinate analysis'};
    const recorded = await repo.recordRuntimeActivity(lease,root);
    const replay = await repo.recordRuntimeActivity(lease,root);
    expect(replay.activity_id).toBe(recorded.activity_id);
    const tool = {kind:'tool' as const,step_key:'team:main:query',parent_step_key:'team:main',agent_key:'data',tool_name:'queryInventory',status:'running' as const,summary:'Query selected inventory'};
    await repo.recordRuntimeActivity(lease,tool);
    const message = {kind:'message' as const,step_key:'team:main:request',parent_step_key:'team:main',agent_key:'main',target_agent_key:'data',message_type:'data_request' as const,summary:'Fetch current inventory'};
    await repo.recordRuntimeActivity(lease,message);
    await expect(repo.recordRuntimeActivity(lease,{...message,summary:'Altered request'})).rejects.toThrow('RUNTIME_MESSAGE_IMMUTABLE');
    const before = await repo.getRunRuntime(TEST_USERS.viewer,TEST_ORGS.alpha,run.run_id);
    expect(before.records).toHaveLength(3);
    expect(before.events.map(event=>event.sequence)).toEqual([1,2,3]);
    expect((await repo.getRunRuntime(TEST_USERS.owner,TEST_ORGS.alpha,run.run_id,2)).events.map(event=>event.sequence)).toEqual([3]);
    await expect(repo.recordRuntimeActivity({...lease,fencing_token:lease.fencing_token-1},root)).rejects.toThrow('LEASE_LOST');
    await repo.cancelRun(TEST_USERS.owner,TEST_ORGS.alpha,run.run_id);
    const after = await repo.getRunRuntime(TEST_USERS.owner,TEST_ORGS.alpha,run.run_id,before.last_sequence);
    expect(after.events.map(event=>event.record.status)).toEqual(['cancelled','cancelled']);
    expect(after.records.filter(record=>record.kind !== 'message').every(record=>record.status==='cancelled')).toBe(true);
    await expect(repo.recordRuntimeActivity(lease,{...root,status:'completed'})).rejects.toThrow('LEASE_LOST');
    await expect(repo.getRunRuntime(TEST_USERS.beta,TEST_ORGS.alpha,run.run_id)).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(pg.exec('UPDATE runtime_activity_events SET sequence=999')).rejects.toThrow('immutable lineage record');
    await pg.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${TEST_USERS.beta}',false)`);
    expect((await pg.query('SELECT * FROM runtime_activities')).rows).toHaveLength(0);
    await expect(pg.exec("INSERT INTO runtime_activities(org_id,id) VALUES('forged','forged')")).rejects.toThrow('permission denied');
    await pg.exec('RESET ROLE');
  });

  it('retrieves three bounded memory layers, excludes expiry and enforces private tenant scope', async () => {
    const {repo,pg} = await setup();
    const run = await repo.createRun(TEST_USERS.owner,request,'memory-run');
    const conversation = run.request.conversation_id!;
    const lease = (await repo.claimRun('memory-worker',new Date(),120000))!;
    await repo.recordRuntimeActivity(lease,{kind:'tool',step_key:'query',agent_key:'data',status:'completed',summary:'Inventory retrieval completed'});
    await repo.saveMemory(TEST_USERS.owner,TEST_ORGS.alpha,{layer:'episodic',conversation_id:conversation,key:'prior',summary:'Inventory report is ready'});
    await repo.saveMemory(TEST_USERS.owner,TEST_ORGS.alpha,{layer:'workspace',key:'preference',summary:'Inventory reports should be concise'});
    await repo.saveMemory(TEST_USERS.owner,TEST_ORGS.alpha,{layer:'working',run_id:run.run_id,key:'expired',summary:'Expired inventory',expires_at:'2020-01-01T00:00:00.000Z'});
    const query = {conversation_id:conversation,run_id:run.run_id,query:'inventory'};
    const memories = await repo.listMemory(TEST_USERS.owner,TEST_ORGS.alpha,query);
    expect([...new Set(memories.map(memory=>memory.layer))].sort()).toEqual(['episodic','working','workspace']);
    expect(await repo.listMemory(TEST_USERS.viewer,TEST_ORGS.alpha,query)).toEqual([]);
    expect(await repo.listMemory(TEST_USERS.owner,TEST_ORGS.alpha,{...query,limit:1})).toHaveLength(1);
    await expect(repo.listMemory(TEST_USERS.beta,TEST_ORGS.alpha,query)).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(repo.saveMemory(TEST_USERS.viewer,TEST_ORGS.alpha,{layer:'workspace',key:'forged',summary:'forged'})).rejects.toThrow('VIEWER_READ_ONLY');
    expect(()=>repo.saveMemory(TEST_USERS.owner,TEST_ORGS.alpha,{layer:'working',key:'invalid',summary:'Missing run'})).toThrow();
    await pg.query(`INSERT INTO agent_memory(org_id,id,layer,run_id,scope_key,memory_key,summary)
      SELECT $1,'90000000-0000-4000-8000-' || lpad(n::text,12,'0'),'working',$2,$2,'recent:' || n,'Inventory tool result ' || n
      FROM generate_series(1,25) n`,[TEST_ORGS.alpha,run.run_id]);
    const diverse = await repo.listMemory(TEST_USERS.owner,TEST_ORGS.alpha,{...query,limit:24});
    expect([...new Set(diverse.map(memory=>memory.layer))].sort()).toEqual(['episodic','working','workspace']);
    expect(diverse.filter(memory=>memory.layer==='working')).toHaveLength(8);
    expect(diverse.some(memory=>memory.key==='expired')).toBe(false);
  });

  it('allocates immutable report versions and a separate lineage in the same thread', async () => {
    const {repo,pg} = await setup();
    const firstRun = await repo.createRun(TEST_USERS.owner,request,'report-first');
    const thread = firstRun.request.conversation_id!;
    const publish = async (run:AnalysisRun) => {
      const task = randomUUID(), artifact = randomUUID();
      await pg.query('INSERT INTO tasks(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)',[run.org_id,task,run.run_id,'{}']);
      await pg.query("INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload) VALUES($1,$2,$3,$4,'report',$5)",[run.org_id,artifact,run.run_id,task,JSON.stringify({org_id:run.org_id,artifact_id:artifact,run_id:run.run_id,task_id:task,content_hash:'a'.repeat(64)})]);
      const record:ReportRecord = {org_id:run.org_id,report_id:randomUUID(),run_id:run.run_id,artifact_id:artifact,created_at:new Date().toISOString(),occurrence_id:null};
      await pg.query('INSERT INTO reports(org_id,id,run_id,artifact_id,payload) VALUES($1,$2,$3,$4,$5)',[run.org_id,record.report_id,run.run_id,artifact,JSON.stringify(record)]);
      return pgliteDriver(pg).transaction(tx=>versionPublishedReport(tx,run,record));
    };
    const first = await publish(firstRun);
    const updateRun = await repo.createRun(TEST_USERS.owner,{...request,conversation_id:thread,question:'Update the current report'},'report-update');
    const second = await publish(updateRun);
    const newRun = await repo.createRun(TEST_USERS.owner,{...request,conversation_id:thread,question:'Create a separate executive report'},'report-new');
    const separate = await publish(newRun);
    expect(first).toMatchObject({lineage_id:first.report_id,version:1,parent_report_id:null});
    expect(second).toMatchObject({lineage_id:first.report_id,version:2,parent_report_id:first.report_id});
    expect(separate).toMatchObject({lineage_id:separate.report_id,version:1,parent_report_id:null});
    expect(await repo.listReports(TEST_USERS.owner,TEST_ORGS.alpha)).toHaveLength(3);
    expect(await repo.getThreadContext(TEST_USERS.owner,TEST_ORGS.alpha,thread)).toMatchObject({active_report_id:separate.report_id});
    expect((await repo.listMemory(TEST_USERS.owner,TEST_ORGS.alpha,{conversation_id:thread})).filter(memory=>memory.layer==='episodic')).toHaveLength(3);
    await expect(pg.exec('UPDATE report_versions SET version=99')).rejects.toThrow('immutable lineage record');
    await expect(pg.exec("UPDATE reports SET payload='{}'")).rejects.toThrow('immutable lineage record');
  });
});
