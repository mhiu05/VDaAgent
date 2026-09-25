import { isApprovedDurableAnalysisTurn, type AgentTurnRequest } from '@vda/contracts';
import { RepositoryError, type Repository } from '@vda/db';

/** Return null when this turn belongs to the synchronous path or did before a flag flip. */
export async function enqueueEligibleDurableTurn(
  repository: Repository,
  enabled: boolean,
  userId: string,
  input: AgentTurnRequest,
  idempotencyKey: string,
  conversationId?: string,
) {
  if (!enabled || !isApprovedDurableAnalysisTurn(input)) return null;
  try {
    return await repository.enqueueAgentTurn(userId, input, idempotencyKey, conversationId);
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'TURN_NOT_DURABLE') return null;
    throw error;
  }
}
