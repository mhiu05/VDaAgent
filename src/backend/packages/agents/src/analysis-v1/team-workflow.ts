import { z } from 'zod';
import type { Artifact, Claim } from '@vda/contracts';
import type { Lease, Repository } from '@vda/db';
import { bindClaims, canonical } from '@vda/domain';
import { createTeamContextBuilder } from '../runtime/context/team-context';
import { TeamRuntime } from '../runtime/team/runtime';
import { ToolRegistry, ToolResultSchema, type ToolResult } from '../runtime/team/tools';
import { ANALYSIS_AGENT_DEFINITIONS } from '../runtime/team/definitions';
import { executeCoordinatorAndData, loadDataStageArtifacts, type AgentDataStageResult } from './stages/coordinator-data';
import { executeAnalystBranch, executeChartBranch, executeComparisonBranch } from './stages/branches';
import { executeInsightStage, executeReportDraftStage } from './stages/insight-report';
import { executeReportRevisionStage, executeReviewerStage, loadReportDraftStage, type AgentReviewStageResult } from './stages/reviewer';
import { createProvider, type NarrativeContext } from '../legacy-workflow/narrative/provider';
import type { AgentWorkflowOptions } from './options';

function result(summary: string, outputs: object): ToolResult {
  const artifacts = Object.values(outputs).filter((value): value is Artifact =>
    value !== null && typeof value === 'object' && 'artifact_id' in value && 'kind' in value);
  const publicArtifacts = artifacts.filter(value => !['report_draft', 'review_result'].includes(value.kind));
  return { summary, artifact_refs: publicArtifacts.map(value => value.artifact_id).slice(0, 100),
    evidence_refs: publicArtifacts.flatMap(value => {
      const payload = value.payload as { evidence_refs?: Array<{artifact_id: string; path: string}> };
      return (payload.evidence_refs ?? []).map(ref => `${ref.artifact_id}:${ref.path}`);
    }).slice(0, 100) };
}

