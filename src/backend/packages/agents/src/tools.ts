import {
  CreateAnalysisToolInputSchema,
  GetAnalysisResultToolInputSchema,
  type AnalysisRun,
  type MessagePart,
  type Role,
  type Scope,
} from '@vda/contracts';
import type { Repository, TurnContext } from '@vda/db';

export type AgentToolExecutionContext = TurnContext & {
  user_id: string;
  role: Role;
  question: string;
  scope: Scope;
  data_as_of: string;
  idempotency_key: string;
  allowed_run_ids: readonly string[];
};

export type AgentToolResult =
  | { kind: 'created_analysis'; run: AnalysisRun }
  | {
      kind: 'analysis_result';
      run: AnalysisRun;
      parts: MessagePart[];
      content: string;
    };

function mutationAllowed(role: Role): boolean {
  return role === 'owner' || role === 'analyst';
}

export async function createAnalysisTool(
  repository: Repository,
  context: AgentToolExecutionContext,
  input: unknown,
): Promise<AgentToolResult> {
  CreateAnalysisToolInputSchema.parse(input);
  const role = await repository.authorize(context.user_id, context.org_id, true);
  if (!mutationAllowed(role)) throw new Error('VIEWER_READ_ONLY');
  const run = await repository.attachRunToTurn(
    context.user_id,
    context,
    {
      org_id: context.org_id,
      scope: context.scope,
      data_as_of: context.data_as_of,
      question: context.question,
      conversation_id: context.conversation_id,
    },
    context.idempotency_key,
  );
  return { kind: 'created_analysis', run };
}

export async function getAnalysisResultTool(
  repository: Repository,
  context: AgentToolExecutionContext,
  input: unknown,
): Promise<AgentToolResult> {
  const parsed = GetAnalysisResultToolInputSchema.parse(input);
  if (!context.allowed_run_ids.includes(parsed.run_id)) throw new Error('RUN_REFERENCE_FORBIDDEN');
  const { run } = await repository.getRun(context.user_id, context.org_id, parsed.run_id);
  const [{ artifacts }, reports] = await Promise.all([
    repository.artifacts(context.user_id, context.org_id, parsed.run_id),
    repository.listReports(context.user_id, context.org_id),
  ]);
  const report = reports.find((item) => item.run_id === parsed.run_id);
  const parts: MessagePart[] = [
    { type: 'run_ref', run_id: run.run_id, status: run.status },
    ...artifacts.map((artifact) => ({
      type: 'artifact_ref' as const,
      run_id: run.run_id,
      artifact_id: artifact.artifact_id,
      kind: artifact.kind,
    })),
  ];
  if (report) parts.push({ type: 'report_ref', run_id: run.run_id, report_id: report.report_id });
  return {
    kind: 'analysis_result',
    run,
    content: 'Đây là kết quả phân tích đã được xác thực cho workspace hiện tại.',
    parts,
  };
}

export async function cancelAnalysisTool(
  repository: Repository,
  context: Pick<AgentToolExecutionContext, 'user_id' | 'org_id' | 'role' | 'allowed_run_ids'>,
  runId: string,
): Promise<void> {
  if (!context.allowed_run_ids.includes(runId)) throw new Error('RUN_REFERENCE_FORBIDDEN');
  const role = await repository.authorize(context.user_id, context.org_id, true);
  if (!mutationAllowed(role)) throw new Error('VIEWER_READ_ONLY');
  await repository.cancelRun(context.user_id, context.org_id, runId);
}

export const modelToolNames = ['create_analysis', 'get_analysis_result'] as const;
