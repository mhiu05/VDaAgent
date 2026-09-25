import type { Driver } from '../driver';
import { fail } from '../errors';
import { normalizeMessage } from '../mapping/conversation';
import { ConversationRepository } from '../repositories/conversation-repository';

export type StalledTurnPreview = {
  org_id: string;
  conversation_id: string;
  client_turn_id: string;
  user_message_id: string;
  assistant_message_id: string;
  reason: string | null;
};

/** Operator-scoped repair after all HTTP owners for this turn have stopped. */
export async function reconcileStalledTurn(
  db: Driver,
  orgId: string,
  conversationId: string,
  clientTurnId: string,
  options: { olderThan: Date; apply?: boolean; ownerStopped?: boolean; date?: Date },
): Promise<StalledTurnPreview> {
  if (Number.isNaN(options.olderThan.getTime())) fail('INVALID_CUTOFF', 422);
  if (options.apply && !options.ownerStopped) fail('TURN_OWNER_STOP_REQUIRED', 422);
  const date = options.date ?? new Date();
  if (options.olderThan.getTime() > date.getTime()) fail('FUTURE_CUTOFF', 422);
  return db.transaction(async (tx) => {
    // The user row is the turn identity and serializes with startTurn replay.
    const users = await tx.query(
      `SELECT * FROM messages WHERE org_id=$1 AND conversation_id=$2
       AND client_turn_id=$3 AND role='user'${options.apply ? ' FOR UPDATE NOWAIT' : ''}`,
      [orgId, conversationId, clientTurnId],
    );
    if (!users[0]) fail('TURN_NOT_FOUND', 404);
    const user = normalizeMessage(users[0]);
    const assistants = await tx.query(
      `SELECT * FROM messages WHERE org_id=$1 AND conversation_id=$2
       AND client_turn_id=$3 AND role='assistant' AND sender_agent IS NULL${options.apply ? ' FOR UPDATE NOWAIT' : ''}`,
      [orgId, conversationId, clientTurnId],
    );
    if (assistants.length !== 1) fail('TURN_ASSISTANT_AMBIGUOUS', 409);
    const assistant = normalizeMessage(assistants[0]);
    const jobs = await tx.query(
      'SELECT id FROM agent_turn_jobs WHERE org_id=$1 AND user_message_id=$2',
      [orgId, user.message_id],
    );
    const reason =
      user.run_id || assistant.run_id
        ? 'TURN_HAS_RUN'
        : jobs.length
          ? 'TURN_HAS_JOB'
          : assistant.status !== 'in_progress'
            ? 'TURN_TERMINAL'
            : user.status !== 'submitted'
              ? 'TURN_USER_TERMINAL'
              : Math.max(
                    Date.parse(user.updated_at ?? user.created_at),
                    Date.parse(assistant.updated_at ?? assistant.created_at),
                  ) > options.olderThan.getTime()
                ? 'TURN_TOO_RECENT'
                : null;
    const preview = {
      org_id: orgId,
      conversation_id: conversationId,
      client_turn_id: clientTurnId,
      user_message_id: user.message_id,
      assistant_message_id: assistant.message_id,
      reason,
    };
    if (!options.apply) return preview;
    if (reason) fail(reason, 409);
    const conversation = new ConversationRepository(tx);
    assistant.status = 'failed';
    assistant.content = 'Lượt trao đổi bị gián đoạn. Hãy gửi một lượt mới để thử lại.';
    assistant.parts = [
      { type: 'text', text: assistant.content },
      { type: 'error', code: 'TURN_INTERRUPTED', retryable: false },
    ];
    assistant.updated_at = date.toISOString();
    user.status = 'completed';
    user.updated_at = date.toISOString();
    await conversation.updateMessage(tx, assistant);
    await conversation.updateMessage(tx, user);
    await conversation.touchConversation(tx, orgId, conversationId, assistant.updated_at);
    return preview;
  });
}
