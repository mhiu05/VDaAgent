import {
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  type AgentDecision,
  type AgentTurnAccepted,
  type AgentTurnRequest,
  type ResolvedAgentTurnRequest,
  type MessagePart,
} from '@vda/contracts';
import type { AgentTurn, Repository, TurnContext } from '@vda/db';
import { ConversationContextBuilder, type BuiltContext } from './context-builder';
import { createDecisionProvider, type AgentDecisionProvider } from './provider';
import {
  createAnalysisTool,
  getAgentTargetFollowUp,
  getAnalysisResultTool,
  inspectSignalTool,
  isCausalQuestion,
  type AgentToolExecutionContext,
} from '../operations';

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
