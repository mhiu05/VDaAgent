import type { DecisionIntelligencePack, Message } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { MAX_AGENT_PROVIDER_CONTEXT_BYTES, MAX_AGENT_RECENT_MESSAGES } from '../limits';
import {
  RuntimeContextError,
  type RuntimeDashboardAllowlist,
  type RuntimeDecisionSummary,
} from './types';

export const MAX_MESSAGE_CHARS = 500;

export const MAX_MESSAGE_CONTEXT_CHARS = 4_000;

// These are intentionally smaller than the server-side allowlists. The
// provider only needs a bounded navigation projection; registry preflight
// continues to use the complete reauthorized allowlist.
export const MAX_PROVIDER_SIGNAL_REFS = 8;

export const MAX_PROVIDER_EVIDENCE_REFS = 8;

export const MAX_PROVIDER_DASHBOARD_IDS = 8;

export function compactMessages(messages: Message[]) {
  const compacted: Array<{ role: Message['role']; content: string }> = [];
  let remaining = MAX_MESSAGE_CONTEXT_CHARS;
  for (const message of messages.slice(-MAX_AGENT_RECENT_MESSAGES)) {
    if (!remaining) break;
    const content = message.content.trim().slice(0, Math.min(MAX_MESSAGE_CHARS, remaining));
    if (!content) continue;
    compacted.push({ role: message.role, content });
    remaining -= content.length;
  }
  return compacted;
}

export function providerDashboardAllowlist(
  allowlist: RuntimeDashboardAllowlist,
): RuntimeDashboardAllowlist {
  return {
    kpi_ids: allowlist.kpi_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    chart_ids: allowlist.chart_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    priority_entity_ids: allowlist.priority_entity_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    insight_ids: allowlist.insight_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    action_candidate_ids: allowlist.action_candidate_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    drilldown_ids: allowlist.drilldown_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
  };
}

/** Compact, public-only decision identifiers for provider planning. */
export function decisionSummary(
  pack: DecisionIntelligencePack,
  response: Extract<
    Awaited<ReturnType<Repository['decisionIntelligence']>>,
    { status: 'available' }
  >,
): RuntimeDecisionSummary {
  return {
    decision_ref: { run_id: response.run_id, component_id: pack.pack_id },
    decision_artifact_ref: {
      run_id: response.run_id,
      artifact_id: response.decision_intelligence_artifact_id,
      kind: 'decision_intelligence_pack',
    },
    chart_pack_artifact_ref: {
      run_id: response.run_id,
      artifact_id: pack.chart_pack_artifact_id,
      kind: 'chart_pack',
    },
    status: pack.decision_brief.status,
    semantic_version: pack.semantic_version,
    visuals: pack.visual_story.ordered_visuals.slice(0, 20).map((item) => ({
      chart_id: item.chart_id,
      role: item.role,
    })),
    priorities: pack.priority_entities.slice(0, 40).map((item) => ({
      priority_entity_id: item.priority_entity_id,
      label: item.entity.label,
      tier: item.tier,
      support_level: item.support_level,
      drilldown_ids: item.drilldown_ids.slice(0, 20),
    })),
    drilldowns: pack.drilldowns.slice(0, 100).map((item) => ({
      drilldown_id: item.drilldown_id,
      label: item.label,
      kind: item.kind,
    })),
  };
}

export function boundedProviderContext(value: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_AGENT_PROVIDER_CONTEXT_BYTES)
    throw new RuntimeContextError('RUNTIME_LIMIT_EXCEEDED', true);
  return value;
}
