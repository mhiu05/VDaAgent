import { PERIODS, metricOf, summarize } from '../metrics/inventory-summary';
import { dateMinusDays, latestDate } from '../core/date';
import { selectLatest } from '../selection/latest-snapshot';
import { decimalOf } from '../core/decimal';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import type { AbstentionReason, Metric, MetricKey } from '@vda/contracts/analysis/metrics';
import type { Scope } from '@vda/contracts/common/primitives';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import { getMetricDefinition } from '../metrics/registry';

export function buildPeriodComparisons(
  allRows: UnitSnapshot[],
  currentRows: UnitSnapshot[],
  currentMetrics: Metric[],
  orgId: string,
  scope: Scope,
  asOf: string,
  threshold: number,
): CalculationPayload['period_comparisons'] {
  const keys: MetricKey[] = [
    'available_inventory',
    'available_inventory_rate',
    'slow_moving_rate',
    'median_inventory_age_days',
    'median_price_per_area',
    'missing_inventory_age_rate',
  ];
  return PERIODS.flatMap((period) => {
    const target = dateMinusDays(asOf, period);
    const priorRows = selectLatest(allRows, orgId, target, scope);
    const prior = summarize(priorRows, target, threshold);
    return keys.map((metricKey) => {
      const currentMetric = metricOf(currentMetrics, metricKey);
      const comparisonMetric = metricOf(prior.metrics, metricKey);
      const currentValue = currentMetric?.value ?? null;
      const comparisonValue = comparisonMetric?.value ?? null;
      const unit = getMetricDefinition(metricKey).unit;
      let absoluteDelta: number | string | null = null;
      let relativeDelta: string | null = null;
      let pointDelta: string | null = null;
      let abstention: AbstentionReason | null = null;
      let relativeAbstention: AbstentionReason | null = null;
      if (!priorRows.length) abstention = 'INSUFFICIENT_HISTORY';
      else if (currentValue === null || comparisonValue === null)
        abstention =
          currentMetric?.abstention_reason ??
          comparisonMetric?.abstention_reason ??
          'MISSING_REQUIRED_FIELD';
      else if (
        (unit === 'currency' || unit === 'currency_per_sqm') &&
        currentMetric?.currency !== comparisonMetric?.currency
      )
        abstention = 'INCOMPARABLE_CURRENCY';
      else {
        const previous = decimalOf(comparisonValue);
        const delta = decimalOf(currentValue).minus(previous);
        absoluteDelta = unit === 'count' || unit === 'days' ? delta.toNumber() : delta.toFixed(6);
        if (unit === 'percent') pointDelta = delta.toFixed(6);
        if (previous.eq(0)) relativeAbstention = 'ZERO_DENOMINATOR';
        else relativeDelta = delta.div(previous).mul(100).toFixed(6);
      }
      return {
        metric_key: metricKey,
        period_days: period,
        current_as_of: asOf,
        current_snapshot_date: latestDate(currentRows),
        comparison_target_date: target,
        comparison_snapshot_date: latestDate(priorRows),
        current_value: currentValue,
        comparison_value: comparisonValue,
        current_currency: currentMetric?.currency ?? null,
        comparison_currency: comparisonMetric?.currency ?? null,
        absolute_delta: absoluteDelta,
        relative_delta_pct: relativeDelta,
        percentage_point_delta: pointDelta,
        abstention_reason: abstention,
        relative_delta_abstention_reason: relativeAbstention,
        snapshot_refs: [
          ...new Set([...currentRows, ...priorRows].map((row) => row.snapshot_id)),
        ].sort(),
      };
    });
  });
}
