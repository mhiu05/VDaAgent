import { ThreadContextSchema, resolveReportIntent, type AgentTurnRequest, type MessageContextRef } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { RuntimeContextError } from './types';

export type ResolvedContextReference = MessageContextRef & { run_id: string | null; artifact_id: string | null };
export type ContextSource = 'message' | 'selection' | 'reply' | 'thread' | 'none';

/** References select context, never grant access. Every reference is reauthorized. */
export class ContextResolver {
  constructor(private readonly repository: Repository) {}

  async resolve(userId: string, input: AgentTurnRequest, conversationId: string) {
    const thread = await this.repository.getThreadContext(userId, input.org_id, conversationId);
    let source: ContextSource = 'none';
    let refs: MessageContextRef[] = [];
    if (input.context_refs?.length) {
      source = 'message';
      refs = input.context_refs;
    } else if (input.workspace_context?.active_report_ref || input.workspace_context?.active_artifact_ref) {
      source = 'selection';
      refs = input.workspace_context.active_report_ref
        ? [{ type: 'report', id: input.workspace_context.active_report_ref.report_id }]
        : [{ type: 'artifact', id: input.workspace_context.active_artifact_ref!.artifact_id }];
    } else if (input.reply_to_message_id) {
      source = 'reply';
      const reply = await this.repository.getMessage(userId, input.org_id, conversationId, input.reply_to_message_id);
      refs = reply.parts.flatMap((part): MessageContextRef[] => {
        if (part.type === 'report_ref') return [{ type: 'report', id: part.report_id }];
        if (part.type === 'artifact_ref') return [{ type: 'artifact', id: part.artifact_id }];
        return [];
      });
    } else {
      // Legacy navigation snapshots may have no report while the independent
      // thread selection does. Clearing a report persists null in this context.
      source = 'thread';
      refs = [
        ...(thread.active_report_id ? [{ type: 'report' as const, id: thread.active_report_id }]
          : thread.active_artifact_id ? [{ type: 'artifact' as const, id: thread.active_artifact_id }] : []),
        ...thread.referenced_artifact_ids.map((id) => ({ type: 'artifact' as const, id })),
        ...thread.dataset_ids.map((id) => ({ type: 'dataset' as const, id })),
      ];
    }
    const unique = [...new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
    let references: ResolvedContextReference[];
    try {
      references = await Promise.all(unique.map((ref) => this.repository.getContextReference(userId, input.org_id, ref)));
    } catch {
      // Legacy browser selections are rehydrated child-by-child by the
      // existing builder, which can drop a private child but keep its run.
      if (source === 'selection') references = [];
      else throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
    }
    const artifacts = references.filter((ref) => ref.type === 'report' || ref.type === 'artifact');
    // Multiple explicit artifacts stay separate. Do not invent a primary report.
    const active = source === 'thread'
      ? artifacts.find((ref) => ref.type === 'report' && ref.id === thread.active_report_id)
        ?? artifacts.find((ref) => ref.type === 'artifact' && ref.id === thread.active_artifact_id)
        ?? null
      : artifacts.length === 1 ? artifacts[0]! : null;
    return {
      source: references.length || (source === 'thread' && thread.current_run_id) ? source : 'none' as ContextSource,
      references,
      active,
      thread: ThreadContextSchema.parse(thread),
      ambiguous_update: resolveReportIntent(input) === 'update' && artifacts.filter((ref) => ref.type === 'report').length !== 1,
    };
  }
}
