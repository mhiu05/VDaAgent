import { randomUUID } from 'node:crypto';
import { ArtifactSchema, ArtifactValidationSchema, RunTaskSchema, type AnalysisRun, type Artifact, type MessagePart } from '@vda/contracts';
import { stableId, verifyArtifact } from '@vda/domain';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';
import { updateRun } from '../repositories/run-repository';
import { fenceRun } from '../workflow/lease-repository';
import { finishRunAssistant } from '../workflow/checkpoint-repository';
import { syncAgentInvocationsFromRun } from '../workflow/agent-projection';
import { specialistPlan } from '../workflow/specialist-plan';
import type { Lease } from '../types';

/** Rechecked both at worker completion and when the durable initiating turn resumes. */
export async function verifiedSpecialistResult(tx: Driver, run: AnalysisRun, artifactId?: string): Promise<Artifact> {
  const plan = specialistPlan(run.request.agent_target);
  if (!plan || run.workflow_version !== 'agent-v1' || run.report_artifact_id !== null) fail('SPECIALIST_RUN_REQUIRED',409);
  const stages = (await tx.query('SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2',[run.org_id,run.run_id])).map(row=>RunTaskSchema.parse(json(row)));
  for (const kind of plan.stages) {
    const task = stages.find(stage=>stage.kind===kind);
    if (!task || task.task_id!==stableId(`${run.run_id}:task:${kind}`) || task.org_id!==run.org_id || task.run_id!==run.run_id || task.status!=='succeeded' || task.attempt!==run.attempt || task.error_code!==null) fail('SPECIALIST_STAGES_INCOMPLETE',409);
  }
  const rows = await tx.query('SELECT artifact_key,payload FROM artifacts WHERE org_id=$1 AND run_id=$2',[run.org_id,run.run_id]);
  const outputs = rows.map(row=>({key:String(row.artifact_key),artifact:ArtifactSchema.parse(json(row))}));
  const output = outputs.find(value=>value.key===plan.artifact)?.artifact;
  if (!output || output.kind!==plan.artifact || (artifactId && output.artifact_id!==artifactId)) fail('SPECIALIST_ARTIFACT_MISMATCH',409);
  const validations = (await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2',[run.org_id,run.run_id])).map(row=>ArtifactValidationSchema.parse(json(row)));
  const visited = new Set<string>();
  const verify = (artifact:Artifact) => {
    if (visited.has(artifact.artifact_id)) return;
    visited.add(artifact.artifact_id);
    if (artifact.org_id!==run.org_id || artifact.run_id!==run.run_id || ['report','report_draft','review_result'].includes(artifact.kind)) fail('SPECIALIST_ARTIFACT_MISMATCH',409);
    try { verifyArtifact(artifact); } catch { fail('SPECIALIST_ARTIFACT_INVALID',409); }
    if (!validations.some(validation=>validation.org_id===run.org_id && validation.run_id===run.run_id && validation.artifact_id===artifact.artifact_id && validation.valid)) fail('SPECIALIST_ARTIFACT_VALIDATION_REQUIRED',409);
    if (!stages.some(stage=>stage.task_id===artifact.task_id && stage.status==='succeeded')) fail('SPECIALIST_STAGES_INCOMPLETE',409);
    for (const id of artifact.input_refs) {
      const input = outputs.find(value=>value.artifact.artifact_id===id)?.artifact;
      if (!input) fail('SPECIALIST_ARTIFACT_LINEAGE_MISMATCH',409);
      verify(input);
    }
  };
  verify(output);
  return output;
}

export function specialistResultParts(run: AnalysisRun, artifact: Artifact): {content:string;parts:MessagePart[]} {
  const content = `Completed ${run.request.agent_target} analysis. The verified result is ready to inspect.`;
  return {content,parts:[{type:'text',text:content},{type:'run_ref',run_id:run.run_id,status:'succeeded'},
    {type:'artifact_ref',run_id:run.run_id,artifact_id:artifact.artifact_id,kind:artifact.kind}]};
}

export async function finishAgentArtifactRun(db: Driver, lease: Lease, artifactId: string): Promise<void> {
  await db.transaction(async tx=>{
    const run = await fenceRun(tx,lease);
    const artifact = await verifiedSpecialistResult(tx,run,artifactId);
    run.status='succeeded';
    run.lease_until=null;
    await updateRun(tx,run);
    await syncAgentInvocationsFromRun(tx,run.org_id,run.run_id);
    const date = new Date().toISOString();
    const event = {event_id:randomUUID(),run_id:run.run_id,org_id:run.org_id,task_id:artifact.task_id,created_at:date,message:`${run.request.agent_target}: artifact completed`};
    await tx.query('INSERT INTO events(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)',[run.org_id,event.event_id,run.run_id,JSON.stringify(event)]);
    await finishRunAssistant(tx,run,{status:'completed',...specialistResultParts(run,artifact)});
    if (run.request.conversation_id) {
      await tx.query("UPDATE conversations SET context=context || jsonb_build_object('current_run_id',$3::text,'active_artifact_id',$4::text),updated_at=now() WHERE org_id=$1 AND id=$2",[run.org_id,run.request.conversation_id,run.run_id,artifact.artifact_id]);
      await tx.query(`INSERT INTO agent_memory(org_id,id,layer,conversation_id,run_id,scope_key,memory_key,summary,artifact_refs)
        VALUES($1,$2,'episodic',$3,$4,$3,$4,$5,$6::jsonb) ON CONFLICT(org_id,layer,scope_key,memory_key) DO NOTHING`,
        [run.org_id,randomUUID(),run.request.conversation_id,run.run_id,`Completed ${run.request.agent_target} analysis: ${run.request.question.slice(0,2000)}. Verified ${artifact.kind} result available.`,JSON.stringify([artifact.artifact_id])]);
    }
  });
}
