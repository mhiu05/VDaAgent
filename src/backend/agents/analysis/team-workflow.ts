import { z } from 'zod';
import type { Artifact, Claim } from '@vda/contracts';
import type { Lease, Repository } from '@vda/db';
import { bindClaims, canonical } from '@vda/domain';
import { createTeamContextBuilder } from '../runtime/context/team-context';
import { TeamRuntime } from '../runtime/team/executor';
import { ToolRegistry, ToolResultSchema, type ToolResult } from '../runtime/team/tools';
import { ANALYSIS_AGENT_DEFINITIONS } from '../runtime/team/definitions';
import {
  executeCoordinatorAndData,
  loadDataStageArtifacts,
  type AgentDataStageResult,
} from './stages/coordinator-data';
import {
  executeAnalystBranch,
  executeChartBranch,
  executeComparisonBranch,
} from './stages/branches';
import { executeInsightStage, executeReportDraftStage } from './stages/insight-report';
import {
  executeReportRevisionStage,
  executeReviewerStage,
  loadReportDraftStage,
  type AgentReviewStageResult,
} from './stages/reviewer';
import { createProvider, type NarrativeContext } from '../providers/narrative';
import type { AgentWorkflowOptions } from './options';

const INSIGHT_COMPOSE_TOOL_TIMEOUT_MS = 300_000;

function result(summary: string, outputs: object): ToolResult {
  const artifacts = Object.values(outputs).filter(
    (value): value is Artifact =>
      value !== null && typeof value === 'object' && 'artifact_id' in value && 'kind' in value,
  );
  const publicArtifacts = artifacts.filter(
    (value) => !['report_draft', 'review_result'].includes(value.kind),
  );
  return {
    summary,
    artifact_refs: publicArtifacts.map((value) => value.artifact_id).slice(0, 100),
    evidence_refs: publicArtifacts
      .flatMap((value) => {
        const payload = value.payload as {
          evidence_refs?: Array<{ artifact_id: string; path: string }>;
        };
        return (payload.evidence_refs ?? []).map((ref) => `${ref.artifact_id}:${ref.path}`);
      })
      .slice(0, 100),
  };
}

