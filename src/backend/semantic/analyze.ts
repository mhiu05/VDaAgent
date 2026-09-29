import { selectLatest } from './selection/latest-snapshot';
import { PERIODS, result, summarize } from './metrics/inventory-summary';
import { latestDate } from './core/date';
import { percent } from './core/decimal';
import { buildPeriodComparisons } from './comparisons/period';
import { buildBreakdowns } from './breakdowns/inventory-breakdowns';
import { buildSegmentComparisons } from './comparisons/segment';
import { detectChanges } from './insights/notable-changes';
import { agingLimitations } from './quality/aging-coverage';
import { buildCandidates } from './insights/candidates';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import type { Scope } from '@vda/contracts/common/primitives';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import type { MetricKey } from '@vda/contracts/analysis/metrics';

export function analyze(
  rows: UnitSnapshot[],
  orgId: string,
  scope: Scope,
  asOf: string,
  threshold = 90,
): CalculationPayload {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('INVALID_THRESHOLD');
  const currentRows = selectLatest(rows, orgId, asOf, scope);
  const summary = summarize(currentRows, asOf, threshold);
  const scopedHistory = rows.filter(
    (row) => row.snapshot_date <= asOf && row.project_external_id === scope.project_external_id,
  );
  const population = new Set(currentRows.map((row) => row.unit_external_id));
  const snapshotDate = latestDate(currentRows);
  const covered = new Set(
    scopedHistory
      .filter(
        (row) =>
          row.snapshot_date === snapshotDate &&
          (!scope.zone_external_id || row.zone_external_id === scope.zone_external_id),
      )
      .map((row) => row.unit_external_id),
  ).size;
  summary.metrics.push(
    result(
      'snapshot_coverage',
      population.size ? percent(covered, population.size) : null,
      population.size ? null : 'NO_SNAPSHOT',
    ),
  );
  const periodComparisons = buildPeriodComparisons(
    scopedHistory,
    currentRows,
    summary.metrics,
    orgId,
    scope,
    asOf,
    threshold,
  );
  for (const period of PERIODS) {
    const comparison = periodComparisons.find(
      (item) => item.period_days === period && item.metric_key === 'available_inventory',
    )!;
    summary.metrics.splice(
      6 + PERIODS.indexOf(period),
      0,
      result(
        `inventory_change_${period}d` as MetricKey,
        comparison.absolute_delta,
        comparison.abstention_reason,
      ),
    );
  }
  const breakdowns = buildBreakdowns(currentRows, asOf, scope, threshold);
  const segmentComparisons = buildSegmentComparisons(breakdowns);
  const notableChanges = detectChanges(periodComparisons, scope);
  const qualityLimitations = agingLimitations(summary.metrics);
  return {
    metrics: summary.metrics,
    units: summary.units,
    slow_moving_threshold_days: threshold,
    current_snapshot_date: snapshotDate,
    quality_limitations: qualityLimitations,
    age_buckets: summary.age_buckets,
    breakdowns,
    period_comparisons: periodComparisons,
    segment_comparisons: segmentComparisons,
    notable_changes: notableChanges,
    insight_candidates: buildCandidates(notableChanges, summary.metrics, qualityLimitations),
  };
}
