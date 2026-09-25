import {
  AgentTurnRequestSchema,
  type AgentTurnRequest,
  type Message,
  type Role,
  type Scope,
  type SignalRef,
} from '@vda/contracts';
import type { Repository } from '@vda/db';
import type { AgentDecisionContext } from './provider';

const MAX_MESSAGE_CHARS = 600;

const MAX_CONTEXT_CHARS = 5_000;

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

function assistantRunIds(messages: Message[]): string[] {
  const ids = [...messages]
    .reverse()
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === 'run_ref' ||
      part.type === 'signal_ref' ||
      part.type === 'decision_ref' ||
      part.type === 'drilldown_ref'
        ? [part.run_id]
        : [],
    );
  return [...new Set(ids)].slice(0, 5);
}

function runIds(messages: Message[], requestedSignalRef: SignalRef | null | undefined): string[] {
  const ids = [requestedSignalRef?.run_id, ...assistantRunIds(messages)].filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)].slice(0, 5);
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

export type BuiltContext = {
  role: Role;
  context: AgentDecisionContext;
  analysis_scope: Scope;
  allowed_conversation_run_ids: string[];
};

export class ConversationContextBuilder {
  constructor(private readonly repository: Repository) {}
  async build(
    userId: string,
    inputValue: AgentTurnRequest,
    conversationId: string,
  ): Promise<BuiltContext> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    const [role, catalog, page] = await Promise.all([
      this.repository.authorize(userId, input.org_id),
      this.repository.catalog(userId, input.org_id),
      this.repository.listMessages(userId, input.org_id, conversationId, {
        limit: 12,
        cursor: null,
      }),
    ]);
    const conversationRunIds = assistantRunIds(page.messages);
    const candidates = runIds(page.messages, input.signal_ref);
    let activeBrief: AgentDecisionContext['active_brief'] = null;
    let activeDecision: NonNullable<AgentDecisionContext['active_decision']> | null = null;
    for (const runId of candidates) {
      try {
        const decision = await this.repository.decisionIntelligence(userId, input.org_id, runId);
        if (decision.status === 'available') {
          const pack = decision.decision_intelligence;
          activeDecision = {
            run_id: decision.run_id,
            scope: pack.decision_brief.scope,
            requested_data_as_of: pack.decision_brief.requested_data_as_of,
            effective_snapshot_date: pack.decision_brief.effective_snapshot_date,
            status: pack.decision_brief.status,
            priority_entities: pack.priority_entities.map((entity) => ({
              priority_entity_id: entity.priority_entity_id,
              label: entity.entity.label,
              rank: entity.rank,
              tier: entity.tier,
              support_level: entity.support_level,
              limitations: entity.limitations,
            })),
            action_candidates: pack.action_candidates.map((action) => ({
              action_candidate_id: action.action_candidate_id,
              label: action.label,
              support_level: action.support_level,
              drilldown_id: action.drilldown_id,
              limitations: action.limitations,
            })),
            drilldown_ids: pack.drilldowns.map((drilldown) => drilldown.drilldown_id),
            limitations: pack.decision_brief.limitations,
          };
        }
      } catch {
        // Historical runs may have only the v1 compatibility brief.
      }
      try {
        const brief = await this.repository.decisionBrief(userId, input.org_id, runId);
        const signals = [
          ...brief.decision_brief.current_state,
          ...brief.decision_brief.material_changes,
          ...brief.decision_brief.where_to_look,
          ...brief.decision_brief.data_quality,
        ];
        activeBrief = {
          run_id: brief.run_id,
          scope: brief.scope,
          requested_data_as_of: brief.requested_data_as_of,
          effective_snapshot_date: brief.effective_snapshot_date,
          signals: signals.map((signal) => ({
            signal_id: signal.signal_id,
            kind: signal.kind,
            dimension: signal.dimension,
            segment_key: signal.segment_key,
            supported_action: 'inspect_signal' as const,
            supported_next_action_ids: brief.decision_brief.next_actions
              .filter((action) => action.target_signal_id === signal.signal_id)
              .map((action) => action.action_id),
          })),
        };
      } catch {
        // A run without a validated briefing is not eligible for signal inspection.
      }
      if (activeDecision && activeBrief) break;
    }
    const requestedSignalRef =
      input.signal_ref &&
      activeBrief?.run_id === input.signal_ref.run_id &&
      activeBrief.signals.some((signal) => signal.signal_id === input.signal_ref?.signal_id)
        ? input.signal_ref
        : null;
    const activeResult = activeBrief ?? activeDecision;
    let analysisScope = input.scope;
    if (input.signal_action === 'analyze_segment') {
      const signal = activeBrief?.signals.find(
        (candidate) => candidate.signal_id === requestedSignalRef?.signal_id,
      );
      const project = activeBrief
        ? catalog.projects.find(
            (candidate) => candidate.project_external_id === activeBrief?.scope.project_external_id,
          )
        : undefined;
      if (
        !activeBrief ||
        !signal ||
        signal.dimension !== 'zone' ||
        !signal.segment_key ||
        !project?.zones.some((zone) => zone.zone_external_id === signal.segment_key)
      )
        throw new Error('SIGNAL_SCOPE_UNSUPPORTED');
      analysisScope = {
        project_external_id: activeBrief.scope.project_external_id,
        zone_external_id: signal.segment_key,
      };
    }
    return {
      role,
      analysis_scope: analysisScope,
      allowed_conversation_run_ids: conversationRunIds,
      context: {
        question: input.text,
        scope: analysisScope,
        data_as_of: input.data_as_of,
        scope_changed: activeResult ? !sameScope(analysisScope, activeResult.scope) : false,
        date_changed: activeResult ? input.data_as_of !== activeResult.requested_data_as_of : false,
        role,
        catalog: {
          projects: catalog.projects.slice(0, 50).map((project) => ({
            project_external_id: project.project_external_id,
            zones: project.zones.slice(0, 50),
          })),
          latest_snapshot_date: catalog.latest_snapshot_date,
        },
        recent_messages: compactMessages(page.messages),
        allowed_run_ids: candidates,
        active_brief: activeBrief,
        active_decision: activeDecision,
        requested_signal_ref: requestedSignalRef,
      },
    };
  }
}
