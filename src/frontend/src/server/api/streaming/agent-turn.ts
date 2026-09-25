import { getConfig } from '@vda/config';
import { AgentChatOrchestrator, AgentRuntime } from '@vda/agents';
import { isApprovedDurableAnalysisTurn, type AgentTurnAccepted, type AgentTurnRequest } from '@vda/contracts';
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
  const fallback = config.GROK_RUNTIME_ENABLED ? new AgentRuntime(repo) : new AgentChatOrchestrator(repo);
  if (config.DURABLE_AGENT_EXECUTION_ENABLED) return {
    submit: async (userId, input, idempotencyKey, conversationId, signal) => {
      if (!isApprovedDurableAnalysisTurn(input))
        return fallback.submit(userId,input,idempotencyKey,conversationId,signal);
      const turn = await repo.enqueueAgentTurn(userId,input,idempotencyKey,conversationId);
      return {
        conversation_id: turn.conversation.conversation_id,
        user_message_id: turn.user_message.message_id,
        assistant_message_id: turn.assistant_message.message_id,
        run_id: turn.assistant_message.run_id,
        assistant_status: turn.assistant_message.status,
        agent_turn_job_id: turn.job.job_id,
      };
    },
  };
  return fallback;
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
  if ((config.DURABLE_AGENT_EXECUTION_ENABLED && isApprovedDurableAnalysisTurn(input)) || !config.GROK_RUNTIME_ENABLED || !config.GROK_SSE_ENABLED)
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
