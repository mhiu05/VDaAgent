import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import type { Metric } from '@vda/contracts/analysis/metrics';

export const insightPriorityRules = Object.freeze({
  material_change: 100,
  watch_change: 70,
  current_slow_moving_rate: 50,
  current_missing_age_rate: 40,
  current_available_rate: 30,
  max_candidates: 5,
});

export function buildCandidates(
  changes: CalculationPayload['notable_changes'],
  metrics: Metric[],
  qualityLimitations: string[],
): CalculationPayload['insight_candidates'] {
  const output: CalculationPayload['insight_candidates'] = changes.map((change, index) => ({
    candidate_id: `notable:${change.rule_id}`,
    observation: change.reason,
    metric_key: change.metric_key,
    evidence_paths: change.evidence_paths,
    context: `Current ${change.current_value}; comparison ${change.comparison_value}.`,
    interpretation: 'The deterministic threshold was crossed; no cause is asserted.',
    limitations:
      change.metric_key.includes('age') || change.metric_key === 'slow_moving_rate'
        ? qualityLimitations
        : [],
    priority:
      (change.severity === 'material'
        ? insightPriorityRules.material_change
        : insightPriorityRules.watch_change) - index,
  }));
  for (const key of [
    'slow_moving_rate',
    'missing_inventory_age_rate',
    'available_inventory_rate',
  ] as const) {
    const found = metrics.find((item) => item.key === key);
    if (!found || found.value === null || output.some((item) => item.metric_key === key)) continue;
    output.push({
      candidate_id: `current:${key}`,
      observation: `${found.label} is ${found.value} ${found.unit}.`,
      metric_key: key,
      evidence_paths: [`payload.metrics[${metrics.indexOf(found)}].value`],
      context: 'Current point-in-time result.',
      interpretation: 'Descriptive observation only.',
      limitations:
        key === 'slow_moving_rate' || key === 'missing_inventory_age_rate'
          ? qualityLimitations
          : [],
      priority:
        key === 'slow_moving_rate'
          ? insightPriorityRules.current_slow_moving_rate
          : key === 'missing_inventory_age_rate'
            ? insightPriorityRules.current_missing_age_rate
            : insightPriorityRules.current_available_rate,
    });
  }
  return output
    .sort((a, b) => b.priority - a.priority || a.candidate_id.localeCompare(b.candidate_id))
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.metric_key === item.metric_key) === index,
    )
    .slice(0, insightPriorityRules.max_candidates);
}
