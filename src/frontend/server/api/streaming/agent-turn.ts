import { getConfig } from '@vda/config';
import { AgentRuntime } from '@vda/agents';
import { type AgentTurnAccepted, type AgentTurnRequest } from '@vda/contracts';
import { RepositoryError, type Repository } from '@vda/db';
import { agentTurnStream } from '../../agent-turn-stream';

type AgentTurnSubmitter = {
  submit(
    userId: string,
    input: AgentTurnRequest,
    idempotencyKey: string,
    conversationId?: string,
    signal?: AbortSignal,
  ): Promise<AgentTurnAccepted>;
};

export function agentTurnSubmitter(repo: Repository): AgentTurnSubmitter {
  const config = getConfig();
  return new AgentRuntime(repo, { durable_admission: config.DURABLE_AGENT_EXECUTION_ENABLED });
}

export function streamAgentTurn(
  request: Request,
  repo: Repository,
  userId: string,
  input: AgentTurnRequest,
  idempotencyKey: string,
  conversationId?: string,
) {
  const config = getConfig();
  if (config.DURABLE_AGENT_EXECUTION_ENABLED || !config.AGENT_SSE_ENABLED)
    throw new RepositoryError('SSE_DISABLED', 404);
  if (!request.headers.get('accept')?.includes('text/event-stream'))
    throw new RepositoryError('SSE_ACCEPT_REQUIRED', 406);
  return agentTurnStream({
    requestSignal: request.signal,
    execute: (activitySink, signal) =>
      new AgentRuntime(repo, { activity_sink: activitySink }).submit(
        userId,
        input,
        idempotencyKey,
        conversationId,
        signal,
      ),
  });
}
