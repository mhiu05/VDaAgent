import type { DimensionKey } from '../metrics/registry';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import { metricOf, summarize, valueOf } from '../metrics/inventory-summary';
import { latestDate } from '../core/date';
import { agingLimitations } from '../quality/aging-coverage';
import { SEMANTIC_VERSION } from '@vda/contracts/common/primitives';
import type { Scope } from '@vda/contracts/common/primitives';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import type { MetricKey } from '@vda/contracts/analysis/metrics';

const DIMENSIONS: DimensionKey[] = ['zone', 'unit_type', 'bedrooms', 'status'];

function dimensionValue(row: UnitSnapshot, dimension: DimensionKey): string {
  if (dimension === 'project') return row.project_external_id;
  if (dimension === 'zone') return row.zone_external_id;
  if (dimension === 'unit_type') return row.unit_type;
  if (dimension === 'bedrooms') return row.bedrooms === null ? 'unknown' : String(row.bedrooms);
  return row.status;
}

export function buildBreakdowns(
  rows: UnitSnapshot[],
  asOf: string,
  scope: Scope,
  threshold: number,
): CalculationPayload['breakdowns'] {
  const keys: MetricKey[] = [
    'total_inventory',
    'available_inventory',
    'available_inventory_rate',
    'slow_moving_rate',
    'median_inventory_age_days',
    'median_price_per_area',
  ];
  return DIMENSIONS.flatMap((dimension) => {
    const groups = new Map<string, UnitSnapshot[]>();
    for (const row of rows) {
      const key = dimensionValue(row, dimension);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const summaries = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({ key, summary: summarize(group, asOf, threshold) }));
    return keys.map((metricKey) => ({
      metric_key: metricKey,
      scope,
      dimension,
      data_as_of: asOf,
      snapshot_date: latestDate(rows),
      snapshot_refs: rows.map((row) => row.snapshot_id).sort(),
      source_refs: [...new Set(rows.map((row) => row.import_id))].sort(),
      filter: {
        project_external_id: scope.project_external_id,
        zone_external_id: scope.zone_external_id,
      },
      semantic_version: SEMANTIC_VERSION,
      limitations:
        metricKey === 'slow_moving_rate' || metricKey === 'median_inventory_age_days'
          ? summaries.flatMap(({ summary }) => agingLimitations(summary.metrics))
          : [],
      items: summaries.map(({ key, summary }) => ({
        key,
        label: key === 'unknown' ? 'Unknown' : key,
        value: valueOf(summary.metrics, metricKey),
        currency: metricOf(summary.metrics, metricKey)?.currency ?? null,
        abstention_reason: metricOf(summary.metrics, metricKey)?.abstention_reason ?? null,
      })),
    }));
  });
}
