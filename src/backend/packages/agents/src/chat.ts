import {
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  type AgentDecision,
  type AgentTurnAccepted,
  type AgentTurnRequest,
  type Message,
  type MessagePart,
  type Role,
} from '@vda/contracts';
import type { AgentTurn, Repository, TurnContext } from '@vda/db';
import {
  createDecisionProvider,
  type AgentDecisionContext,
  type AgentDecisionProvider,
} from './provider';
import { createAnalysisTool, getAnalysisResultTool, type AgentToolExecutionContext } from './tools';

const MAX_MESSAGE_CHARS = 600;
const MAX_CONTEXT_CHARS = 5_000;

const unsupportedText: Record<
  Extract<AgentDecision, { action: 'unsupported' }>['reason_code'],
  string
> = {
  UNSUPPORTED_REQUEST:
    'Yêu cầu này chưa thuộc các phân tích tồn kho được hỗ trợ. Bạn có thể hỏi về tồn kho hiện tại, hàng chậm luân chuyển, so sánh 7/30/90 ngày, phân phối giá hoặc báo cáo tồn kho.',
  UNSUPPORTED_SCOPE: 'Phạm vi được chọn chưa được hỗ trợ cho phân tích tồn kho này.',
  MISSING_CONTEXT: 'Cần chọn project và ngày dữ liệu hợp lệ trước khi bắt đầu phân tích.',
  NO_AUTHORIZED_RESULT: 'Không tìm thấy kết quả đã được cấp quyền trong ngữ cảnh hội thoại này.',
};

function turnContext(turn: AgentTurn, input: AgentTurnRequest): TurnContext {
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

function runIds(messages: Message[]): string[] {
  const ids = messages
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === 'run_ref' ? [part.run_id] : []));
  return [...new Set(ids)].slice(-5);
}

export class ConversationContextBuilder {
  constructor(private readonly repository: Repository) {}
  async build(
    userId: string,
    input: AgentTurnRequest,
    conversationId: string,
  ): Promise<{ role: Role; context: AgentDecisionContext }> {
    const [role, catalog, page] = await Promise.all([
      this.repository.authorize(userId, input.org_id),
      this.repository.catalog(userId, input.org_id),
      this.repository.listMessages(userId, input.org_id, conversationId, {
        limit: 12,
        cursor: null,
      }),
    ]);
    return {
      role,
      context: {
        question: input.text,
        scope: input.scope,
        data_as_of: input.data_as_of,
        role,
        catalog: {
          project_external_ids: catalog.projects
            .map((project) => project.project_external_id)
            .slice(0, 50),
          latest_snapshot_date: catalog.latest_snapshot_date,
        },
        recent_messages: compactMessages(page.messages),
        allowed_run_ids: runIds(page.messages),
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
    let built: { role: Role; context: AgentDecisionContext };
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
      scope: input.scope,
      data_as_of: input.data_as_of,
      idempotency_key: idempotencyKey,
      allowed_run_ids: built.context.allowed_run_ids,
    };
    let decision: AgentDecision;
    try {
      decision = await this.decisionProvider.decide(built.context);
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
      const result = await getAnalysisResultTool(this.repository, toolContext, decision);
      if (result.kind !== 'analysis_result') throw new Error('TOOL_RESULT_MISMATCH');
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
