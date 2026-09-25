import type { MetricKey, MetricUnit } from '@vda/contracts/analysis/metrics';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import { DECISION_BRIEF_VERSION, DecisionBriefSchema } from '@vda/contracts/decision/brief';
import type { DecisionBrief, DecisionSignal } from '@vda/contracts/decision/brief';
import { DateSchema, SEMANTIC_VERSION } from '@vda/contracts/common/primitives';
import type { Scope } from '@vda/contracts/common/primitives';
import { metricOf } from '../metrics/inventory-summary';
import { decimalOf } from '../core/decimal';

function briefValue(
  value: number | string | null,
  unit: MetricUnit,
  currency: string | null,
): string {
  if (value === null) return 'unavailable';
  if (unit === 'percent') return `${value}%`;
  if (unit === 'percentage_points') return `${value} percentage points`;
  if (unit === 'days') return `${value} days`;
  if (unit === 'currency') return `${value} ${currency ?? ''}`.trim();
  if (unit === 'currency_per_sqm') return `${value} ${currency ?? ''}/m2`.trim();
  return String(value);
}

function metricSignal(
  calculation: CalculationPayload,
  artifactId: string,
  metricKey: MetricKey,
  kind: 'current_state' | 'data_quality',
): DecisionSignal {
  const index = calculation.metrics.findIndex((metric) => metric.key === metricKey);
  if (index < 0) throw new Error('INVALID_METRIC_SET');
  const metric = calculation.metrics[index];
  const available = metric.value !== null;
  return {
    signal_id: `${kind}:${metricKey}`,
    rule_id: `${SEMANTIC_VERSION}:${kind}:${metricKey}`,
    kind,
    label: metric.label,
    summary: available
      ? `${metric.label}: ${briefValue(metric.value, metric.unit, metric.currency)}.`
      : `${metric.label} is unavailable (${metric.abstention_reason ?? 'NO_DATA'}).`,
    metric_key: metricKey,
    dimension: null,
    segment_key: null,
    current_value: metric.value,
    comparison_value: null,
    delta: null,
    support_value: null,
    denominator_value: null,
    unit: metric.unit,
    delta_unit: null,
    currency: metric.currency,
    status: available ? 'available' : 'unavailable',
    abstention_reason: available ? null : (metric.abstention_reason ?? 'NO_DATA'),
    limitations:
      metricKey === 'slow_moving_rate' || metricKey === 'median_inventory_age_days'
        ? calculation.quality_limitations
        : [],
    evidence: [
      {
        role: 'current',
        artifact_id: artifactId,
        path: `payload.metrics[${index}].value`,
      },
    ],
  };
}

function changeSignals(calculation: CalculationPayload, artifactId: string): DecisionSignal[] {
  return calculation.notable_changes.map((change) => {
    const match = change.evidence_paths[0]?.match(
      /^payload\.period_comparisons\[(\d+)\]\.current_value$/,
    );
    const index = match ? Number(match[1]) : -1;
    const comparison = calculation.period_comparisons[index];
    if (!comparison || comparison.metric_key !== change.metric_key)
      throw new Error('INVALID_NOTABLE_CHANGE_EVIDENCE');
    const metric = metricOf(calculation.metrics, change.metric_key);
    if (!metric) throw new Error('INVALID_METRIC_SET');
    const rate = metric.unit === 'percent';
    const delta = rate ? comparison.percentage_point_delta : comparison.absolute_delta;
    const deltaUnit: MetricUnit = rate ? 'percentage_points' : metric.unit;
    if (delta === null) throw new Error('INVALID_NOTABLE_CHANGE_EVIDENCE');
    return {
      signal_id: `material_change:${change.rule_id}`,
      rule_id: change.rule_id,
      kind: 'material_change',
      label: metric.label,
      summary: `${metric.label} moved from ${briefValue(comparison.comparison_value, metric.unit, comparison.comparison_currency)} to ${briefValue(comparison.current_value, metric.unit, comparison.current_currency)} over ${comparison.period_days} days; the ${change.severity} threshold was crossed.`,
      metric_key: change.metric_key,
      dimension: null,
      segment_key: null,
      current_value: comparison.current_value,
      comparison_value: comparison.comparison_value,
      delta,
      support_value: null,
      denominator_value: null,
      unit: metric.unit,
      delta_unit: deltaUnit,
      currency: comparison.current_currency,
      status: 'available',
      abstention_reason: null,
      limitations:
        change.metric_key.includes('age') || change.metric_key === 'slow_moving_rate'
          ? calculation.quality_limitations
          : [],
      evidence: [
        {
          role: 'current',
          artifact_id: artifactId,
          path: `payload.period_comparisons[${index}].current_value`,
        },
        {
          role: 'comparison',
          artifact_id: artifactId,
          path: `payload.period_comparisons[${index}].comparison_value`,
        },
        {
          role: 'delta',
          artifact_id: artifactId,
          path: `payload.period_comparisons[${index}].${rate ? 'percentage_point_delta' : 'absolute_delta'}`,
        },
      ],
    };
  });
}

