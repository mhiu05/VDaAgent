import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAgentWorkflow, executeSpecialistWorkflow } from '@vda/agents/analysis-v1/workflow';
import { SAFE_SUMMARY } from '../../packages/domain/src/index';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../tests/helpers/postgres';
import { dispatchAgentTurn } from './agent-turn-dispatcher';

const resources: Array<{repo:Repository;close:() => Promise<void>}> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.repo.close();
    await resource.close();
  }
});
const input = {
  org_id:TEST_ORGS.alpha,
  client_turn_id:'60000000-0000-4000-8000-000000000081',
  text:'Analyze the inventory',
  scope:{project_external_id:'P-ALPHA',zone_external_id:null},
  data_as_of:'2026-09-19',
};
const quiet = {
  log:vi.fn(),error:vi.fn(),
  startHeartbeat:vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
  stopHeartbeat:vi.fn(),
};

describe('durable Orchestrator vertical slice', () => {
  it.each(['data', 'insight'] as const)('completes a %s Agent task with an artifact and no report while preserving the thread', async target => {
    const {pg,repo} = await createTestRepository();
    resources.push({repo,close:() => pg.close()});
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,{...input,agent_target:target,text:'Inspect the inventory dataset'},`${target}-artifact-only`);
    const turnLease = (await repo.claimAgentTurnJob('specialist',new Date(),120000))!;
    await repo.startAgentAnalysis(turnLease,{planned:true});
    const lease = (await repo.claimRun('data-worker',new Date(),240000))!;
    const artifact = await executeSpecialistWorkflow(repo,lease,{
      narrativeProvider:{narrate:async claims => ({summary:SAFE_SUMMARY,claims,provider:'gemini'})},
    });
    expect(artifact.kind).toBe(target === 'data' ? 'data_analysis_pack' : 'insight_pack');
    const detail = await repo.getRun(TEST_USERS.owner,TEST_ORGS.alpha,lease.run.run_id);
    expect(detail.run).toMatchObject({status:'succeeded',report_artifact_id:null});
    expect(await repo.listReports(TEST_USERS.owner,TEST_ORGS.alpha)).toHaveLength(0);
    const state = await repo.getRunRuntime(TEST_USERS.owner,TEST_ORGS.alpha,lease.run.run_id);
    expect(state.records.find(record => record.kind === 'invocation' && !record.parent_step_key)?.agent_key).toBe(target);
    expect(state.records.some(record => ['report','reviewer'].includes(record.agent_key))).toBe(false);
    const resumed = (await repo.claimAgentTurnJob('specialist-resume',new Date(),120000))!;
    await dispatchAgentTurn(repo,resumed,quiet);
    const done = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    expect(done.job.status).toBe('completed');
    const context = await repo.getThreadContext(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id);
    expect(context.active_report_id).toBeNull();
    expect(context.current_run_id).toBe(lease.run.run_id);
    const messages = await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id);
    expect(messages.find(message => message.message_id === accepted.assistant_message.message_id)?.parts).toContainEqual(
      expect.objectContaining({type:'artifact_ref',artifact_id:artifact.artifact_id,kind:artifact.kind}));
  },120000);

  it('survives client departure and persists a grounded reply from one canonical agent-v1 run', async () => {
    // The repository default remains legacy-v1; this job must pin agent-v1 explicitly.
    const {pg,repo} = await createTestRepository();
    resources.push({repo,close:() => pg.close()});
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'browser-request');
    // No browser connection or request signal is retained after acceptance.
    const first = (await repo.claimAgentTurnJob('orchestrator-1',new Date(),120000))!;
    await dispatchAgentTurn(repo,first,quiet);
    const waiting = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    expect(waiting.job).toMatchObject({status:'waiting',run_id:expect.any(String),lease_until:null});
    const runId = waiting.job.run_id!;
    const runLease = (await repo.claimRun('analysis-1',new Date(),240000))!;
    expect(runLease.run).toMatchObject({run_id:runId,workflow_version:'agent-v1'});
    await executeAgentWorkflow(repo,runLease,{
      narrativeProvider:{narrate:async claims => ({summary:SAFE_SUMMARY,claims:[...claims].reverse(),provider:'gemini'})},
    });
    const beforeResume = await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id);
    expect(beforeResume.find(m => m.message_id === accepted.assistant_message.message_id)?.status).toBe('in_progress');
    const crashed = (await repo.claimAgentTurnJob('orchestrator-crashed',new Date(Date.now()-120000),1000))!;
    const resumed = (await repo.claimAgentTurnJob('orchestrator-2',new Date(),120000))!;
    expect(resumed.job.run_id).toBe(runId);
    await expect(repo.resumeAgentAnalysis(crashed)).rejects.toThrow('LEASE_LOST');
    await expect(repo.completeAgentTurnJob(resumed,'Ungrounded answer')).rejects.toThrow('RUN_FINALIZATION_REQUIRED');
    await dispatchAgentTurn(repo,resumed,quiet);
    const finished = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    const messages = await repo.listMessages(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id,{limit:100,cursor:null});
    const assistant = messages.messages.find(m => m.message_id === accepted.assistant_message.message_id)!;
    const userMessage = messages.messages.find(m => m.message_id === accepted.user_message.message_id)!;
    expect(finished.job.status).toBe('completed');
    expect(finished.invocations.map(i => [i.step_key,i.status])).toEqual(expect.arrayContaining([
      ['root','completed'],['data','completed'],['compare','completed'],['insight','completed'],['report','completed'],
    ]));
    const runtime = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, runId);
    expect(runtime.records).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'invocation',step_key:'team:insight:data-detail',parent_step_key:'team:insight',agent_key:'data',status:'completed'}),
      expect.objectContaining({kind:'message',agent_key:'insight',target_agent_key:'data',message_type:'task_request'}),
      expect.objectContaining({kind:'message',agent_key:'data',target_agent_key:'insight',message_type:'task_result'}),
      expect.objectContaining({kind:'tool',tool_name:'data.evidence',status:'completed'}),
    ]));
    const dataResponse = runtime.records.find(record => record.step_key === 'team:insight:data-detail:response')!;
    expect(dataResponse.artifact_refs?.length).toBeGreaterThan(0);
    expect(dataResponse.evidence_refs?.length).toBeGreaterThan(0);
    const replay = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, runId, runtime.last_sequence);
    expect(replay.events).toHaveLength(0);
    expect(replay.records).toEqual(runtime.records);
    const thread = await repo.getThreadContext(TEST_USERS.owner, TEST_ORGS.alpha, accepted.conversation.conversation_id);
    expect(thread.current_run_id).toBe(runId);
    expect(thread.active_report_id).toBeTruthy();
    if (process.env.RUNTIME_FIXTURE_PATH) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(process.env.RUNTIME_FIXTURE_PATH, JSON.stringify({
        catalog: await repo.catalog(TEST_USERS.owner,TEST_ORGS.alpha), conversation: accepted.conversation,
        messages: messages.messages, runDetail: await repo.getRun(TEST_USERS.owner,TEST_ORGS.alpha,runId),
        runtime, artifacts: await repo.artifacts(TEST_USERS.owner,TEST_ORGS.alpha,runId),
        reports: await repo.listReports(TEST_USERS.owner,TEST_ORGS.alpha), threadContext: thread,
        memory: await repo.listMemory(TEST_USERS.owner,TEST_ORGS.alpha,{conversation_id:accepted.conversation.conversation_id,run_id:runId}),
      }, null, 2));
    }
    expect(assistant.status).toBe('completed');
    expect(userMessage.status).toBe('completed');
    expect(assistant.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({type:'run_ref',run_id:runId,status:'succeeded'}),
      expect.objectContaining({type:'artifact_ref',run_id:runId,kind:'data_analysis_pack'}),
      expect.objectContaining({type:'report_ref',run_id:runId}),
    ]));
    expect(assistant.content).not.toContain('query_result');
    const artifact = assistant.parts.find(p => p.type === 'artifact_ref');
    if (!artifact || artifact.type !== 'artifact_ref') throw new Error('ARTIFACT_REF_REQUIRED');
    await expect(repo.publicArtifactById(TEST_USERS.beta,TEST_ORGS.beta,runId,artifact.artifact_id)).rejects.toThrow();
    expect(messages.messages.filter(m => m.message_id === accepted.user_message.message_id)).toHaveLength(1);
    expect(messages.messages.filter(m => m.message_id === accepted.assistant_message.message_id)).toHaveLength(1);
    const rows = await pg.query('SELECT id FROM runs WHERE org_id=$1 AND idempotency_key=$2',
      [TEST_ORGS.alpha,`agent-turn:${accepted.job.job_id}:analysis-v1`]);
    expect(rows.rows).toHaveLength(1);
    expect(await repo.claimAgentTurnJob('orchestrator-3')).toBeNull();
    await expect(repo.resumeAgentAnalysis(resumed)).rejects.toThrow('LEASE_LOST');
  },240000);

  it('does not finalize a successful run when its Data pack validation is missing', async () => {
    const {pg,repo} = await createTestRepository();
    resources.push({repo,close:() => pg.close()});
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'invalid-data-pack');
    await dispatchAgentTurn(repo,(await repo.claimAgentTurnJob('orchestrator-1',new Date(),120000))!,quiet);
    const runLease = (await repo.claimRun('analysis-1',new Date(),240000))!;
    await executeAgentWorkflow(repo,runLease,{
      narrativeProvider:{narrate:async claims => ({summary:SAFE_SUMMARY,claims:[...claims].reverse(),provider:'gemini'})},
    });
    const pack = await repo.artifactByKey(TEST_USERS.owner,TEST_ORGS.alpha,runLease.run.run_id,'data_analysis_pack');
    await pg.query('DELETE FROM validations WHERE org_id=$1 AND run_id=$2 AND id=$3',
      [TEST_ORGS.alpha,runLease.run.run_id,pack.artifact_id]);
    const resumed = (await repo.claimAgentTurnJob('orchestrator-2',new Date(),120000))!;
    await dispatchAgentTurn(repo,resumed,quiet);
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    expect(state.job).toMatchObject({status:'failed',error_code:'DATA_ARTIFACT_VALIDATION_REQUIRED'});
    const assistant = (await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id))
      .find(m => m.message_id === accepted.assistant_message.message_id)!;
    expect(assistant.status).toBe('failed');
    expect(assistant.parts).toContainEqual(expect.objectContaining({type:'run_ref',status:'succeeded'}));
    expect(assistant.parts.some(p => p.type === 'artifact_ref')).toBe(false);
  },240000);

  it('keeps the published Data pack immutable before Orchestrator resume', async () => {
    const {pg,repo} = await createTestRepository();
    resources.push({repo,close:() => pg.close()});
    const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner,input,'invalid-data-hash');
    await dispatchAgentTurn(repo,(await repo.claimAgentTurnJob('orchestrator-1',new Date(),120000))!,quiet);
    const runLease = (await repo.claimRun('analysis-1',new Date(),240000))!;
    await executeAgentWorkflow(repo,runLease,{
      narrativeProvider:{narrate:async claims => ({summary:SAFE_SUMMARY,claims:[...claims].reverse(),provider:'gemini'})},
    });
    const pack = await repo.artifactByKey(TEST_USERS.owner,TEST_ORGS.alpha,runLease.run.run_id,'data_analysis_pack');
    await expect(pg.query('UPDATE artifacts SET payload=$1 WHERE org_id=$2 AND run_id=$3 AND id=$4',
      [JSON.stringify({...pack,content_hash:'0'.repeat(64)}),TEST_ORGS.alpha,runLease.run.run_id,pack.artifact_id]))
      .rejects.toThrow('immutable lineage record');
    await dispatchAgentTurn(repo,(await repo.claimAgentTurnJob('orchestrator-2',new Date(),120000))!,quiet);
    const state = await repo.getAgentTurnJob(TEST_USERS.owner,TEST_ORGS.alpha,accepted.job.job_id);
    expect(state.job.status).toBe('completed');
    const assistant = (await repo.messages(TEST_USERS.owner,TEST_ORGS.alpha,accepted.conversation.conversation_id))
      .find(m => m.message_id === accepted.assistant_message.message_id)!;
    expect(assistant.parts).toContainEqual(expect.objectContaining({type:'run_ref',status:'succeeded'}));
    expect(assistant.parts).toContainEqual(expect.objectContaining({type:'artifact_ref',artifact_id:pack.artifact_id}));
  },240000);
});
