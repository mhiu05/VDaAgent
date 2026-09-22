import {
  CreateAnalysisToolInputSchema,
  GetAnalysisResultToolInputSchema,
  InspectSignalToolInputSchema,
  type AnalysisRun,
  type AgentKey,
  type DecisionBrief,
  type DecisionSignal,
  type MessagePart,
  type Role,
  type SignalRef,
  type Scope,
  type UseCaseCapability,
  type UseCaseKey,
} from '@vda/contracts';
import type { Repository, TurnContext } from '@vda/db';
import { getUseCaseDefinition, supportsUseCaseCapability } from './use-cases';

export type AgentToolExecutionContext = TurnContext & {
  user_id: string;
  role: Role;
  question: string;
  scope: Scope;
  data_as_of: string;
  use_case: UseCaseKey;
  agent_target: AgentKey | null;
  /** Target routing never combines a specialist request with a signal action. */
  signal_action?: 'inspect' | 'analyze_segment' | null;
  idempotency_key: string;
  allowed_run_ids: readonly string[];
  /** Only persisted run references from this conversation, never user-supplied IDs. */
  allowed_conversation_run_ids: readonly string[];
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
    }
  | {
      kind: 'agent_target_follow_up';
      run: AnalysisRun;
      sender_agent: AgentKey;
      parts: MessagePart[];
      content: string;
    }
  | {
      kind: 'agent_target_unavailable';
      reason_code: 'UNSUPPORTED_REQUEST' | 'NO_AUTHORIZED_RESULT';
    };

export type AgentTargetFollowUpAction = 'artifact' | 'status';

type AgentTargetPolicy =
  | {
      action: 'artifact';
      capability: UseCaseCapability;
      artifact_key: string;
      content: string;
    }
  | { action: 'status'; capability: UseCaseCapability };

/**
 * This is deliberately a small, server-owned allowlist. The composer exposes
 * these same four targets; other persisted agent identities remain renderable
 * but are not automatically executable from a chat turn.
 */
const targetPolicies: Partial<Record<AgentKey, AgentTargetPolicy>> = {
  analyst: {
    action: 'artifact',
    capability: 'analyst_follow_up',
    artifact_key: 'analysis_pack',
    content: 'The Analyst Agent linked the existing validated analysis pack.',
  },
  comparison: {
    action: 'artifact',
    capability: 'comparison',
    artifact_key: 'comparison_pack',
    content: 'The Comparison Agent linked the existing validated comparison pack.',
  },
  chart: {
    action: 'artifact',
    capability: 'chart',
    artifact_key: 'chart_pack',
    content: 'The Chart Agent linked the existing validated chart pack.',
  },
  report: { action: 'status', capability: 'report_revision' },
};

const causalQuestionPattern =
  /\b(why did|why is|cause|caused|causal|root cause)\b|\b(tại sao|vì sao|nguyên nhân)\b/i;
const targetReferencePattern =
  /\b(show|open|view|display|link|retrieve)\b|(?:xem|mở|mo|hiển\s+thị|hien\s+thi|liên\s+kết|lien\s+ket)/i;
const targetExplanationPattern = /\b(explain|summari[sz]e|summary|findings?)\b/i;
const reportStatusPattern =
  /\b(status|progress|checkpoint|review|draft|ready|pending|completed)\b|(?:trạng\s+thái|tiến\s+độ|bản\s+nháp|kiểm\s+duyệt|sẵn\s+sàng|hoàn\s+thành)/i;
const unsafeTargetRequestPattern =
  /\b(create|generate|make|build|calculate|compute|run|rerun|refresh|edit|update|change|add|remove|delete|publish|send|export|download|upload|sql|query|select|insert|drop|alter|model|llm|prompt)\b|(?:tạo|sinh|làm|xây|tính|chạy|chỉnh\s+sửa|cập\s+nhật|thay\s+đổi|thêm|xóa|xuất|tải|truy\s+vấn)/i;
const unsupportedComparisonPattern =
  /\b(compare|contrast)\b.*\b(with|versus|vs)\b|(?:so\s+sánh).*(?:với|vs)/i;

