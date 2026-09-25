import type {
  CanonicalEvidenceRef,
  DecisionBrief,
  DecisionIntelligencePack,
  Message,
  SignalRef,
} from '@vda/contracts';
import { MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS } from '../limits';
import type { RuntimeDashboardAllowlist } from './types';

export const MAX_CONTEXT_EVIDENCE_REFS = 100;

export function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}

export function assistantRunIds(messages: Message[]) {
  return uniqueStrings(
    messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts)
      .flatMap((part) => {
        if ('run_id' in part && typeof part.run_id === 'string') return [part.run_id];
        if (
          (part.type === 'claim_ref' ||
            part.type === 'metric_ref' ||
            part.type === 'evidence_ref' ||
            part.type === 'quality_ref') &&
          typeof part.ref.run_id === 'string'
        )
          return [part.ref.run_id];
        if (part.type === 'workspace_action' && 'run_id' in part.action)
          return [part.action.run_id];
        return [];
      }),
  ).slice(0, MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS);
}

export function evidenceKey(artifactId: string, path: string) {
  return artifactId + '\u0000' + path;
}

export function decisionEvidence(pack: DecisionIntelligencePack) {
  const references = new Map<string, CanonicalEvidenceRef>();
  const add = (values: readonly CanonicalEvidenceRef[]) => {
    for (const value of values) references.set(evidenceKey(value.artifact_id, value.path), value);
  };
  const brief = pack.decision_brief;
  add(pack.evidence_refs);
  add(brief.evidence_refs);
  add(brief.kpi_cards.map((item) => item.metric_ref));
  for (const item of brief.material_changes) {
    add(item.metric_refs);
    add(item.evidence_refs);
  }
  for (const item of brief.hotspots) {
    add([item.metric_ref]);
    add(item.evidence_refs);
  }
  for (const item of brief.business_implications) add(item.evidence_refs);
  for (const item of brief.watchouts) add(item.evidence_refs);
  add(brief.data_quality_summary.evidence_refs);
  for (const item of pack.priority_entities) {
    add(item.metric_refs);
    add(item.evidence_refs);
  }
  for (const item of pack.action_candidates) add(item.evidence_refs);
  for (const item of pack.drilldowns) if (item.kind === 'open_evidence') add(item.evidence_refs);
  return [...references.values()].slice(0, MAX_CONTEXT_EVIDENCE_REFS);
}

export function dashboardAllowlist(
  pack: DecisionIntelligencePack | null,
): RuntimeDashboardAllowlist {
  if (!pack)
    return {
      kpi_ids: [],
      chart_ids: [],
      priority_entity_ids: [],
      insight_ids: [],
      action_candidate_ids: [],
      drilldown_ids: [],
    };
  return {
    kpi_ids: pack.decision_brief.kpi_cards.map((item) => item.kpi_id),
    chart_ids: pack.visual_story.ordered_visuals.map((item) => item.chart_id),
    priority_entity_ids: pack.priority_entities.map((item) => item.priority_entity_id),
    insight_ids: pack.decision_brief.business_implications.map((item) => item.implication_id),
    action_candidate_ids: pack.action_candidates.map((item) => item.action_candidate_id),
    drilldown_ids: pack.drilldowns.map((item) => item.drilldown_id),
  };
}

export function briefSignalRefs(runId: string, brief: DecisionBrief): SignalRef[] {
  return [
    ...brief.current_state,
    ...brief.material_changes,
    ...brief.where_to_look,
    ...brief.data_quality,
  ].map((signal) => ({ run_id: runId, signal_id: signal.signal_id }));
}