function concentrationSignal(calculation: CalculationPayload, artifactId: string): DecisionSignal {
  const denominatorIndex = calculation.metrics.findIndex(
    (metric) => metric.key === 'available_inventory',
  );
  if (denominatorIndex < 0) throw new Error('INVALID_METRIC_SET');
  const denominatorMetric = calculation.metrics[denominatorIndex];
  const dimensionOrder = ['zone', 'unit_type', 'bedrooms', 'status'] as const;
  let candidates: Array<{
    dimension: (typeof dimensionOrder)[number];
    breakdownIndex: number;
    itemIndex: number;
    item: CalculationPayload['breakdowns'][number]['items'][number];
  }> = [];
  for (const dimension of dimensionOrder) {
    const breakdownIndex = calculation.breakdowns.findIndex(
      (breakdown) =>
        breakdown.dimension === dimension && breakdown.metric_key === 'available_inventory',
    );
    if (breakdownIndex < 0) continue;
    candidates = calculation.breakdowns[breakdownIndex].items.flatMap((item, itemIndex) =>
      item.value === null ? [] : [{ dimension, breakdownIndex, itemIndex, item }],
    );
    if (candidates.length) break;
  }
  candidates.sort(
    (a, b) =>
      decimalOf(b.item.value!).comparedTo(decimalOf(a.item.value!)) ||
      a.item.key.localeCompare(b.item.key),
  );
  const selected = candidates[0];
  const denominator = denominatorMetric.value;
  if (!selected || denominator === null || decimalOf(denominator).lte(0)) {
    return {
      signal_id: 'segment_concentration:available_inventory',
      rule_id: `${SEMANTIC_VERSION}:segment-concentration:available_inventory`,
      kind: 'segment_concentration',
      label: 'Available inventory concentration',
      summary:
        'A supported segment concentration is unavailable because available inventory has no usable denominator.',
      metric_key: 'available_inventory',
      dimension: null,
      segment_key: null,
      current_value: null,
      comparison_value: null,
      delta: null,
      support_value: null,
      denominator_value: denominator,
      unit: 'count',
      delta_unit: null,
      currency: null,
      status: 'unavailable',
      abstention_reason:
        denominator === null
          ? (denominatorMetric.abstention_reason ?? 'NO_DATA')
          : 'ZERO_DENOMINATOR',
      limitations: [],
      evidence: [
        {
          role: 'denominator',
          artifact_id: artifactId,
          path: `payload.metrics[${denominatorIndex}].value`,
        },
      ],
    };
  }
  return {
    signal_id: 'segment_concentration:available_inventory',
    rule_id: `${SEMANTIC_VERSION}:segment-concentration:available_inventory`,
    kind: 'segment_concentration',
    label: `Available inventory in ${selected.dimension} ${selected.item.label}`,
    summary: `${selected.item.value} of ${denominator} available inventory units are in ${selected.dimension} ${selected.item.label}.`,
    metric_key: 'available_inventory',
    dimension: selected.dimension,
    segment_key: selected.item.key,
    current_value: null,
    comparison_value: null,
    delta: null,
    support_value: selected.item.value,
    denominator_value: denominator,
    unit: 'count',
    delta_unit: null,
    currency: null,
    status: 'available',
    abstention_reason: null,
    limitations: calculation.breakdowns[selected.breakdownIndex].limitations,
    evidence: [
      {
        role: 'support',
        artifact_id: artifactId,
        path: `payload.breakdowns[${selected.breakdownIndex}].items[${selected.itemIndex}].value`,
      },
      {
        role: 'denominator',
        artifact_id: artifactId,
        path: `payload.metrics[${denominatorIndex}].value`,
      },
    ],
  };
}

export function buildDecisionBrief(
  calculation: CalculationPayload,
  calculationArtifactId: string,
  scope: Scope,
  requestedDataAsOf: string,
): DecisionBrief {
  DateSchema.parse(requestedDataAsOf);
  const currentState = (
    [
      'total_inventory',
      'available_inventory',
      'median_inventory_age_days',
      'slow_moving_rate',
    ] as const
  ).map((key) => metricSignal(calculation, calculationArtifactId, key, 'current_state'));
  const dataQuality = (
    [
      'missing_inventory_age_rate',
      'missing_price_rate',
      'missing_area_rate',
      'records_with_invalid_or_unusable_values',
      'snapshot_coverage',
    ] as const
  ).map((key) => metricSignal(calculation, calculationArtifactId, key, 'data_quality'));
  const where = concentrationSignal(calculation, calculationArtifactId);
  const nextActions: DecisionBrief['next_actions'] = [
    {
      action_id: 'review_inventory_units',
      kind: 'review_inventory_units',
      label: 'Review the underlying inventory units',
      target_signal_id: null,
      artifact_id: calculationArtifactId,
    },
    {
      action_id: 'review_primary_evidence',
      kind: 'review_evidence',
      label: 'Review the concentration evidence',
      target_signal_id: where.signal_id,
      artifact_id: calculationArtifactId,
    },
  ];
  return DecisionBriefSchema.parse({
    version: DECISION_BRIEF_VERSION,
    scope,
    requested_data_as_of: requestedDataAsOf,
    effective_snapshot_date: calculation.current_snapshot_date,
    current_state: currentState,
    material_changes: changeSignals(calculation, calculationArtifactId),
    where_to_look: [where],
    data_quality: dataQuality,
    next_actions: nextActions,
    limitations: [...new Set(calculation.quality_limitations)],
  });
}