/** Existing immutable analysis stages are the tools of reusable agent definitions. */
async function executeTeam(
  repository: Repository,
  lease: Lease,
  options: AgentWorkflowOptions,
  specialist?: 'data' | 'comparison' | 'chart' | 'analyst' | 'insight',
): Promise<{ review?: AgentReviewStageResult; output: ToolResult }> {
  const tools = new ToolRegistry();
  const buildContext = createTeamContextBuilder(repository);
  const run = lease.run;
  let review: AgentReviewStageResult | undefined;
  let dataCheckpoint: AgentDataStageResult | undefined;
  let insightClaims: Claim[] | undefined;
  let insightContext: NarrativeContext | undefined;
  const registerStage = (
    name: string,
    agent: string,
    description: string,
    execute: () => Promise<object>,
    timeoutMs = 240000,
  ) => {
    tools.register({
      name,
      description,
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultSchema,
      allowedAgents: [agent],
      timeoutMs,
      riskLevel: 'write',
      executionMode: 'internal',
      execute: async () => result(description, await execute()),
      normalizeResult: (output) => output,
    });
  };
  registerStage(
    'data.analyze',
    'data',
    'Đã lấy dữ liệu được xác thực và chỉ số xác định',
    async () => {
      dataCheckpoint = await executeCoordinatorAndData(repository, lease);
      return dataCheckpoint;
    },
  );
  registerStage(
    'comparison.calculate',
    'comparison',
    'Đã xác thực so sánh theo kỳ và phân khúc',
    () => executeComparisonBranch(repository, lease, dataCheckpoint),
  );
  registerStage('chart.build', 'chart', 'Đã tạo biểu đồ gắn với bằng chứng', () =>
    executeChartBranch(repository, lease, dataCheckpoint),
  );
  registerStage('analyst.analyze', 'analyst', 'Đã chuẩn bị các phát hiện có căn cứ', () =>
    executeAnalystBranch(repository, lease, dataCheckpoint),
  );
  registerStage(
    'report.draft',
    'report',
    'Đã chuẩn bị bản nháp báo cáo để rà soát bằng chứng',
    () => executeReportDraftStage(repository, lease),
  );
  registerStage('report.revise', 'report', 'Đã lưu chỉnh sửa thành phiên bản nháp mới', () =>
    executeReportRevisionStage(repository, lease),
  );
  registerStage(
    'reviewer.check',
    'reviewer',
    'Đã rà soát bằng chứng và tính nhất quán của báo cáo',
    async () => {
      const latest = await loadReportDraftStage(repository, lease);
      review = await executeReviewerStage(repository, lease, {
        provider: options.reviewerProvider,
        correction:
          latest.report_draft.payload.revision === 1
            ? options.firstReviewCorrection
            : options.secondReviewCorrection,
      });
      return review;
    },
  );
  tools.register({
    name: 'data.evidence',
    description: 'Lấy chỉ số và bằng chứng phân nhóm đã xác thực cho tác nhân nhận định',
    inputSchema: z.object({}).strict(),
    outputSchema: ToolResultSchema,
    allowedAgents: ['data'],
    timeoutMs: 30000,
    riskLevel: 'read',
    executionMode: 'internal',
    execute: async () => {
      const data = dataCheckpoint ?? (await loadDataStageArtifacts(repository, lease));
      // Raw evidence stays in the immutable artifact store and trusted stage
      // adapter. Only compact counts/references cross the agent tool boundary.
      insightClaims = bindClaims(data.calculation);
      return {
        ...result('Đã chuyển chỉ số và bằng chứng phân nhóm cho tác nhân nhận định', {
          calculation: data.calculation,
          data_analysis_pack: data.data_analysis_pack,
        }),
        structured_data: {
          claim_count: insightClaims.length,
          breakdown_count: data.calculation.payload.breakdowns.length,
        },
        raw_result_ref: data.calculation.artifact_id,
      };
    },
    normalizeResult: (value) => value,
  });
  registerStage(
    'insight.compose',
    'insight',
    'Đã tổng hợp nhận định từ dữ liệu và so sánh đã xác thực',
    async () => {
      if (!insightClaims) throw new Error('INSIGHT_EVIDENCE_REQUIRED');
      const provider = options.narrativeProvider ?? createProvider();
      return executeInsightStage(repository, lease, {
        narrate: async (claims) => {
          if (canonical(insightClaims) !== canonical(claims))
            throw new Error('INSIGHT_EVIDENCE_MISMATCH');
          return provider.narrate(insightClaims!, insightContext);
        },
      });
    },
    INSIGHT_COMPOSE_TOOL_TIMEOUT_MS,
  );

  const runtime = new TeamRuntime({
    tools,
    signal: options.signal,
    // recordRuntimeActivity checks membership, expiry and fencing on every
    // start/completion in its transaction. Stage operations recheck the same
    // fence at their own writes; a separate identical read here only doubles
    // boundary transactions without closing an additional race.
    authorize: async () => undefined,
    emit: (activity) => repository.recordRuntimeActivity(lease, activity),
    buildContext: (agent, task) =>
      buildContext({
        userId: run.created_by,
        orgId: run.org_id,
        conversationId: run.request.conversation_id,
        runId: run.run_id,
        agentKey: agent.id,
        task,
        allowedTools: agent.allowed_tools,
        instructions: agent.instructions,
      }),
  });
  for (const definition of ANALYSIS_AGENT_DEFINITIONS) {
    runtime.register({
      definition,
      allowedDelegates:
        definition.id === 'coordinator'
          ? ANALYSIS_AGENT_DEFINITIONS.filter((agent) => agent.id !== 'coordinator').map(
              (agent) => agent.id,
            )
          : definition.id === 'insight'
            ? ['data', 'comparison', 'chart', 'analyst']
            : specialist && ['comparison', 'chart', 'analyst'].includes(definition.id)
              ? ['data']
              : [],
      inputSchema: z
        .object({ operation: z.enum(['execute', 'evidence', 'revise']).default('execute') })
        .strict(),
      execute: async (input, context) => {
        if (definition.id === 'insight') {
          const prepared = z
            .object({ instructions: z.string(), context: z.record(z.string(), z.unknown()) })
            .parse(context.context);
          insightContext = { ...prepared, signal: context.signal };
        }
        if (
          specialist === definition.id &&
          specialist !== 'data' &&
          context.invocationId === `team:${specialist}`
        ) {
          await context.requestAgent(
            'data',
            'Lấy và xác thực dữ liệu cho tác nhân chuyên trách',
            {},
            `team:${specialist}:data`,
          );
          if (specialist === 'insight') {
            const branches = await Promise.allSettled([
              context.requestAgent(
                'comparison',
                'So sánh các kỳ và phân khúc liên quan',
                {},
                'team:insight:comparison',
              ),
              context.requestAgent(
                'chart',
                'Tạo biểu đồ hỗ trợ bằng chứng',
                {},
                'team:insight:chart',
              ),
              context.requestAgent(
                'analyst',
                'Xác định các phát hiện hỗ trợ có căn cứ',
                {},
                'team:insight:analyst',
              ),
            ]);
            const failed = branches.find(
              (branch): branch is PromiseRejectedResult => branch.status === 'rejected',
            );
            if (failed) throw failed.reason;
          }
        }
        switch (definition.id) {
          case 'coordinator': {
            await context.requestAgent(
              'data',
              'Lấy và xác thực dữ liệu cùng chỉ số xác định',
              {},
              'team:data',
            );
            const branches = await Promise.allSettled([
              context.requestAgent(
                'comparison',
                'So sánh các kỳ và phân khúc',
                {},
                'team:comparison',
              ),
              context.requestAgent('chart', 'Tạo biểu đồ gắn với bằng chứng', {}, 'team:chart'),
              context.requestAgent(
                'analyst',
                'Xác định các phát hiện có căn cứ',
                {},
                'team:analyst',
              ),
            ]);
            const failed = branches.find(
              (branch): branch is PromiseRejectedResult => branch.status === 'rejected',
            );
            if (failed) throw failed.reason;
            await context.requestAgent(
              'insight',
              'Diễn giải phát hiện đã xác thực và lấy dữ liệu hỗ trợ',
              {},
              'team:insight',
            );
            await context.requestAgent(
              'report',
              'Soạn bản nháp báo cáo có cấu trúc',
              {},
              'team:report',
            );
            await context.requestAgent(
              'reviewer',
              'Rà soát bằng chứng và tính nhất quán của báo cáo',
              {},
              'team:reviewer',
            );
            if (
              review?.review_result.payload.status === 'REVISION_REQUIRED' &&
              review.report_draft.payload.revision === 1
            ) {
              await context.requestAgent(
                'report',
                'Áp dụng chỉnh sửa của người rà soát thành bản nháp mới',
                { operation: 'revise' },
                'team:report:revision',
              );
              await context.requestAgent(
                'reviewer',
                'Rà soát bản báo cáo đã chỉnh sửa',
                {},
                'team:reviewer:revision',
              );
            }
            return result(
              review?.review_result.payload.status === 'PASS'
                ? 'Báo cáo đã xác thực, sẵn sàng phát hành'
                : 'Báo cáo cần được chỉnh sửa sau rà soát',
              {},
            );
          }
          case 'data':
            return context.callTool(
              input.operation === 'evidence' ? 'data.evidence' : 'data.analyze',
              {},
            );
          case 'comparison':
            return context.callTool('comparison.calculate', {});
          case 'chart':
            return context.callTool('chart.build', {});
          case 'analyst':
            return context.callTool('analyst.analyze', {});
          case 'insight': {
            const evidence = await context.requestAgent(
              'data',
              'Lấy chỉ số và bằng chứng phân nhóm hỗ trợ nhận định',
              { operation: 'evidence' },
              'team:insight:data-detail',
            );
            const parsed = z
              .object({ claim_count: z.number().int().nonnegative() })
              .parse(evidence.structured_data);
            if (
              !evidence.raw_result_ref ||
              !evidence.artifact_refs.includes(evidence.raw_result_ref) ||
              parsed.claim_count !== insightClaims?.length
            )
              throw new Error('INSIGHT_EVIDENCE_MISMATCH');
            return context.callTool('insight.compose', {});
          }
          case 'report':
            return context.callTool(
              input.operation === 'revise' ? 'report.revise' : 'report.draft',
              {},
            );
          case 'reviewer':
            return context.callTool('reviewer.check', {});
          default:
            throw new Error('AGENT_IMPLEMENTATION_MISSING');
        }
      },
    });
  }
  const output = await runtime.run(
    specialist ?? 'coordinator',
    run.request.question,
    {},
    specialist ? `team:${specialist}` : 'team:main',
  );
  return { review, output };
}

