import { z } from 'zod';
import {
  AbstentionReasonSchema,
  MetricKeySchema,
  MetricUnitSchema,
  MetricValueSchema,
} from './metrics';
import type { MetricUnit } from './metrics';
import { DateSchema, IdSchema } from '../common/primitives';

export const CHART_SPEC_VERSION = 'chart-spec-v1' as const;
export const CHART_RULES_VERSION = 'chart-rules-v0.2' as const;
export const ChartTypeSchema = z.enum(['kpi', 'bar', 'line', 'pie', 'donut', 'scatter']);
export type ChartType = z.infer<typeof ChartTypeSchema>;
export const ChartIntentSchema = z.enum([
  'inventory_kpi',
  'inventory_trend',
  'aging_distribution',
  'slow_moving_by_segment',
  'inventory_composition',
  'price_distribution',
  'peer_comparison',
  'numeric_relationship',
]);
export type ChartIntent = z.infer<typeof ChartIntentSchema>;
export const ChartValueFormatSchema = z.enum([
  'integer',
  'number',
  'percent',
  'percentage_points',
  'currency',
  'currency_per_area',
  'days',
]);
export type ChartValueFormat = z.infer<typeof ChartValueFormatSchema>;
const ChartDatumValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
export const ChartDatumSchema = z.record(z.string().min(1), ChartDatumValueSchema);
export type ChartDatum = z.infer<typeof ChartDatumSchema>;
export const ChartSeriesSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    metric_key: MetricKeySchema.nullable().default(null),
    unit: MetricUnitSchema.nullable().default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    value_format: ChartValueFormatSchema,
    stack: z.string().min(1).nullable().default(null),
  })
  .strict()
  .superRefine((series, ctx) => {
    if (series.unit === null) return;
    const expected: Record<MetricUnit, ChartValueFormat> = {
      count: 'integer',
      percent: 'percent',
      percentage_points: 'percentage_points',
      days: 'days',
      currency: 'currency',
      currency_per_sqm: 'currency_per_area',
    };
    if (series.value_format !== expected[series.unit])
      ctx.addIssue({
        code: 'custom',
        path: ['value_format'],
        message: 'Series value format does not match its unit',
      });
  });
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;
export const ChartProvenanceBindingSchema = z
  .object({
    data_index: z.number().int().nonnegative(),
    data_key: z.string().min(1),
    artifact_id: IdSchema,
    evidence_path: z.string().min(1),
    metric_key: MetricKeySchema,
  })
  .strict();
