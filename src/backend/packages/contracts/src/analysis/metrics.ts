import { z } from 'zod';
import { DecimalSchema, SignedDecimalSchema } from '../common/primitives';

export const MetricKeySchema = z.enum([
  'total_inventory',
  'available_inventory',
  'available_inventory_rate',
  'sold_units_7d',
  'sold_units_30d',
  'sold_units_90d',
  'inventory_change_7d',
  'inventory_change_30d',
  'inventory_change_90d',
  'median_inventory_age_days',
  'p75_inventory_age_days',
  'slow_moving_units',
  'slow_moving_rate',
  'unknown_inventory_age',
  'unknown_inventory_age_rate',
  'median_price',
  'median_price_per_area',
  'p25_price_per_area',
  'p75_price_per_area',
  'price_per_area_iqr',
  'missing_inventory_age_rate',
  'missing_price_rate',
  'missing_area_rate',
  'records_with_invalid_or_unusable_values',
  'snapshot_coverage',
]);
export type MetricKey = z.infer<typeof MetricKeySchema>;
export const MetricUnitSchema = z.enum([
  'count',
  'percent',
  'percentage_points',
  'days',
  'currency',
  'currency_per_sqm',
]);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;
export const AbstentionReasonSchema = z.enum([
  'INSUFFICIENT_HISTORY',
  'INSUFFICIENT_PEERS',
  'MISSING_REQUIRED_FIELD',
  'NO_DATA',
  'ZERO_DENOMINATOR',
  'INCOMPARABLE_CURRENCY',
  'NO_SNAPSHOT',
  'INSUFFICIENT_SAMPLE_SIZE',
  'UNSUPPORTED_METRIC',
  'UNSUPPORTED_CHART',
  'INCOMPATIBLE_GRAIN',
  'TOO_MANY_CATEGORIES',
]);
export type AbstentionReason = z.infer<typeof AbstentionReasonSchema>;
export const MetricValueSchema = z.union([z.number().finite(), DecimalSchema]);
export const DeltaValueSchema = z.union([z.number().finite(), SignedDecimalSchema]);
export const MetricSchema = z
  .object({
    metric_id: z.string(),
    key: MetricKeySchema,
    label: z.string(),
    description: z.string(),
    value: MetricValueSchema.nullable(),
    unit: MetricUnitSchema,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    status: z.enum(['available', 'unavailable']),
    abstention_reason: AbstentionReasonSchema.nullable(),
  })
  .strict()
  .superRefine((metric, ctx) => {
    const monetary = metric.unit === 'currency' || metric.unit === 'currency_per_sqm';
    if (metric.value !== null && monetary && metric.currency === null)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Available monetary metric requires currency metadata',
      });
    if (!monetary && metric.currency !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Non-monetary metric cannot declare currency metadata',
      });
  });
export type Metric = z.infer<typeof MetricSchema>;