export function isCausalQuestion(question: string): boolean {
  return causalQuestionPattern.test(question);
}

/**
 * Resolves only reference/status phrasing. It is not an NLP router: anything
 * that could ask a specialist to compute, generate, mutate, query, or explain
 * causality falls through to an explicit unsupported response.
 */
export function resolveAgentTargetFollowUpAction(
  target: AgentKey,
  question: string,
): AgentTargetFollowUpAction | null {
  const policy = targetPolicies[target];
  const text = question.trim();
  if (
    !policy ||
    !text ||
    isCausalQuestion(text) ||
    unsafeTargetRequestPattern.test(text) ||
    unsupportedComparisonPattern.test(text)
  )
    return null;
  if (policy.action === 'status') return reportStatusPattern.test(text) ? 'status' : null;
  return targetReferencePattern.test(text) || targetExplanationPattern.test(text)
    ? 'artifact'
    : null;
}

function mutationAllowed(role: Role): boolean {
  return role === 'owner' || role === 'analyst';
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

function sameTargetRequest(run: AnalysisRun, context: AgentToolExecutionContext): boolean {
  return (
    sameScope(run.request.scope, context.scope) &&
    run.request.data_as_of === context.data_as_of &&
    run.request.use_case === context.use_case
  );
}

async function authorizedConversationRuns(
  repository: Repository,
  context: AgentToolExecutionContext,
): Promise<AnalysisRun[]> {
  const runs: AnalysisRun[] = [];
  for (const runId of context.allowed_conversation_run_ids) {
    try {
      const { run } = await repository.getRun(context.user_id, context.org_id, runId);
      runs.push(run);
    } catch {
      // Conversation references are advisory until repository authorization
      // succeeds. A stale or corrupted reference never widens access.
    }
  }
  return runs;
}

async function optionalArtifactByKey(
  repository: Repository,
  context: AgentToolExecutionContext,
  runId: string,
  key: string,
) {
  try {
    return await repository.artifactByKey(context.user_id, context.org_id, runId, key);
  } catch {
    return undefined;
  }
}

async function validatedArtifactByKey(
  repository: Repository,
  context: AgentToolExecutionContext,
  runId: string,
  key: string,
) {
  const artifact = await optionalArtifactByKey(repository, context, runId, key);
  if (!artifact) return undefined;
  try {
    const { validations } = await repository.artifacts(context.user_id, context.org_id, runId);
    return validations.some(
      (validation) => validation.artifact_id === artifact.artifact_id && validation.valid,
    )
      ? artifact
      : undefined;
  } catch {
    return undefined;
  }
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
      use_case: context.use_case,
      agent_target: context.agent_target,
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
  const [{ artifacts }, reports, decision] = await Promise.all([
    repository.artifacts(context.user_id, context.org_id, parsed.run_id),
    repository.listReports(context.user_id, context.org_id),
    repository
      .decisionIntelligence(context.user_id, context.org_id, parsed.run_id)
      .catch(() => null),
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
  if (decision?.status === 'available')
    parts.push({
      type: 'decision_ref',
      run_id: run.run_id,
      component_id: decision.decision_intelligence.pack_id,
    });
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
      (reference) => reference.run_id === parsed.run_id && reference.signal_id === parsed.signal_id,
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
  const evidenceArtifactIds = [
    ...new Set(signal.evidence.map((reference) => reference.artifact_id)),
  ];
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

/**
 * Handles the explicit UI @Agent selector without sending target text to a
 * provider. It can only rehydrate a prior assistant-linked run in the same
 * scope/date/use-case. A target never starts a new run, queries snapshots,
 * computes metrics, invokes a model, or mutates a report.
 */
export async function getAgentTargetFollowUp(
  repository: Repository,
  context: AgentToolExecutionContext,
): Promise<
  Extract<AgentToolResult, { kind: 'agent_target_follow_up' | 'agent_target_unavailable' }>
> {
  const target = context.agent_target;
  if (!target || context.signal_action)
    return { kind: 'agent_target_unavailable', reason_code: 'UNSUPPORTED_REQUEST' };
  const policy = targetPolicies[target];
  if (!policy || resolveAgentTargetFollowUpAction(target, context.question) !== policy.action)
    return { kind: 'agent_target_unavailable', reason_code: 'UNSUPPORTED_REQUEST' };
  try {
    const definition = getUseCaseDefinition(context.use_case);
    if (!supportsUseCaseCapability(definition, policy.capability))
      return { kind: 'agent_target_unavailable', reason_code: 'UNSUPPORTED_REQUEST' };
  } catch {
    return { kind: 'agent_target_unavailable', reason_code: 'UNSUPPORTED_REQUEST' };
  }
  const candidates = await authorizedConversationRuns(repository, context);
  if (!candidates.length)
    return { kind: 'agent_target_unavailable', reason_code: 'NO_AUTHORIZED_RESULT' };
  const matching = candidates.filter((run) => sameTargetRequest(run, context));
  if (!matching.length)
    return { kind: 'agent_target_unavailable', reason_code: 'NO_AUTHORIZED_RESULT' };

  if (policy.action === 'artifact') {
    for (const run of matching) {
      if (run.status !== 'succeeded') continue;
      const artifact = await validatedArtifactByKey(
        repository,
        context,
        run.run_id,
        policy.artifact_key,
      );
      if (!artifact) continue;
      const decision = await repository
        .decisionIntelligence(context.user_id, context.org_id, run.run_id)
        .catch(() => null);
      const decisionPack =
        decision?.status === 'available' ? decision.decision_intelligence : null;
      const decisionArtifactIds =
        decisionPack
          ? new Set([
              decisionPack.data_analysis_pack_artifact_id,
              decisionPack.comparison_pack_artifact_id,
              decisionPack.chart_pack_artifact_id,
              decisionPack.analysis_pack_artifact_id,
              decisionPack.insight_pack_artifact_id,
            ])
          : null;
      return {
        kind: 'agent_target_follow_up',
        run,
        sender_agent: target,
        content: policy.content,
        parts: [
          { type: 'run_ref', run_id: run.run_id, status: run.status },
          ...(decisionArtifactIds?.has(artifact.artifact_id)
            ? [
                {
                  type: 'decision_ref' as const,
                  run_id: run.run_id,
                  component_id: decisionPack!.pack_id,
                },
              ]
            : []),
          {
            type: 'artifact_ref',
            run_id: run.run_id,
            artifact_id: artifact.artifact_id,
            kind: artifact.kind,
          },
        ],
      };
    }
    return { kind: 'agent_target_unavailable', reason_code: 'NO_AUTHORIZED_RESULT' };
  }

  // Report drafts and review results are private workflow artifacts. The
  // target exposes only a fixed checkpoint status to owner/analyst roles and
  // intentionally omits artifact IDs, hashes, prose, issues, and metrics.
  const role = await repository.authorize(context.user_id, context.org_id);
  if (!mutationAllowed(role))
    return { kind: 'agent_target_unavailable', reason_code: 'NO_AUTHORIZED_RESULT' };
  for (const run of matching) {
    const draft =
      (await optionalArtifactByKey(repository, context, run.run_id, 'report_draft:2')) ??
      (await optionalArtifactByKey(repository, context, run.run_id, 'report_draft:1'));
    if (!draft || draft.kind !== 'report_draft') continue;
    const review = await optionalArtifactByKey(
      repository,
      context,
      run.run_id,
      `review_result:${draft.payload.revision}`,
    );
    const content =
      review?.kind === 'review_result' && review.payload.status === 'REVISION_REQUIRED'
        ? 'The Report Agent checkpoint is in the deterministic bounded revision flow.'
        : review?.kind === 'review_result'
          ? 'The Report Agent checkpoint has a deterministic review result and remains publication-gated.'
          : 'The Report Agent persisted a reviewable draft checkpoint; deterministic review is pending.';
    return {
      kind: 'agent_target_follow_up',
      run,
      sender_agent: target,
      content,
      parts: [{ type: 'run_ref', run_id: run.run_id, status: run.status }],
    };
  }
  return { kind: 'agent_target_unavailable', reason_code: 'NO_AUTHORIZED_RESULT' };
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
