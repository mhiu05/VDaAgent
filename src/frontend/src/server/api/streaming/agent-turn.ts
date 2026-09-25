import { getConfig } from '@vda/config';
import { AgentChatOrchestrator, AgentRuntime, enqueueEligibleDurableTurn } from '@vda/agents';
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
  if (config.GROK_RUNTIME_ENABLED)
    return new AgentRuntime(repo, { durable_admission: config.DURABLE_AGENT_EXECUTION_ENABLED });
  const fallback = new AgentChatOrchestrator(repo);
  return {
    submit: async (userId, input, idempotencyKey, conversationId) => {
      const turn = await enqueueEligibleDurableTurn(repo,config.DURABLE_AGENT_EXECUTION_ENABLED,
        userId,input,idempotencyKey,conversationId);
      if (turn) return {
        conversation_id: turn.conversation.conversation_id,
        user_message_id: turn.user_message.message_id,
        assistant_message_id: turn.assistant_message.message_id,
        run_id: turn.assistant_message.run_id,
        assistant_status: turn.assistant_message.status,
        agent_turn_job_id: turn.job.job_id,
      };
      const result = await fallback.submit(userId,input,idempotencyKey,conversationId);
      const job = await repo.getAgentTurnJobForMessage(userId,input.org_id,result.user_message_id);
      return job ? { ...result, agent_turn_job_id: job.job_id } : result;
    },
  };
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
