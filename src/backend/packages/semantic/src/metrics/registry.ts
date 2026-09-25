import { SEMANTIC_VERSION } from '@vda/contracts/common/primitives';
import type { MetricKey, MetricUnit } from '@vda/contracts/analysis/metrics';

export type ScopeType = 'project' | 'zone';
export type DimensionKey = 'project' | 'zone' | 'unit_type' | 'bedrooms' | 'status';

export type MetricDefinition = Readonly<{
  key: MetricKey;
  label: string;
  description: string;
  unit: MetricUnit;
  requiredFields: readonly string[];
  supportedScopes: readonly ScopeType[];
  supportedDimensions: readonly DimensionKey[];
  supportsTrend: boolean;
  aggregationBehavior: string;
  nullBehavior: string;
  semanticVersion: typeof SEMANTIC_VERSION;
}>;

const allScopes = ['project', 'zone'] as const;
const allDimensions = ['project', 'zone', 'unit_type', 'bedrooms', 'status'] as const;
const segmentDimensions = ['zone', 'unit_type', 'bedrooms', 'status'] as const;

function definition(
  value: Omit<MetricDefinition, 'supportedScopes' | 'semanticVersion'> & {
    supportedScopes?: readonly ScopeType[];
  },
): MetricDefinition {
  return Object.freeze({
    ...value,
    supportedScopes: value.supportedScopes ?? allScopes,
    semanticVersion: SEMANTIC_VERSION,
  });
}