export const ChartSpecSchema = z
  .object({
    version: z.literal(CHART_SPEC_VERSION),
    rules_version: z.literal(CHART_RULES_VERSION),
    chart_id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
    intent: ChartIntentSchema,
    chart_type: ChartTypeSchema,
    title: z.string().min(1),
    subtitle: z.string().min(1).nullable().default(null),
    purpose: z.string().min(1),
    x_axis: z
      .object({
        key: z.string().min(1),
        label: z.string().min(1).nullable().default(null),
        value_type: z.enum(['category', 'number', 'date']),
      })
      .strict()
      .nullable()
      .default(null),
    y_axis: z
      .object({
        label: z.string().min(1).nullable().default(null),
        unit: MetricUnitSchema.nullable().default(null),
        min: z.number().finite().nullable().default(null),
        max: z.number().finite().nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    series: z.array(ChartSeriesSchema).min(1),
    data: z.array(ChartDatumSchema).min(1),
    provenance: z
      .object({
        input_artifact_ids: z.array(IdSchema).min(1),
        metric_keys: z.array(MetricKeySchema).min(1),
        bindings: z.array(ChartProvenanceBindingSchema).min(1),
      })
      .strict(),
    limitations: z.array(z.string()),
    generated_by: z.literal('deterministic'),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seriesKeys = spec.series.map((series) => series.key);
    if (new Set(seriesKeys).size !== seriesKeys.length)
      ctx.addIssue({ code: 'custom', path: ['series'], message: 'Duplicate series key' });
    spec.series.forEach((series, index) => {
      if (
        (series.unit === 'currency' || series.unit === 'currency_per_sqm') &&
        series.currency === null
      )
        ctx.addIssue({
          code: 'custom',
          path: ['series', index, 'currency'],
          message: 'Monetary series requires currency metadata',
        });
      if (spec.y_axis !== null && spec.y_axis.unit !== null && series.unit !== spec.y_axis.unit)
        ctx.addIssue({
          code: 'custom',
          path: ['series', index, 'unit'],
          message: 'Series unit does not match the y axis',
        });
    });
    if (
      new Set(spec.provenance.input_artifact_ids).size !== spec.provenance.input_artifact_ids.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['provenance', 'input_artifact_ids'],
        message: 'Duplicate input artifact',
      });
    if (new Set(spec.provenance.metric_keys).size !== spec.provenance.metric_keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['provenance', 'metric_keys'],
        message: 'Duplicate metric key',
      });
    if (spec.chart_type !== 'kpi' && spec.x_axis === null)
      ctx.addIssue({ code: 'custom', path: ['x_axis'], message: 'Chart requires an x axis' });
    spec.data.forEach((datum, dataIndex) => {
      if (spec.x_axis && !(spec.x_axis.key in datum))
        ctx.addIssue({
          code: 'custom',
          path: ['data', dataIndex, spec.x_axis.key],
          message: 'Missing x key',
        });
      for (const key of seriesKeys)
        if (!(key in datum))
          ctx.addIssue({
            code: 'custom',
            path: ['data', dataIndex, key],
            message: 'Missing series key',
          });
        else if (datum[key] !== null && typeof datum[key] !== 'number')
          ctx.addIssue({
            code: 'custom',
            path: ['data', dataIndex, key],
            message: 'Series values must be numbers or null',
          });
      for (const [dataKey, value] of Object.entries(datum)) {
        if (typeof value !== 'number') continue;
        if (
          !spec.provenance.bindings.some(
            (binding) => binding.data_index === dataIndex && binding.data_key === dataKey,
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['data', dataIndex, dataKey],
            message: 'Numeric datapoint lacks provenance',
          });
      }
    });
    for (const [bindingIndex, binding] of spec.provenance.bindings.entries()) {
      if (!(binding.data_key in (spec.data[binding.data_index] ?? {})))
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', 'bindings', bindingIndex],
          message: 'Binding points outside chart data',
        });
      if (!spec.provenance.input_artifact_ids.includes(binding.artifact_id))
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', 'bindings', bindingIndex, 'artifact_id'],
          message: 'Binding artifact is not an input',
        });
      if (!spec.provenance.metric_keys.includes(binding.metric_key))
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', 'bindings', bindingIndex, 'metric_key'],
          message: 'Binding metric is not declared',
        });
    }
    if (spec.chart_type === 'kpi' && spec.data.length !== 1)
      ctx.addIssue({ code: 'custom', path: ['data'], message: 'KPI requires one datapoint' });
    if (spec.chart_type === 'line') {
      if (spec.x_axis?.value_type !== 'date')
        ctx.addIssue({
          code: 'custom',
          path: ['x_axis'],
          message: 'Line chart requires a date axis',
        });
      if (spec.data.length < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Line chart requires at least two points',
        });
      const dates = spec.data.map((datum) => datum[spec.x_axis?.key ?? '']);
      if (dates.some((value) => typeof value !== 'string' || !DateSchema.safeParse(value).success))
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Line chart dates are invalid',
        });
      if (dates.some((value, index) => index > 0 && String(value) <= String(dates[index - 1])))
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Line chart dates must be strictly ordered',
        });
    }
    if (spec.chart_type === 'pie' || spec.chart_type === 'donut') {
      if (spec.series.length !== 1)
        ctx.addIssue({
          code: 'custom',
          path: ['series'],
          message: 'Composition chart requires one series',
        });
      const values = spec.data.map((datum) => datum[seriesKeys[0]]);
      if (values.some((value) => typeof value !== 'number' || value < 0))
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Composition values must be non-negative numbers',
        });
      if (
        values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0) <= 0
      )
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Composition total must be positive',
        });
    }
    if (spec.chart_type === 'scatter') {
      if (spec.x_axis?.value_type !== 'number')
        ctx.addIssue({
          code: 'custom',
          path: ['x_axis'],
          message: 'Scatter chart requires a numeric x axis',
        });
      if (
        spec.data.some(
          (datum) =>
            typeof datum[spec.x_axis?.key ?? ''] !== 'number' ||
            seriesKeys.some((key) => typeof datum[key] !== 'number'),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Scatter values must be numeric',
        });
    }
  });
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export const ChartUnavailableSchema = z
  .object({
    intent: ChartIntentSchema,
    reason: AbstentionReasonSchema,
    message: z.string().min(1),
    metric_keys: z.array(MetricKeySchema),
    limitations: z.array(z.string()),
  })
  .strict();
export type ChartUnavailable = z.infer<typeof ChartUnavailableSchema>;
export const VisualEvidencePayloadSchema = z
  .object({
    chart_rules_version: z.literal(CHART_RULES_VERSION),
    charts: z.array(ChartSpecSchema),
    unavailable: z.array(ChartUnavailableSchema),
  })
  .strict();
export type VisualEvidencePayload = z.infer<typeof VisualEvidencePayloadSchema>;
export const ClaimSchema = z
  .object({
    claim_id: z.string(),
    text: z.string(),
    metric_key: MetricKeySchema,
    value: MetricValueSchema.nullable(),
    evidence_artifact_id: IdSchema,
    evidence_path: z.string(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;