/** Existing immutable analysis stages are the tools of reusable agent definitions. */
async function executeTeam(
  repository: Repository, lease: Lease, options: AgentWorkflowOptions,
  specialist?: 'data' | 'comparison' | 'chart' | 'analyst' | 'insight',
): Promise<{ review?: AgentReviewStageResult; output: ToolResult }> {
  const tools = new ToolRegistry();
  const buildContext = createTeamContextBuilder(repository);
  const run = lease.run;
  let review: AgentReviewStageResult | undefined;
  let dataCheckpoint: AgentDataStageResult | undefined;
  let insightClaims: Claim[] | undefined;
  let insightContext: NarrativeContext | undefined;
  const registerStage = (name: string, agent: string, description: string, execute: () => Promise<object>) => {
    tools.register({ name, description, inputSchema: z.object({}).strict(), outputSchema: ToolResultSchema,
      allowedAgents: [agent], timeoutMs: 240000, riskLevel: 'write', executionMode: 'internal',
      execute: async () => result(description, await execute()), normalizeResult: output => output });
  };
  registerStage('data.analyze', 'data', 'Validated data and deterministic metrics retrieved', async () => {
    dataCheckpoint = await executeCoordinatorAndData(repository, lease);
    return dataCheckpoint;
  });
  registerStage('comparison.calculate', 'comparison', 'Period and segment comparisons validated', () => executeComparisonBranch(repository, lease, dataCheckpoint));
  registerStage('chart.build', 'chart', 'Evidence-linked charts created', () => executeChartBranch(repository, lease, dataCheckpoint));
  registerStage('analyst.analyze', 'analyst', 'Deterministic analytical findings prepared', () => executeAnalystBranch(repository, lease, dataCheckpoint));
  registerStage('report.draft', 'report', 'Report draft assembled for evidence review', () => executeReportDraftStage(repository, lease));
  registerStage('report.revise', 'report', 'Requested report corrections saved as a new draft version', () => executeReportRevisionStage(repository, lease));
  registerStage('reviewer.check', 'reviewer', 'Report evidence and consistency reviewed', async () => {
    const latest = await loadReportDraftStage(repository, lease);
    review = await executeReviewerStage(repository, lease, { provider: options.reviewerProvider,
      correction: latest.report_draft.payload.revision === 1 ? options.firstReviewCorrection : options.secondReviewCorrection });
    return review;
  });
  tools.register({ name: 'data.evidence', description: 'Retrieve verified metrics and breakdown evidence for Insight Agent',
    inputSchema: z.object({}).strict(), outputSchema: ToolResultSchema, allowedAgents: ['data'],
    timeoutMs: 30000, riskLevel: 'read', executionMode: 'internal',
    execute: async () => {
      const data = dataCheckpoint ?? await loadDataStageArtifacts(repository, lease);
      // Raw evidence stays in the immutable artifact store and trusted stage
      // adapter. Only compact counts/references cross the agent tool boundary.
      insightClaims = bindClaims(data.calculation);
      return { ...result('Returned verified metrics and breakdown evidence to Insight Agent', { calculation: data.calculation, data_analysis_pack: data.data_analysis_pack }),
        structured_data: { claim_count: insightClaims.length, breakdown_count: data.calculation.payload.breakdowns.length },
        raw_result_ref: data.calculation.artifact_id };
    }, normalizeResult: value => value });
  registerStage('insight.compose', 'insight', 'Grounded findings assembled from verified data and comparisons', async () => {
    if (!insightClaims) throw new Error('INSIGHT_EVIDENCE_REQUIRED');
    const provider = options.narrativeProvider ?? createProvider();
    return executeInsightStage(repository, lease, { narrate: async claims => {
      if (canonical(insightClaims) !== canonical(claims)) throw new Error('INSIGHT_EVIDENCE_MISMATCH');
      return provider.narrate(insightClaims!, insightContext);
    } });
  });

  const runtime = new TeamRuntime({ tools, signal: options.signal,
    // recordRuntimeActivity checks membership, expiry and fencing on every
    // start/completion in its transaction. Stage operations recheck the same
    // fence at their own writes; a separate identical read here only doubles
    // boundary transactions without closing an additional race.
    authorize: async () => undefined,
    emit: activity => repository.recordRuntimeActivity(lease, activity),
    buildContext: (agent, task) => buildContext({ userId: run.created_by, orgId: run.org_id,
      conversationId: run.request.conversation_id, runId: run.run_id, agentKey: agent.id, task,
      allowedTools: agent.allowed_tools, instructions: agent.instructions }),
  });
  for (const definition of ANALYSIS_AGENT_DEFINITIONS) {
    runtime.register({ definition,
      allowedDelegates: definition.id === 'coordinator' ? ANALYSIS_AGENT_DEFINITIONS.filter(agent => agent.id !== 'coordinator').map(agent => agent.id)
        : definition.id === 'insight' ? ['data', 'comparison', 'chart', 'analyst']
        : specialist && ['comparison', 'chart', 'analyst'].includes(definition.id) ? ['data'] : [],
      inputSchema: z.object({ operation: z.enum(['execute', 'evidence', 'revise']).default('execute') }).strict(),
      execute: async (input, context) => {
        if (definition.id === 'insight') {
          const prepared = z.object({ instructions: z.string(), context: z.record(z.string(), z.unknown()) }).parse(context.context);
          insightContext = { ...prepared, signal: context.signal };
        }
        if (specialist === definition.id && specialist !== 'data' && context.invocationId === `team:${specialist}`) {
          await context.requestAgent('data', 'Retrieve and validate the dataset needed for this specialist task', {}, `team:${specialist}:data`);
          if (specialist === 'insight') {
            const branches = await Promise.allSettled([
              context.requestAgent('comparison', 'Compare the supporting periods and segments', {}, 'team:insight:comparison'),
              context.requestAgent('chart', 'Build supporting evidence visualizations', {}, 'team:insight:chart'),
              context.requestAgent('analyst', 'Identify deterministic supporting findings', {}, 'team:insight:analyst'),
            ]);
            const failed = branches.find((branch): branch is PromiseRejectedResult => branch.status === 'rejected');
            if (failed) throw failed.reason;
          }
        }
        switch (definition.id) {
          case 'coordinator': {
            await context.requestAgent('data', 'Retrieve and validate the dataset and deterministic metrics', {}, 'team:data');
            const branches = await Promise.allSettled([
              context.requestAgent('comparison', 'Compare periods and segments', {}, 'team:comparison'),
              context.requestAgent('chart', 'Build evidence-linked charts', {}, 'team:chart'),
              context.requestAgent('analyst', 'Identify deterministic findings', {}, 'team:analyst'),
            ]);
            const failed = branches.find((branch): branch is PromiseRejectedResult => branch.status === 'rejected');
            if (failed) throw failed.reason;
            await context.requestAgent('insight', 'Interpret validated findings and request supporting data', {}, 'team:insight');
            await context.requestAgent('report', 'Assemble a structured report draft', {}, 'team:report');
            await context.requestAgent('reviewer', 'Review evidence and report consistency', {}, 'team:reviewer');
            if (review?.review_result.payload.status === 'REVISION_REQUIRED' && review.report_draft.payload.revision === 1) {
              await context.requestAgent('report', 'Apply reviewer corrections as a new immutable revision', { operation: 'revise' }, 'team:report:revision');
              await context.requestAgent('reviewer', 'Review the corrected report revision', {}, 'team:reviewer:revision');
            }
            return result(review?.review_result.payload.status === 'PASS' ? 'Validated report ready for publication' : 'Report review requires corrections', {});
          }
          case 'data': return context.callTool(input.operation === 'evidence' ? 'data.evidence' : 'data.analyze', {});
          case 'comparison': return context.callTool('comparison.calculate', {});
          case 'chart': return context.callTool('chart.build', {});
          case 'analyst': return context.callTool('analyst.analyze', {});
          case 'insight': {
            const evidence = await context.requestAgent('data', 'Retrieve the verified metrics and breakdown evidence supporting these findings', { operation: 'evidence' }, 'team:insight:data-detail');
            const parsed = z.object({ claim_count: z.number().int().nonnegative() }).parse(evidence.structured_data);
            if (!evidence.raw_result_ref || !evidence.artifact_refs.includes(evidence.raw_result_ref)
              || parsed.claim_count !== insightClaims?.length) throw new Error('INSIGHT_EVIDENCE_MISMATCH');
            return context.callTool('insight.compose', {});
          }
          case 'report': return context.callTool(input.operation === 'revise' ? 'report.revise' : 'report.draft', {});
          case 'reviewer': return context.callTool('reviewer.check', {});
          default: throw new Error('AGENT_IMPLEMENTATION_MISSING');
        }
      },
    });
  }
  const output = await runtime.run(specialist ?? 'coordinator', run.request.question, {}, specialist ? `team:${specialist}` : 'team:main');
  return { review, output };
}

