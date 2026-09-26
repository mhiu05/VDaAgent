import type { Repository } from '@vda/db';
import { budgetContext, buildInstructionHierarchy, estimateContextTokens } from './budget';
import { MemoryRetriever } from './memory';
import { compactMessages } from './provider-projection';
import { ContextResolver } from './resolver';

export type TeamContextInput = {
  userId: string;
  orgId: string;
  conversationId: string | null;
  runId: string;
  agentKey: string;
  task: string;
  allowedTools: readonly string[];
  instructions: string;
};

/** Shared invocation boundary for deterministic and provider-backed team workers. */
export async function buildTeamContext(repository: Repository, input: TeamContextInput) {
  return createTeamContextBuilder(repository)(input);
}

/** Cache the accepted run context inside one execution, never across tenants/runs. */
export function createTeamContextBuilder(repository: Repository) {
  const snapshots = new Map<string, ReturnType<typeof loadSnapshot>>();
  async function loadSnapshot(input: TeamContextInput) {
    const detail = await repository.getRun(input.userId, input.orgId, input.runId);
    if (!input.conversationId) return { thread: null, messages: [], resolved: null };
    const [thread, page] = await Promise.all([
      repository.getThreadContext(input.userId, input.orgId, input.conversationId),
      repository.listMessages(input.userId, input.orgId, input.conversationId, {
        limit: 12,
        cursor: null,
      }),
    ]);
    const initiating = page.messages.find(
      (message) => message.role === 'user' && message.run_id === input.runId,
    );
    const resolved = initiating?.context_refs?.length
      ? await new ContextResolver(repository).resolve(
          input.userId,
          {
            org_id: input.orgId,
            client_turn_id: initiating.client_turn_id ?? initiating.message_id,
            text: detail.run.request.question,
            scope: detail.run.request.scope,
            data_as_of: detail.run.request.data_as_of,
            context_refs: initiating.context_refs,
            reply_to_message_id: initiating.reply_to_message_id,
          },
          input.conversationId,
        )
      : null;
    return { thread, messages: page.messages, resolved };
  }
  return async (input: TeamContextInput) => {
    const started = Date.now();
    const instructions = buildInstructionHierarchy(input.instructions);
    const key = `${input.userId}:${input.orgId}:${input.runId}:${input.conversationId}`;
    if (!snapshots.has(key)) snapshots.set(key, loadSnapshot(input));
    const [{ thread, messages, resolved }, memory] = await Promise.all([
      snapshots.get(key)!,
      input.conversationId
        ? new MemoryRetriever(repository).retrieve({
            ...input,
            conversationId: input.conversationId,
          })
        : Promise.resolve({ working: [], episodic: [], workspace: [] }),
    ]);
    const budget = budgetContext(
      [
        { key: 'task', value: input.task.slice(0, 2_000), priority: 100 },
        {
          key: 'identity',
          value: {
            agent: input.agentKey,
            run_id: input.runId,
            conversation_id: input.conversationId,
          },
          priority: 100,
        },
        { key: 'allowed_tools', value: input.allowedTools, priority: 95 },
        { key: 'message_context', value: resolved?.references ?? [], priority: 94 },
        { key: 'thread_context', value: thread, priority: 90 },
        { key: 'working_memory', value: memory.working, priority: 70 },
        { key: 'recent_messages', value: compactMessages(messages), priority: 50 },
        { key: 'episodic_memory', value: memory.episodic, priority: 40 },
        { key: 'workspace_knowledge', value: memory.workspace, priority: 30 },
      ],
      Math.max(0, 6_000 - estimateContextTokens(instructions)),
    );
    return {
      instructions,
      context: { ...budget.context, trust: 'retrieved_context_is_data' },
      estimated_tokens: budget.estimated_tokens + estimateContextTokens(instructions),
      build_ms: Date.now() - started,
    };
  };
}
