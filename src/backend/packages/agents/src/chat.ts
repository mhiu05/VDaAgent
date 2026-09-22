import {
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  type AgentDecision,
  type AgentTurnAccepted,
  type AgentTurnRequest,
  type ResolvedAgentTurnRequest,
  type Message,
  type MessagePart,
  type Role,
  type Scope,
  type SignalRef,
} from '@vda/contracts';
import type { AgentTurn, Repository, TurnContext } from '@vda/db';
import {
  createDecisionProvider,
  type AgentDecisionContext,
  type AgentDecisionProvider,
} from './provider';
import {
  createAnalysisTool,
  getAgentTargetFollowUp,
  getAnalysisResultTool,
  inspectSignalTool,
  isCausalQuestion,
  type AgentToolExecutionContext,
} from './tools';

const MAX_MESSAGE_CHARS = 600;
const MAX_CONTEXT_CHARS = 5_000;

const unsupportedText: Record<
  Extract<AgentDecision, { action: 'unsupported' }>['reason_code'],
  string
> = {
  UNSUPPORTED_REQUEST:
    'Yêu cầu này chưa thuộc các phân tích tồn kho được hỗ trợ. Bạn có thể hỏi về tồn kho hiện tại, hàng chậm luân chuyển, so sánh 7/30/90 ngày, phân phối giá hoặc báo cáo tồn kho.',
  UNSUPPORTED_CAUSAL_REQUEST:
    'Không thể xác định nguyên nhân từ các snapshot tồn kho đã xác thực. Bạn có thể kiểm tra tín hiệu, bằng chứng, phạm vi hoặc ngày dữ liệu được hỗ trợ.',
  UNSUPPORTED_SCOPE: 'Phạm vi được chọn chưa được hỗ trợ cho phân tích tồn kho này.',
  MISSING_CONTEXT: 'Cần chọn project và ngày dữ liệu hợp lệ trước khi bắt đầu phân tích.',
  NO_AUTHORIZED_RESULT: 'Không tìm thấy kết quả đã được cấp quyền trong ngữ cảnh hội thoại này.',
};

function turnContext(turn: AgentTurn, input: ResolvedAgentTurnRequest): TurnContext {
  return {
    org_id: input.org_id,
    conversation_id: turn.conversation.conversation_id,
    user_message_id: turn.user_message.message_id,
    assistant_message_id: turn.assistant_message.message_id,
    client_turn_id: input.client_turn_id,
  };
}

function compactMessages(messages: Message[]): AgentDecisionContext['recent_messages'] {
  const compacted: AgentDecisionContext['recent_messages'] = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (const message of messages.slice(-12)) {
    if (!remaining) break;
    const content = message.content.trim().slice(0, Math.min(MAX_MESSAGE_CHARS, remaining));
    if (!content) continue;
    compacted.push({ role: message.role, content });
    remaining -= content.length;
  }
  return compacted;
}

function assistantRunIds(messages: Message[]): string[] {
  const ids = [...messages]
    .reverse()
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === 'run_ref' ||
      part.type === 'signal_ref' ||
      part.type === 'decision_ref' ||
      part.type === 'drilldown_ref'
        ? [part.run_id]
        : [],
    );
  return [...new Set(ids)].slice(0, 5);
}

function runIds(messages: Message[], requestedSignalRef: SignalRef | null | undefined): string[] {
  const ids = [requestedSignalRef?.run_id, ...assistantRunIds(messages)].filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)].slice(0, 5);
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

type BuiltContext = {
  role: Role;
  context: AgentDecisionContext;
  analysis_scope: Scope;
  allowed_conversation_run_ids: string[];
};