export async function executeTeamThroughReview(
  repository: Repository,
  lease: Lease,
  options: AgentWorkflowOptions,
): Promise<AgentReviewStageResult> {
  const { review } = await executeTeam(repository, lease, options);
  if (!review) throw new Error('REVIEW_RESULT_REQUIRED');
  return review;
}

const specialistArtifacts = {
  data: 'data_analysis_pack',
  comparison: 'comparison_pack',
  chart: 'chart_pack',
  analyst: 'analysis_pack',
  insight: 'insight_pack',
} as const;
export function isArtifactSpecialist(
  target: string | null | undefined,
): target is keyof typeof specialistArtifacts {
  return typeof target === 'string' && Object.hasOwn(specialistArtifacts, target);
}

/** Specialist tasks complete with their own validated artifact and never require a report. */
export async function executeSpecialistWorkflow(
  repository: Repository,
  lease: Lease,
  options: AgentWorkflowOptions = {},
): Promise<Artifact> {
  const target = lease.run.request.agent_target;
  if (!isArtifactSpecialist(target)) throw new Error('ARTIFACT_SPECIALIST_REQUIRED');
  try {
    await executeTeam(repository, lease, options, target);
    const artifact = await repository.artifactByKey(
      lease.run.created_by,
      lease.run.org_id,
      lease.run.run_id,
      specialistArtifacts[target],
    );
    await repository.finishAgentArtifactRun(lease, artifact.artifact_id);
    return artifact;
  } catch (error) {
    try {
      await repository.failRun(
        lease,
        error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message)
          ? error.message
          : 'SPECIALIST_WORKFLOW_FAILED',
      );
    } catch {
      /* A terminal run or newer owner retains authority. */
    }
    throw error;
  }
}
