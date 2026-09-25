import { z } from 'zod';
import { SnapshotRowSchema } from '../imports/inventory';
import {
  DateSchema,
  DecimalSchema,
  IdSchema,
  SEMANTIC_VERSION,
  ScopeSchema,
  SignedDecimalSchema,
} from '../common/primitives';
import {
  AbstentionReasonSchema,
  DeltaValueSchema,
  MetricKeySchema,
  MetricSchema,
  MetricValueSchema,
} from './metrics';

export const CalculatedUnitSchema = z.object({
  unit_external_id: z.string(),
  unit_code: z.string(),
  project_external_id: z.string(),
  zone_external_id: z.string(),
  unit_type: z.string(),
  currency: z.string(),
  status: SnapshotRowSchema.shape.status,
  area_sqm: DecimalSchema.nullable(),
  list_price: DecimalSchema.nullable(),
  price_per_sqm: DecimalSchema.nullable(),
  age_days: z.number().int().nonnegative().nullable(),
  slow_moving: z.boolean().nullable(),
  snapshot_id: IdSchema,
  import_id: IdSchema,
});
export type CalculatedUnit = z.infer<typeof CalculatedUnitSchema>;
export const CalculationPayloadSchema = z.object({
  metrics: z.array(MetricSchema),
  units: z.array(CalculatedUnitSchema),
  slow_moving_threshold_days: z.number().int().positive(),
  current_snapshot_date: DateSchema.nullable(),
  quality_limitations: z.array(z.string()),
  age_buckets: z.array(
    z.object({
      bucket: z.enum(['0-30', '31-60', '61-90', '91-180', '>180', 'unknown']),
      value: z.number().int().nonnegative(),
    }),
  ),
  breakdowns: z.array(
    z.object({
      metric_key: MetricKeySchema,
      scope: ScopeSchema,
      dimension: z.enum(['project', 'zone', 'unit_type', 'bedrooms', 'status']),
      data_as_of: DateSchema,
      snapshot_date: DateSchema.nullable(),
      snapshot_refs: z.array(IdSchema),
      source_refs: z.array(IdSchema),
      filter: z.record(z.string(), z.string().nullable()),
      semantic_version: z.literal(SEMANTIC_VERSION),
      limitations: z.array(z.string()),
      items: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: MetricValueSchema.nullable(),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .nullable(),
          abstention_reason: AbstentionReasonSchema.nullable(),
        }),
      ),
    }),
  ),
  period_comparisons: z.array(
    z.object({
      metric_key: MetricKeySchema,
      period_days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
      current_as_of: DateSchema,
      current_snapshot_date: DateSchema.nullable(),
      comparison_target_date: DateSchema,
      comparison_snapshot_date: DateSchema.nullable(),
      current_value: MetricValueSchema.nullable(),
      comparison_value: MetricValueSchema.nullable(),
      current_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      comparison_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      absolute_delta: DeltaValueSchema.nullable(),
      relative_delta_pct: SignedDecimalSchema.nullable(),
      percentage_point_delta: SignedDecimalSchema.nullable(),
      abstention_reason: AbstentionReasonSchema.nullable(),
      relative_delta_abstention_reason: AbstentionReasonSchema.nullable(),
      snapshot_refs: z.array(IdSchema),
    }),
  ),
  segment_comparisons: z.array(
    z.object({
      dimension: z.enum(['zone', 'unit_type', 'bedrooms', 'status']),
      metric_key: MetricKeySchema,
      segment_key: z.string(),
      segment_value: MetricValueSchema.nullable(),
      segment_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      reference_key: z.string(),
      reference_value: MetricValueSchema.nullable(),
      reference_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      absolute_delta: DeltaValueSchema.nullable(),
      relative_delta_pct: SignedDecimalSchema.nullable(),
      percentage_point_delta: SignedDecimalSchema.nullable(),
      abstention_reason: AbstentionReasonSchema.nullable(),
      relative_delta_abstention_reason: AbstentionReasonSchema.nullable(),
    }),
  ),
  notable_changes: z.array(
    z.object({
      rule_id: z.string(),
      metric_key: MetricKeySchema,
      current_value: MetricValueSchema,
      comparison_value: MetricValueSchema,
      delta: DeltaValueSchema,
      scope: ScopeSchema,
      threshold: z.string(),
      evidence_paths: z.array(z.string()),
      reason: z.string(),
      severity: z.enum(['watch', 'material']),
    }),
  ),
  insight_candidates: z.array(
    z.object({
      candidate_id: z.string(),
      observation: z.string(),
      metric_key: MetricKeySchema,
      evidence_paths: z.array(z.string()),
      context: z.string(),
      interpretation: z.string(),
      limitations: z.array(z.string()),
      priority: z.number().int().nonnegative(),
    }),
  ),
});
export type CalculationPayload = z.infer<typeof CalculationPayloadSchema>;
export const ComparisonItemSchema = z.object({
  unit_external_id: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  peer_ids: z.array(z.string()),
  peer_snapshot_ids: z.array(IdSchema),
  cohort_rule: z.string(),
  peer_count: z.number().int().nonnegative(),
  median_price_per_sqm: DecimalSchema.nullable(),
  price_gap_pct: z.string().nullable(),
  abstention_reason: AbstentionReasonSchema.nullable(),
});
export type ComparisonItem = z.infer<typeof ComparisonItemSchema>;