export class ConversationContextBuilder {
  constructor(private readonly repository: Repository) {}
  async build(
    userId: string,
    inputValue: AgentTurnRequest,
    conversationId: string,
  ): Promise<BuiltContext> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    const [role, catalog, page] = await Promise.all([
      this.repository.authorize(userId, input.org_id),
      this.repository.catalog(userId, input.org_id),
      this.repository.listMessages(userId, input.org_id, conversationId, {
        limit: 12,
        cursor: null,
      }),
    ]);
    const conversationRunIds = assistantRunIds(page.messages);
    const candidates = runIds(page.messages, input.signal_ref);
    let activeBrief: AgentDecisionContext['active_brief'] = null;
    let activeDecision: NonNullable<AgentDecisionContext['active_decision']> | null = null;
    for (const runId of candidates) {
      try {
        const decision = await this.repository.decisionIntelligence(userId, input.org_id, runId);
        if (decision.status === 'available') {
          const pack = decision.decision_intelligence;
          activeDecision = {
            run_id: decision.run_id,
            scope: pack.decision_brief.scope,
            requested_data_as_of: pack.decision_brief.requested_data_as_of,
            effective_snapshot_date: pack.decision_brief.effective_snapshot_date,
            status: pack.decision_brief.status,
            priority_entities: pack.priority_entities.map((entity) => ({
              priority_entity_id: entity.priority_entity_id,
              label: entity.entity.label,
              rank: entity.rank,
              tier: entity.tier,
              support_level: entity.support_level,
              limitations: entity.limitations,
            })),
            action_candidates: pack.action_candidates.map((action) => ({
              action_candidate_id: action.action_candidate_id,
              label: action.label,
              support_level: action.support_level,
              drilldown_id: action.drilldown_id,
              limitations: action.limitations,
            })),
            drilldown_ids: pack.drilldowns.map((drilldown) => drilldown.drilldown_id),
            limitations: pack.decision_brief.limitations,
          };
        }
      } catch {
        // Historical runs may have only the v1 compatibility brief.
      }
      try {
        const brief = await this.repository.decisionBrief(userId, input.org_id, runId);
        const signals = [
          ...brief.decision_brief.current_state,
          ...brief.decision_brief.material_changes,
          ...brief.decision_brief.where_to_look,
          ...brief.decision_brief.data_quality,
        ];
        activeBrief = {
          run_id: brief.run_id,
          scope: brief.scope,
          requested_data_as_of: brief.requested_data_as_of,
          effective_snapshot_date: brief.effective_snapshot_date,
          signals: signals.map((signal) => ({
            signal_id: signal.signal_id,
            kind: signal.kind,
            dimension: signal.dimension,
            segment_key: signal.segment_key,
            supported_action: 'inspect_signal' as const,
            supported_next_action_ids: brief.decision_brief.next_actions
              .filter((action) => action.target_signal_id === signal.signal_id)
              .map((action) => action.action_id),
          })),
        };
      } catch {
        // A run without a validated briefing is not eligible for signal inspection.
      }
      if (activeDecision && activeBrief) break;
    }
    const requestedSignalRef =
      input.signal_ref &&
      activeBrief?.run_id === input.signal_ref.run_id &&
      activeBrief.signals.some((signal) => signal.signal_id === input.signal_ref?.signal_id)
        ? input.signal_ref
        : null;
    const activeResult = activeBrief ?? activeDecision;
    let analysisScope = input.scope;
    if (input.signal_action === 'analyze_segment') {
      const signal = activeBrief?.signals.find(
        (candidate) => candidate.signal_id === requestedSignalRef?.signal_id,
      );
      const project = activeBrief
        ? catalog.projects.find(
            (candidate) => candidate.project_external_id === activeBrief?.scope.project_external_id,
          )
        : undefined;
      if (
        !activeBrief ||
        !signal ||
        signal.dimension !== 'zone' ||
        !signal.segment_key ||
        !project?.zones.some((zone) => zone.zone_external_id === signal.segment_key)
      )
        throw new Error('SIGNAL_SCOPE_UNSUPPORTED');
      analysisScope = {
        project_external_id: activeBrief.scope.project_external_id,
        zone_external_id: signal.segment_key,
      };
    }
    return {
      role,
      analysis_scope: analysisScope,
      allowed_conversation_run_ids: conversationRunIds,
      context: {
        question: input.text,
        scope: analysisScope,
        data_as_of: input.data_as_of,
        scope_changed: activeResult ? !sameScope(analysisScope, activeResult.scope) : false,
        date_changed: activeResult ? input.data_as_of !== activeResult.requested_data_as_of : false,
        role,
        catalog: {
          projects: catalog.projects.slice(0, 50).map((project) => ({
            project_external_id: project.project_external_id,
            zones: project.zones.slice(0, 50),
          })),
          latest_snapshot_date: catalog.latest_snapshot_date,
        },
        recent_messages: compactMessages(page.messages),
        allowed_run_ids: candidates,
        active_brief: activeBrief,
        active_decision: activeDecision,
        requested_signal_ref: requestedSignalRef,
      },
    };
  }
}

