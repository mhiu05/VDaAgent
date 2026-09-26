import { createHash, randomUUID } from 'node:crypto';
import {
  AgentKeySchema,
  AgentTurnRequestSchema,
  PageRequestSchema,
  type AgentKey,
  type AgentTurnRequest,
  type AnalysisRun,
  type Conversation,
  type ConversationPage,
  type Message,
  type MessagePage,
  type MessagePart,
  type MessageStatus,
  type PageRequest,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import {
  asTimestamp,
  textPart,
  normalizeMessage,
  messagePayload,
  conversationFromRow,
  encodeCursor,
  decodeCursor,
  titleFrom,
} from '../mapping/conversation';
import { json } from '../mapping/rows';
import type { AgentTurn, TurnContext } from '../types';
import { validateMessageContext } from '../authorization/context-references';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

export class ConversationRepository {
  constructor(private readonly db: Driver) {}

  private auth(tx: Driver, user: string, org: string, write = false) {
    return authorizeInTransaction(tx, user, org, write);
  }

  async createConversation(
    tx: Driver,
    user: string,
    org: string,
    kind: Conversation['kind'],
    title: string,
  ): Promise<Conversation> {
    const date = now();
    const conversation: Conversation = {
      conversation_id: randomUUID(),
      org_id: org,
      created_by: user,
      kind,
      title,
      created_at: date,
      updated_at: date,
    };
    await tx.query(
      'INSERT INTO conversations(org_id,id,created_by,kind,title,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        conversation.org_id,
        conversation.conversation_id,
        conversation.created_by,
        conversation.kind,
        conversation.title,
        conversation.created_at,
        conversation.updated_at,
      ],
    );
    return conversation;
  }

  async touchConversation(tx: Driver, org: string, id: string, date = now()) {
    await tx.query('UPDATE conversations SET updated_at=$1 WHERE org_id=$2 AND id=$3', [
      date,
      org,
      id,
    ]);
  }

  async insertMessage(tx: Driver, message: Message, payloadExtra: Record<string, unknown> = {}) {
    if (
      message.sender_agent !== undefined &&
      message.sender_agent !== null &&
      message.role !== 'assistant'
    )
      fail('INVALID_MESSAGE_SENDER', 422);
    if (message.role === 'user') {
      const thread = await tx.query('SELECT context FROM conversations WHERE org_id=$1 AND id=$2',[message.org_id,message.conversation_id]);
      payloadExtra = {...payloadExtra,thread_context_snapshot:thread[0]?.context ?? {}};
    }
    await tx.query(
      "INSERT INTO messages(org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($11::jsonb #>> '{}')::jsonb)",
      [
        message.org_id,
        message.message_id,
        message.conversation_id,
        message.run_id,
        message.client_turn_id,
        message.role,
        message.sender_agent ?? null,
        message.status,
        message.created_at,
        message.updated_at,
        JSON.stringify(messagePayload(message, payloadExtra)),
      ],
    );
  }

  async updateMessage(tx: Driver, message: Message) {
    if (
      message.sender_agent !== undefined &&
      message.sender_agent !== null &&
      message.role !== 'assistant'
    )
      fail('INVALID_MESSAGE_SENDER', 422);
    await tx.query(
      `UPDATE messages
       SET run_id=$1,client_turn_id=$2,role=$3,sender_agent=$4,status=$5,created_at=$6,updated_at=$7,
           payload=(CASE jsonb_typeof(payload)
             WHEN 'string' THEN (payload #>> '{}')::jsonb
             ELSE payload
           END) || (($8::jsonb #>> '{}')::jsonb)
       WHERE org_id=$9 AND id=$10`,
      [
        message.run_id,
        message.client_turn_id,
        message.role,
        message.sender_agent ?? null,
        message.status,
        message.created_at,
        message.updated_at,
        JSON.stringify(messagePayload(message)),
        message.org_id,
        message.message_id,
      ],
    );
  }

  async message(tx: Driver, org: string, id: string, lock = false): Promise<Message> {
    const rows = await tx.query(
      `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload FROM messages WHERE org_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [org, id],
    );
    if (!rows[0]) fail('MESSAGE_NOT_FOUND', 404);
    return normalizeMessage(rows[0]);
  }

  async attachRunMessages(tx: Driver, run: AnalysisRun, context: TurnContext) {
    const userMessage = await this.message(tx, run.org_id, context.user_message_id, true);
    const assistantMessage = await this.message(tx, run.org_id, context.assistant_message_id, true);
    if (
      userMessage.conversation_id !== context.conversation_id ||
      assistantMessage.conversation_id !== context.conversation_id ||
      userMessage.client_turn_id !== context.client_turn_id ||
      assistantMessage.client_turn_id !== context.client_turn_id ||
      userMessage.role !== 'user' ||
      assistantMessage.role !== 'assistant'
    )
      fail('TURN_MISMATCH', 409);
    if (userMessage.run_id && userMessage.run_id !== run.run_id) fail('TURN_ALREADY_ATTACHED', 409);
    if (assistantMessage.status !== 'in_progress') fail('TURN_TERMINAL', 409);
    const date = now();
    userMessage.run_id = run.run_id;
    userMessage.status = 'completed';
    userMessage.updated_at = date;
    assistantMessage.run_id = run.run_id;
    assistantMessage.status = 'in_progress';
    assistantMessage.content = 'Đang chuẩn bị phân tích.';
    assistantMessage.parts = [
      { type: 'text', text: assistantMessage.content },
      { type: 'run_ref', run_id: run.run_id, status: 'queued' },
    ];
    assistantMessage.updated_at = date;
    await this.updateMessage(tx, userMessage);
    await this.updateMessage(tx, assistantMessage);
    await this.touchConversation(tx, run.org_id, context.conversation_id, date);
  }

  async createRunMessages(tx: Driver, run: AnalysisRun) {
    const date = now();
    const assistantDate = new Date(Date.parse(date) + 1).toISOString();
    const userMessage: Message = {
      message_id: randomUUID(),
      org_id: run.org_id,
      conversation_id: run.request.conversation_id!,
      run_id: run.run_id,
      client_turn_id: null,
      role: 'user',
      status: 'completed',
      content: run.request.question,
      parts: textPart(run.request.question),
      created_at: date,
      updated_at: date,
    };
    const assistantMessage: Message = {
      message_id: randomUUID(),
      org_id: run.org_id,
      conversation_id: run.request.conversation_id!,
      run_id: run.run_id,
      client_turn_id: null,
      role: 'assistant',
      status: 'in_progress',
      content: 'Đang chuẩn bị phân tích.',
      parts: [
        { type: 'text', text: 'Đang chuẩn bị phân tích.' },
        { type: 'run_ref', run_id: run.run_id, status: 'queued' },
      ],
      created_at: assistantDate,
      updated_at: assistantDate,
    };
    await this.insertMessage(tx, userMessage);
    await this.insertMessage(tx, assistantMessage);
    await this.touchConversation(tx, run.org_id, run.request.conversation_id!, assistantDate);
  }

  async messages(user: string, org: string, id: string): Promise<Message[]> {
    const page = await this.listMessages(user, org, id, { limit: 100, cursor: null });
    return page.messages;
  }

  async getMessage(
    user: string,
    org: string,
    conversationId: string,
    messageId: string,
  ): Promise<Message> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query(
        `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload
         FROM messages WHERE org_id=$1 AND conversation_id=$2 AND id=$3`,
        [org, conversationId, messageId],
      );
      if (!rows[0]) fail('MESSAGE_NOT_FOUND', 404);
      return normalizeMessage(rows[0]);
    });
  }

  async getConversation(user: string, org: string, id: string): Promise<Conversation> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query(
        'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2',
        [org, id],
      );
      if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
      return conversationFromRow(rows[0]);
    });
  }

  async listConversations(
    user: string,
    org: string,
    pageInput: PageRequest,
  ): Promise<ConversationPage> {
    const page = PageRequestSchema.parse(pageInput);
    const cursor = decodeCursor(page.cursor);
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query(
        `SELECT c.org_id,c.id,c.created_by,c.kind,c.title,c.created_at,c.updated_at,
          (SELECT m.status FROM messages m WHERE m.org_id=c.org_id AND m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS latest_status
         FROM conversations c
         WHERE c.org_id=$1 AND c.kind='interactive'
           AND ($2::timestamptz IS NULL OR (c.updated_at,c.id) < ($2::timestamptz,$3))
         ORDER BY c.updated_at DESC,c.id DESC
         LIMIT $4`,
        [org, cursor?.timestamp ?? null, cursor?.id ?? '', page.limit + 1],
      );
      const hasMore = rows.length > page.limit;
      const items = rows.slice(0, page.limit);
      const last = items.at(-1);
      return {
        conversations: items.map((row) => ({
          ...conversationFromRow(row),
          latest_status:
            typeof row.latest_status === 'string' &&
            ['submitted', 'in_progress', 'completed', 'failed', 'cancelled'].includes(
              row.latest_status,
            )
              ? (row.latest_status as MessageStatus)
              : null,
        })),
        next_cursor:
          hasMore && last
            ? encodeCursor({ timestamp: asTimestamp(last.updated_at), id: String(last.id) })
            : null,
      };
    });
  }

  async listMessages(
    user: string,
    org: string,
    conversationId: string,
    pageInput: PageRequest,
  ): Promise<MessagePage> {
    const page = PageRequestSchema.parse(pageInput);
    const cursor = decodeCursor(page.cursor);
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const conversation = await tx.query(
        'SELECT id FROM conversations WHERE org_id=$1 AND id=$2',
        [org, conversationId],
      );
      if (!conversation[0]) fail('CONVERSATION_NOT_FOUND', 404);
      const rows = await tx.query(
        `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload
         FROM messages
         WHERE org_id=$1 AND conversation_id=$2
           AND ($3::timestamptz IS NULL OR (created_at,id) < ($3::timestamptz,$4))
         ORDER BY created_at DESC,id DESC
         LIMIT $5`,
        [org, conversationId, cursor?.timestamp ?? null, cursor?.id ?? '', page.limit + 1],
      );
      const hasMore = rows.length > page.limit;
      const pageRows = rows.slice(0, page.limit);
      const last = pageRows.at(-1);
      return {
        messages: pageRows.map(normalizeMessage).reverse(),
        next_cursor:
          hasMore && last
            ? encodeCursor({ timestamp: asTimestamp(last.created_at), id: String(last.id) })
            : null,
      };
    });
  }

  private async turnFromUserMessage(tx: Driver, userMessage: Message): Promise<AgentTurn> {
    const conversationRows = await tx.query(
      'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2',
      [userMessage.org_id, userMessage.conversation_id],
    );
    const assistantRows = await tx.query(
      `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload
       FROM messages WHERE org_id=$1 AND conversation_id=$2 AND client_turn_id=$3 AND role='assistant'`,
      [userMessage.org_id, userMessage.conversation_id, userMessage.client_turn_id],
    );
    if (!conversationRows[0] || !assistantRows[0]) fail('TURN_INCOMPLETE', 409);
    const assistantMessage = normalizeMessage(assistantRows[0]);
    const referencedRunId = assistantMessage.parts.find(
      (part): part is Extract<MessagePart, { type: 'run_ref' }> => part.type === 'run_ref',
    )?.run_id;
    return {
      conversation: conversationFromRow(conversationRows[0]),
      user_message: userMessage,
      assistant_message:
        assistantMessage.run_id === null && referencedRunId
          ? { ...assistantMessage, run_id: referencedRunId }
          : assistantMessage,
      idempotent_replay: true,
    };
  }

  async startTurn(
    user: string,
    inputValue: AgentTurnRequest,
    idempotencyKey: string,
    requestedConversationId?: string,
    afterTurn?: (tx: Driver, turn: AgentTurn) => Promise<void>,
  ): Promise<AgentTurn> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    if (!idempotencyKey || idempotencyKey.length > 200) fail('INVALID_IDEMPOTENCY_KEY');
    const requestHash = hash(JSON.stringify(input));
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, input.org_id, true);
      await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [input.org_id]);
      const priorRows = await tx.query(
        `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload
         FROM messages
         WHERE org_id=$1 AND role='user'
           AND (client_turn_id=$2 OR payload #>> '{agent_turn,idempotency_key}'=$3)
         ORDER BY created_at ASC,id ASC
         LIMIT 1 FOR UPDATE`,
        [input.org_id, input.client_turn_id, idempotencyKey],
      );
      if (priorRows[0]) {
        const prior = normalizeMessage(priorRows[0]);
        const payload = json(priorRows[0]) as Record<string, unknown>;
        const stored = payload.agent_turn as Record<string, unknown> | undefined;
        if (
          !stored ||
          stored.actor_id !== user ||
          stored.request_hash !== requestHash ||
          stored.idempotency_key !== idempotencyKey ||
          (requestedConversationId !== undefined &&
            prior.conversation_id !== requestedConversationId)
        )
          fail('IDEMPOTENCY_CONFLICT', 409);
        const turn = await this.turnFromUserMessage(tx, prior);
        if (afterTurn) await afterTurn(tx, turn);
        return turn;
      }
      let conversation: Conversation;
      if (requestedConversationId) {
        const rows = await tx.query(
          'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [input.org_id, requestedConversationId],
        );
        if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
        conversation = conversationFromRow(rows[0]);
        if (conversation.kind !== 'interactive') fail('CONVERSATION_NOT_INTERACTIVE', 409);
      } else {
        conversation = await this.createConversation(
          tx,
          user,
          input.org_id,
          'interactive',
          titleFrom(input.text),
        );
      }
      const date = now();
      const assistantDate = new Date(Date.parse(date) + 1).toISOString();
      const userMessage: Message = {
        message_id: randomUUID(),
        org_id: input.org_id,
        conversation_id: conversation.conversation_id,
        run_id: null,
        client_turn_id: input.client_turn_id,
        role: 'user',
        status: 'submitted',
        content: input.text,
        context_refs: input.context_refs,
        reply_to_message_id: input.reply_to_message_id,
        report_intent: input.report_intent,
        parts: [
          ...textPart(input.text),
          ...(input.signal_ref
            ? [
                {
                  type: 'signal_ref' as const,
                  run_id: input.signal_ref.run_id,
                  signal_id: input.signal_ref.signal_id,
                },
              ]
            : []),
        ],
        created_at: date,
        updated_at: date,
      };
      const assistantMessage: Message = {
        message_id: randomUUID(),
        org_id: input.org_id,
        conversation_id: conversation.conversation_id,
        run_id: null,
        client_turn_id: input.client_turn_id,
        role: 'assistant',
        status: 'in_progress',
        content: 'Đang chuẩn bị phân tích.',
        parts: textPart('Đang chuẩn bị phân tích.'),
        created_at: assistantDate,
        updated_at: assistantDate,
      };
      const agentTurn = {
        agent_turn: {
          actor_id: user,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          request: input,
        },
      };
      await validateMessageContext(tx,input.org_id,conversation.conversation_id,input.context_refs,input.reply_to_message_id);
      await this.insertMessage(tx, userMessage, agentTurn);
      await this.insertMessage(tx, assistantMessage, agentTurn);
      await this.touchConversation(tx, input.org_id, conversation.conversation_id, assistantDate);
      const turn = {
        conversation,
        user_message: userMessage,
        assistant_message: assistantMessage,
        idempotent_replay: false,
      };
      if (afterTurn) await afterTurn(tx, turn);
      return turn;
    });
  }

  async finalizeTurn(
    user: string,
    context: TurnContext,
    result: {
      status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled'>;
      content: string;
      parts: MessagePart[];
      sender_agent?: AgentKey | null;
    },
  ): Promise<Message> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, context.org_id, true);
      const assistant = await this.message(tx, context.org_id, context.assistant_message_id, true);
      if (
        assistant.conversation_id !== context.conversation_id ||
        assistant.client_turn_id !== context.client_turn_id ||
        assistant.role !== 'assistant'
      )
        fail('TURN_MISMATCH', 409);
      if (assistant.run_id !== null) fail('TURN_HAS_RUN', 409);
      if (assistant.status !== 'in_progress') fail('TURN_TERMINAL', 409);
      const senderAgent =
        result.sender_agent === undefined || result.sender_agent === null
          ? null
          : (AgentKeySchema.parse(result.sender_agent) as AgentKey);
      assistant.status = result.status;
      assistant.sender_agent = senderAgent;
      assistant.content = result.content;
      assistant.parts = result.parts;
      assistant.updated_at = now();
      await this.updateMessage(tx, assistant);
      const userMessage = await this.message(tx, context.org_id, context.user_message_id, true);
      if (userMessage.status === 'submitted') {
        userMessage.status = 'completed';
        userMessage.updated_at = assistant.updated_at;
        await this.updateMessage(tx, userMessage);
      }
      await this.touchConversation(
        tx,
        context.org_id,
        context.conversation_id,
        assistant.updated_at,
      );
      return assistant;
    });
  }
}
