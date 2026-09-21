import {
  CreateAnalysisToolInputSchema,
  GetAnalysisResultToolInputSchema,
  InspectSignalToolInputSchema,
  type AnalysisRun,
  type DecisionBrief,
  type DecisionSignal,
  type MessagePart,
  type Role,
  type SignalRef,
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
  allowed_signal_refs: readonly SignalRef[];
  allowed_scopes: readonly Scope[];
};

export type AgentToolResult =
  | { kind: 'created_analysis'; run: AnalysisRun }
  | {
      kind: 'analysis_result';
      run: AnalysisRun;
      parts: MessagePart[];
      content: string;
    }
  | {
      kind: 'signal_inspection';
      run: AnalysisRun;
      parts: MessagePart[];
      content: string;
    };

function mutationAllowed(role: Role): boolean {
  return role === 'owner' || role === 'analyst';
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

export async function createAnalysisTool(
  repository: Repository,
  context: AgentToolExecutionContext,
  input: unknown,
): Promise<AgentToolResult> {
  const parsed = CreateAnalysisToolInputSchema.parse(input);
  const role = await repository.authorize(context.user_id, context.org_id, true);
  if (!mutationAllowed(role)) throw new Error('VIEWER_READ_ONLY');
  const scope = parsed.scope_ref ?? context.scope;
  if (!context.allowed_scopes.some((candidate) => sameScope(candidate, scope)))
    throw new Error('SCOPE_REFERENCE_FORBIDDEN');
  const run = await repository.attachRunToTurn(
    context.user_id,
    context,
    {
      org_id: context.org_id,
      scope,
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

function signalFromBrief(brief: DecisionBrief, signalId: string): DecisionSignal | undefined {
  return [
    ...brief.current_state,
    ...brief.material_changes,
    ...brief.where_to_look,
    ...brief.data_quality,
  ].find((signal) => signal.signal_id === signalId);
}

const signalInspectionContent =
  'Tín hiệu đã xác thực và bằng chứng liên quan được liên kết bên dưới.';

export async function inspectSignalTool(
  repository: Repository,
  context: AgentToolExecutionContext,
  input: unknown,
): Promise<AgentToolResult> {
  const parsed = InspectSignalToolInputSchema.parse(input);
  if (
    !context.allowed_signal_refs.some(
      (reference) =>
        reference.run_id === parsed.run_id && reference.signal_id === parsed.signal_id,
    )
  )
    throw new Error('SIGNAL_REFERENCE_FORBIDDEN');
  // decisionBrief performs membership, run/org authorization, artifact validation, and lineage checks again.
  const brief = await repository.decisionBrief(context.user_id, context.org_id, parsed.run_id);
  const signal = signalFromBrief(brief.decision_brief, parsed.signal_id);
  if (!signal) throw new Error('SIGNAL_REFERENCE_FORBIDDEN');
  const [{ run }, { artifacts }] = await Promise.all([
    repository.getRun(context.user_id, context.org_id, parsed.run_id),
    repository.artifacts(context.user_id, context.org_id, parsed.run_id),
  ]);
  const evidenceArtifactIds = [...new Set(signal.evidence.map((reference) => reference.artifact_id))];
  return {
    kind: 'signal_inspection',
    run,
    // Persist references instead of rendering the signal's values into a chat message.
    // The client rehydrates the validated signal and its evidence through the authorized brief API.
    content: signalInspectionContent,
    parts: [
      { type: 'run_ref', run_id: run.run_id, status: run.status },
      { type: 'signal_ref', run_id: run.run_id, signal_id: signal.signal_id },
      ...evidenceArtifactIds.flatMap((artifactId) => {
        const artifact = artifacts.find((candidate) => candidate.artifact_id === artifactId);
        return artifact
          ? [
              {
                type: 'artifact_ref' as const,
                run_id: run.run_id,
                artifact_id: artifact.artifact_id,
                kind: artifact.kind,
              },
            ]
          : [];
      }),
    ],
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

export const modelToolNames = ['create_analysis', 'get_analysis_result', 'inspect_signal'] as const;