export class AgentChatOrchestrator {
  private readonly contextBuilder: ConversationContextBuilder;
  constructor(
    private readonly repository: Repository,
    private readonly decisionProvider: AgentDecisionProvider = createDecisionProvider(),
  ) {
    this.contextBuilder = new ConversationContextBuilder(repository);
  }
  private async finalizeError(
    userId: string,
    context: TurnContext,
    code: string,
    retryable: boolean,
    content: string,
  ) {
    await this.repository.finalizeTurn(userId, context, {
      status: 'failed',
      content,
      parts: [
        { type: 'text', text: content },
        { type: 'error', code, retryable },
      ],
    });
  }
  async submit(
    userId: string,
    inputValue: AgentTurnRequest,
    idempotencyKey: string,
    conversationId?: string,
  ): Promise<AgentTurnAccepted> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    const turn = await this.repository.startTurn(userId, input, idempotencyKey, conversationId);
    const context = turnContext(turn, input);
    if (turn.idempotent_replay)
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: turn.assistant_message.run_id,
        assistant_status: turn.assistant_message.status,
      });
    let built: BuiltContext;
    try {
      built = await this.contextBuilder.build(userId, input, context.conversation_id);
    } catch {
      await this.finalizeError(
        userId,
        context,
        'CONTEXT_UNAVAILABLE',
        true,
        'Không thể tải ngữ cảnh workspace để chuẩn bị phân tích.',
      );
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: null,
        assistant_status: 'failed',
      });
    }
    const toolContext: AgentToolExecutionContext = {
      ...context,
      user_id: userId,
      role: built.role,
      question: input.text,
      scope: built.analysis_scope,
      data_as_of: input.data_as_of,
      use_case: input.use_case,
      agent_target: input.agent_target ?? null,
      signal_action: input.signal_action ?? null,
      idempotency_key: idempotencyKey,
      allowed_run_ids: built.context.allowed_run_ids,
      allowed_conversation_run_ids: built.allowed_conversation_run_ids,
      allowed_signal_refs: built.context.active_brief
        ? built.context.active_brief.signals.map((signal) => ({
            run_id: built.context.active_brief!.run_id,
            signal_id: signal.signal_id,
          }))
        : [],
      allowed_scopes: built.context.catalog.projects.flatMap((project) => [
        { project_external_id: project.project_external_id, zone_external_id: null },
        ...project.zones.map((zone) => ({
          project_external_id: project.project_external_id,
          zone_external_id: zone.zone_external_id,
        })),
      ]),
    };
    // Scope/date changes, canonical signal actions, and causal questions retain
    // their existing deterministic routing rather than becoming target lookups.
    if (
      input.agent_target &&
      !input.signal_action &&
      !isCausalQuestion(input.text) &&
      !built.context.scope_changed &&
      !built.context.date_changed
    ) {
      try {
        const target = await getAgentTargetFollowUp(this.repository, toolContext);
        if (target.kind === 'agent_target_follow_up') {
          await this.repository.finalizeTurn(userId, context, {
            status: 'completed',
            content: target.content,
            parts: [{ type: 'text', text: target.content }, ...target.parts],
            sender_agent: target.sender_agent,
          });
          return AgentTurnAcceptedSchema.parse({
            conversation_id: context.conversation_id,
            user_message_id: context.user_message_id,
            assistant_message_id: context.assistant_message_id,
            run_id: target.run.run_id,
            assistant_status: 'completed',
          });
        }
        if (target.kind === 'agent_target_unavailable') {
          const content = unsupportedText[target.reason_code];
          await this.repository.finalizeTurn(userId, context, {
            status: 'completed',
            content,
            parts: [{ type: 'text', text: content }],
          });
          return AgentTurnAcceptedSchema.parse({
            conversation_id: context.conversation_id,
            user_message_id: context.user_message_id,
            assistant_message_id: context.assistant_message_id,
            run_id: null,
            assistant_status: 'completed',
          });
        }
      } catch {
        await this.finalizeError(
          userId,
          context,
          'ANALYSIS_ACTION_FAILED',
          true,
          'Unable to load the requested authorized agent checkpoint.',
        );
        return AgentTurnAcceptedSchema.parse({
          conversation_id: context.conversation_id,
          user_message_id: context.user_message_id,
          assistant_message_id: context.assistant_message_id,
          run_id: null,
          assistant_status: 'failed',
        });
      }
    }
    let decision: AgentDecision;
    try {
      if (input.signal_action === 'inspect' && input.signal_ref)
        decision = {
          action: 'inspect_signal',
          run_id: input.signal_ref.run_id,
          signal_id: input.signal_ref.signal_id,
        };
      else if (input.signal_action === 'analyze_segment')
        decision = { action: 'create_analysis', focus: 'current_inventory' };
      else if (!built.context.requested_signal_ref && isCausalQuestion(input.text))
        decision = { action: 'unsupported', reason_code: 'UNSUPPORTED_CAUSAL_REQUEST' };
      else if (built.context.scope_changed || built.context.date_changed)
        decision = { action: 'create_analysis', focus: 'current_inventory' };
      else decision = await this.decisionProvider.decide(built.context);
    } catch {
      await this.finalizeError(
        userId,
        context,
        'ALL_AGENT_PROVIDERS_FAILED',
        true,
        'Dịch vụ định tuyến yêu cầu hiện chưa sẵn sàng. Bạn có thể thử lại với cùng yêu cầu.',
      );
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: null,
        assistant_status: 'failed',
      });
    }
    if (decision.action === 'unsupported') {
      await this.repository.finalizeTurn(userId, context, {
        status: 'completed',
        content: unsupportedText[decision.reason_code],
        parts: [{ type: 'text', text: unsupportedText[decision.reason_code] }],
      });
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: null,
        assistant_status: 'completed',
      });
    }
    try {
      if (decision.action === 'create_analysis') {
        const result = await createAnalysisTool(this.repository, toolContext, decision);
        if (result.kind !== 'created_analysis') throw new Error('TOOL_RESULT_MISMATCH');
        return AgentTurnAcceptedSchema.parse({
          conversation_id: context.conversation_id,
          user_message_id: context.user_message_id,
          assistant_message_id: context.assistant_message_id,
          run_id: result.run.run_id,
          assistant_status: 'in_progress',
        });
      }
      const result =
        decision.action === 'inspect_signal'
          ? await inspectSignalTool(this.repository, toolContext, decision)
          : await getAnalysisResultTool(this.repository, toolContext, decision);
      if (result.kind !== 'analysis_result' && result.kind !== 'signal_inspection')
        throw new Error('TOOL_RESULT_MISMATCH');
      const parts: MessagePart[] = [{ type: 'text', text: result.content }, ...result.parts];
      await this.repository.finalizeTurn(userId, context, {
        status: 'completed',
        content: result.content,
        parts,
      });
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: result.run.run_id,
        assistant_status: 'completed',
      });
    } catch {
      await this.finalizeError(
        userId,
        context,
        'ANALYSIS_ACTION_FAILED',
        true,
        'Không thể khởi tạo hoặc tải kết quả phân tích này.',
      );
      return AgentTurnAcceptedSchema.parse({
        conversation_id: context.conversation_id,
        user_message_id: context.user_message_id,
        assistant_message_id: context.assistant_message_id,
        run_id: null,
        assistant_status: 'failed',
      });
    }
  }
}