export async function executeTeamThroughReview(repository: Repository, lease: Lease, options: AgentWorkflowOptions): Promise<AgentReviewStageResult> {
  const { review } = await executeTeam(repository, lease, options);
  if (!review) throw new Error('REVIEW_RESULT_REQUIRED');
  return review;
}

const specialistArtifacts = { data: 'data_analysis_pack', comparison: 'comparison_pack', chart: 'chart_pack', analyst: 'analysis_pack', insight: 'insight_pack' } as const;
export function isArtifactSpecialist(target: string | null | undefined): target is keyof typeof specialistArtifacts {
  return typeof target === 'string' && Object.hasOwn(specialistArtifacts, target);
}

/** Specialist tasks complete with their own validated artifact and never require a report. */
export async function executeSpecialistWorkflow(repository: Repository, lease: Lease, options: AgentWorkflowOptions = {}): Promise<Artifact> {
  const target = lease.run.request.agent_target;
  if (!isArtifactSpecialist(target)) throw new Error('ARTIFACT_SPECIALIST_REQUIRED');
  try {
    await executeTeam(repository, lease, options, target);
    const artifact = await repository.artifactByKey(lease.run.created_by, lease.run.org_id, lease.run.run_id, specialistArtifacts[target]);
    await repository.finishAgentArtifactRun(lease, artifact.artifact_id);
    return artifact;
  } catch (error) {
    try { await repository.failRun(lease, error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'SPECIALIST_WORKFLOW_FAILED'); }
    catch { /* A terminal run or newer owner retains authority. */ }
    throw error;
  }
}