export const metricRegistry = Object.freeze({
  total_inventory: definition({
    key: 'total_inventory',
    label: 'Total inventory',
    description:
      'Distinct units represented by the latest snapshot at or before the analysis date.',
    unit: 'count',
    requiredFields: ['unit_external_id', 'snapshot_date'],
    supportedDimensions: allDimensions,
    supportsTrend: true,
    aggregationBehavior: 'distinct latest unit count',
    nullBehavior: 'Unavailable when no snapshot exists.',
  }),
  available_inventory: definition({
    key: 'available_inventory',
    label: 'Available inventory',
    description: 'Latest-snapshot units whose status is available.',
    unit: 'count',
    requiredFields: ['unit_external_id', 'snapshot_date', 'status'],
    supportedDimensions: allDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count of available latest units',
    nullBehavior: 'Unavailable when no snapshot exists.',
  }),
  available_inventory_rate: definition({
    key: 'available_inventory_rate',
    label: 'Available inventory rate',
    description: 'Available inventory divided by total inventory.',
    unit: 'percent',
    requiredFields: ['status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio of additive counts',
    nullBehavior: 'Unavailable for a zero denominator.',
  }),
  sold_units_7d: definition({
    key: 'sold_units_7d',
    label: 'Sold units (7d)',
    description:
      'Latest-snapshot units with sold_at in the inclusive 7-day window ending data_as_of.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Null sold_at is excluded.',
  }),
  sold_units_30d: definition({
    key: 'sold_units_30d',
    label: 'Sold units (30d)',
    description:
      'Latest-snapshot units with sold_at in the inclusive 30-day window ending data_as_of.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Null sold_at is excluded.',
  }),
  sold_units_90d: definition({
    key: 'sold_units_90d',
    label: 'Sold units (90d)',
    description:
      'Latest-snapshot units with sold_at in the inclusive 90-day window ending data_as_of.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Null sold_at is excluded.',
  }),
  inventory_change_7d: definition({
    key: 'inventory_change_7d',
    label: 'Available inventory change (7d)',
    description:
      'Current available inventory minus available inventory at the latest snapshot on or before the 7-day target.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Unavailable without prior history.',
  }),
  inventory_change_30d: definition({
    key: 'inventory_change_30d',
    label: 'Available inventory change (30d)',
    description:
      'Current available inventory minus available inventory at the latest snapshot on or before the 30-day target.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Unavailable without prior history.',
  }),
  inventory_change_90d: definition({
    key: 'inventory_change_90d',
    label: 'Available inventory change (90d)',
    description:
      'Current available inventory minus available inventory at the latest snapshot on or before the 90-day target.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Unavailable without prior history.',
  }),
  median_inventory_age_days: definition({
    key: 'median_inventory_age_days',
    label: 'Median inventory age',
    description: 'Median age in days among available units with available_since.',
    unit: 'days',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile at p=0.5',
    nullBehavior: 'Missing ages are excluded and reported separately.',
  }),
  p75_inventory_age_days: definition({
    key: 'p75_inventory_age_days',
    label: 'P75 inventory age',
    description: '75th percentile age in days among available units with available_since.',
    unit: 'days',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Missing ages are excluded and reported separately.',
  }),
  slow_moving_units: definition({
    key: 'slow_moving_units',
    label: 'Slow-moving units',
    description: 'Available units at or above the configured age threshold.',
    unit: 'count',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count',
    nullBehavior: 'Unknown ages are excluded and reported separately.',
  }),
  slow_moving_rate: definition({
    key: 'slow_moving_rate',
    label: 'Slow-moving rate',
    description: 'Slow-moving units divided by available units with known age.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable for zero known-age available units.',
  }),
  unknown_inventory_age: definition({
    key: 'unknown_inventory_age',
    label: 'Unknown inventory age',
    description: 'Available units without available_since.',
    unit: 'count',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count',
    nullBehavior: 'Missing values are counted explicitly.',
  }),
  unknown_inventory_age_rate: definition({
    key: 'unknown_inventory_age_rate',
    label: 'Unknown inventory age rate',
    description: 'Available units without age divided by available inventory.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable for zero available inventory.',
  }),
  median_price: definition({
    key: 'median_price',
    label: 'Median list price',
    description:
      'Median positive list price among available units when all usable observations share one currency.',
    unit: 'currency',
    requiredFields: ['status', 'list_price', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'decimal median',
    nullBehavior: 'Missing/non-positive values are excluded.',
  }),
  median_price_per_area: definition({
    key: 'median_price_per_area',
    label: 'Median price per m²',
    description:
      'Median list price divided by area among usable available units when all observations share one currency.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'median of unit ratios',
    nullBehavior: 'Missing/non-positive values are excluded.',
  }),
  p25_price_per_area: definition({
    key: 'p25_price_per_area',
    label: 'P25 price per m²',
    description: '25th percentile price per area among usable available units.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Missing/non-positive values are excluded.',
  }),
  p75_price_per_area: definition({
    key: 'p75_price_per_area',
    label: 'P75 price per m²',
    description: '75th percentile price per area among usable available units.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Missing/non-positive values are excluded.',
  }),
  price_per_area_iqr: definition({
    key: 'price_per_area_iqr',
    label: 'Price per m² IQR',
    description: 'P75 minus P25 price per area.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of percentiles',
    nullBehavior: 'Unavailable when percentiles are unavailable.',
  }),
  missing_inventory_age_rate: definition({
    key: 'missing_inventory_age_rate',
    label: 'Missing inventory age rate',
    description: 'Available units without available_since divided by available inventory.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable for zero available inventory.',
  }),
  missing_price_rate: definition({
    key: 'missing_price_rate',
    label: 'Missing price rate',
    description: 'Latest units without a positive list price divided by total inventory.',
    unit: 'percent',
    requiredFields: ['list_price'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable for zero inventory.',
  }),
  missing_area_rate: definition({
    key: 'missing_area_rate',
    label: 'Missing area rate',
    description: 'Latest units without a positive area divided by total inventory.',
    unit: 'percent',
    requiredFields: ['area_sqm'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable for zero inventory.',
  }),
  records_with_invalid_or_unusable_values: definition({
    key: 'records_with_invalid_or_unusable_values',
    label: 'Records with unusable values',
    description:
      'Latest units with a missing/non-positive price or area, or an available unit with missing age.',
    unit: 'count',
    requiredFields: ['list_price', 'area_sqm', 'status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'distinct count',
    nullBehavior: 'Unavailable when no snapshot exists.',
  }),
  snapshot_coverage: definition({
    key: 'snapshot_coverage',
    label: 'Snapshot coverage',
    description:
      'Units in the selected current snapshot divided by distinct units observed in scope through data_as_of.',
    unit: 'percent',
    requiredFields: ['unit_external_id', 'snapshot_date'],
    supportedDimensions: [],
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Unavailable when no historical unit population exists.',
  }),
} satisfies Record<MetricKey, MetricDefinition>);

export function getMetricDefinition(key: MetricKey): MetricDefinition {
  return metricRegistry[key];
}
