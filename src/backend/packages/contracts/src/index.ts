import { z } from 'zod';

export const SEMANTIC_VERSION = 'mvp-inventory-v0.2' as const;
export const ARTIFACT_SCHEMA_VERSION = '1.1' as const;
/**
 * The agent workflow is intentionally registered in code.  This is not a
 * user-provided prompt or a free-form analytics selector.
 */
export const DEFAULT_USE_CASE = 'slow_moving_inventory' as const;
export const USE_CASE_CONTRACT_VERSION = 'use-case-v2' as const;
export const UseCaseKeySchema = z.enum([DEFAULT_USE_CASE]);
export type UseCaseKey = z.infer<typeof UseCaseKeySchema>;
export const WorkflowVersionSchema = z.enum(['legacy-v1', 'agent-v1']);
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export const AgentKeySchema = z.enum([
  'coordinator',
  'data',
  'comparison',
  'chart',
  'analyst',
  'insight',
  'report',
  'reviewer',
]);
export type AgentKey = z.infer<typeof AgentKeySchema>;
export const resolveUseCase = (value: { use_case?: UseCaseKey | null }): UseCaseKey =>
  value.use_case ?? DEFAULT_USE_CASE;
export const LIMITATION =
  'Assumption / MVP provisional — dữ liệu tổng hợp và công thức synthetic, chưa được BA/Data Owner phê duyệt.';
export const IdSchema = z.uuid();
export const DateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime({ offset: true });
export const DecimalSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(40);
export const SignedDecimalSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(40);
export const RoleSchema = z.enum(['owner', 'analyst', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;
export const ScopeSchema = z
  .object({
    project_external_id: z.string().min(1).max(100),
    zone_external_id: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();
export type Scope = z.infer<typeof ScopeSchema>;
export const AnalysisRequestSchema = z
  .object({
    org_id: IdSchema,
    scope: ScopeSchema,
    data_as_of: DateSchema,
    question: z.string().trim().min(1).max(2000),
    conversation_id: IdSchema.nullable().default(null),
    use_case: UseCaseKeySchema.default(DEFAULT_USE_CASE),
    /** Captures an explicit bounded specialist request on newly created runs. */
    agent_target: AgentKeySchema.nullable().default(null),
  })
  .strict();
/** Input remains compatible with callers that predate the use-case field. */
export type AnalysisRequest = z.input<typeof AnalysisRequestSchema>;
export type ResolvedAnalysisRequest = z.output<typeof AnalysisRequestSchema>;

export const CSV_COLUMNS = [
  'snapshot_date',
  'market_external_id',
  'market_name',
  'project_external_id',
  'project_name',
  'zone_external_id',
  'zone_name',
  'unit_external_id',
  'unit_code',
  'unit_type',
  'area_sqm',
  'list_price',
  'currency',
  'status',
  'available_since',
  'sold_at',
] as const;
const ExternalId = z.string().trim().min(1).max(100);
export const SnapshotRowSchema = z
  .object({
    snapshot_date: DateSchema,
    market_external_id: ExternalId,
    market_name: z.string().min(1).max(200),
    project_external_id: ExternalId,
    project_name: z.string().min(1).max(200),
    zone_external_id: ExternalId,
    zone_name: z.string().min(1).max(200),
    unit_external_id: ExternalId,
    unit_code: z.string().min(1).max(100),
    unit_type: ExternalId,
    area_sqm: DecimalSchema.nullable(),
    list_price: DecimalSchema.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['available', 'reserved', 'sold', 'held', 'unknown']),
    available_since: DateSchema.nullable(),
    sold_at: DateSchema.nullable(),
    bedrooms: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()
  .superRefine((row, ctx) => {
    for (const key of ['available_since', 'sold_at'] as const) {
      if (row[key] && row[key] > row.snapshot_date)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Date cannot follow snapshot_date' });
    }
  });
export type SnapshotRow = z.infer<typeof SnapshotRowSchema>;
export const UnitSnapshotSchema = SnapshotRowSchema.safeExtend({
  org_id: IdSchema,
  snapshot_id: IdSchema,
  import_id: IdSchema,
});
export type UnitSnapshot = z.infer<typeof UnitSnapshotSchema>;
export const ImportManifestSchema = z.object({
  import_id: IdSchema,
  org_id: IdSchema,
  created_by: IdSchema,
  created_at: TimestampSchema,
  source_name: z.string(),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/),
  row_count: z.number().int().nonnegative(),
  storage_path: z.string().nullable(),
  schema_version: z.literal('csv-v1'),
  provisional: z.literal(true),
});
export type ImportManifest = z.infer<typeof ImportManifestSchema>;
export const ImportRequestSchema = z
  .object({
    org_id: IdSchema,
    source_name: z.string().min(1).max(200),
    csv: z.string().min(1).max(2_000_000),
  })
  .strict();

export const TASK_KINDS = [
  'orchestrator',
  'coordinator',
  'data',
  'calculation',
  'chart',
  'comparison',
  'analyst',
  'insight',
  'validation',
  'report',
  'reviewer',
  'publication',
] as const;
export const RunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const RunTaskSchema = z.object({
  task_id: IdSchema,
  run_id: IdSchema,
  org_id: IdSchema,
  kind: z.enum(TASK_KINDS),
  dependencies: z.array(z.enum(TASK_KINDS)),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  attempt: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
});
export type RunTask = z.infer<typeof RunTaskSchema>;
export const RunEventSchema = z.object({
  event_id: IdSchema,
  run_id: IdSchema,
  org_id: IdSchema,
  created_at: TimestampSchema,
  task_id: IdSchema.nullable(),
  message: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
export const RunSchema = z.object({
  run_id: IdSchema,
  org_id: IdSchema,
  created_by: IdSchema,
  request: AnalysisRequestSchema,
  status: RunStatusSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  idempotency_key: z.string(),
  request_hash: z.string(),
  entrypoint: z.enum(['interactive', 'scheduled']),
  occurrence_id: IdSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  fencing_token: z.number().int().nonnegative(),
  lease_until: TimestampSchema.nullable(),
  error_code: z.string().nullable(),
  report_artifact_id: IdSchema.nullable(),
  cancel_requested: z.boolean(),
  /** Absent on historical payloads; nested request.use_case is the source of truth. */
  workflow_version: WorkflowVersionSchema.optional(),
});
export type AnalysisRun = z.infer<typeof RunSchema>;

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
export const DECISION_BRIEF_VERSION = 'decision-brief-v1' as const;
export const DecisionSignalKindSchema = z.enum([
  'current_state',
  'material_change',
  'segment_concentration',
  'data_quality',
]);
export const DecisionEvidenceRoleSchema = z.enum([
  'current',
  'comparison',
  'delta',
  'support',
  'denominator',
]);
export const DecisionEvidenceRefSchema = z
  .object({
    role: DecisionEvidenceRoleSchema,
    artifact_id: IdSchema,
    path: z.string().min(1),
  })
  .strict();
export const DecisionSignalSchema = z
  .object({
    signal_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    rule_id: z.string().min(1),
    kind: DecisionSignalKindSchema,
    label: z.string().min(1),
    summary: z.string().min(1),
    metric_key: MetricKeySchema,
    dimension: z.enum(['zone', 'unit_type', 'bedrooms', 'status']).nullable(),
    segment_key: z.string().min(1).nullable(),
    current_value: MetricValueSchema.nullable(),
    comparison_value: MetricValueSchema.nullable(),
    delta: DeltaValueSchema.nullable(),
    support_value: MetricValueSchema.nullable(),
    denominator_value: MetricValueSchema.nullable(),
    unit: MetricUnitSchema,
    delta_unit: MetricUnitSchema.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    status: z.enum(['available', 'unavailable']),
    abstention_reason: AbstentionReasonSchema.nullable(),
    limitations: z.array(z.string()),
    evidence: z.array(DecisionEvidenceRefSchema),
  })
  .strict()
  .superRefine((signal, ctx) => {
    const values = [
      signal.current_value,
      signal.comparison_value,
      signal.delta,
      signal.support_value,
      signal.denominator_value,
    ];
    if (signal.status === 'available' && values.every((value) => value === null))
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Available signal needs a value' });
    if (signal.status === 'unavailable' && signal.abstention_reason === null)
      ctx.addIssue({
        code: 'custom',
        path: ['abstention_reason'],
        message: 'Unavailable signal needs an abstention reason',
      });
    const monetary = signal.unit === 'currency' || signal.unit === 'currency_per_sqm';
    if (signal.status === 'available' && monetary && signal.currency === null)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Available monetary signal requires currency metadata',
      });
    if (!monetary && signal.currency !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Non-monetary signal cannot declare currency metadata',
      });
    const roles = signal.evidence.map((item) => item.role);
    if (new Set(roles).size !== roles.length)
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'Duplicate evidence role' });
  });
export type DecisionSignal = z.infer<typeof DecisionSignalSchema>;
export const SupportedNextActionSchema = z
  .object({
    action_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    kind: z.enum(['review_evidence', 'review_inventory_units']),
    label: z.string().min(1),
    target_signal_id: z.string().nullable(),
    artifact_id: IdSchema,
  })
  .strict();
export type SupportedNextAction = z.infer<typeof SupportedNextActionSchema>;
/** These actions are investigation/navigation candidates, never autonomous business actions. */
export const DecisionActionKindSchema = z.enum([
  'inspect_entities',
  'compare_segments',
  'review_pricing',
  'review_demand',
  'review_sales_activity',
  'validate_candidate_driver',
  'open_report_section',
  'navigate_to_evidence',
]);
export type DecisionActionKind = z.infer<typeof DecisionActionKindSchema>;
export const PriorityEntityTypeSchema = z.enum([
  'unit',
  'zone',
  'unit_type',
  'bedrooms',
  'status',
  'project',
]);
export type PriorityEntityType = z.infer<typeof PriorityEntityTypeSchema>;
export const DecisionBriefSchema = z
  .object({
    version: z.literal(DECISION_BRIEF_VERSION),
    scope: ScopeSchema,
    requested_data_as_of: DateSchema,
    effective_snapshot_date: DateSchema.nullable(),
    current_state: z.array(DecisionSignalSchema),
    material_changes: z.array(DecisionSignalSchema),
    where_to_look: z.array(DecisionSignalSchema),
    data_quality: z.array(DecisionSignalSchema),
    next_actions: z.array(SupportedNextActionSchema),
    limitations: z.array(z.string()),
  })
  .strict()
  .superRefine((brief, ctx) => {
    const signals = [
      ...brief.current_state,
      ...brief.material_changes,
      ...brief.where_to_look,
      ...brief.data_quality,
    ];
    const signalIds = signals.map((signal) => signal.signal_id);
    if (new Set(signalIds).size !== signalIds.length)
      ctx.addIssue({ code: 'custom', path: ['current_state'], message: 'Duplicate signal ID' });
    const actionIds = brief.next_actions.map((action) => action.action_id);
    if (new Set(actionIds).size !== actionIds.length)
      ctx.addIssue({ code: 'custom', path: ['next_actions'], message: 'Duplicate action ID' });
    brief.next_actions.forEach((action, index) => {
      if (action.target_signal_id !== null && !signalIds.includes(action.target_signal_id))
        ctx.addIssue({
          code: 'custom',
          path: ['next_actions', index, 'target_signal_id'],
          message: 'Unknown target signal',
        });
    });
  });
export type DecisionBrief = z.infer<typeof DecisionBriefSchema>;
/** Explicit historical aliases keep report and /brief consumers byte-compatible. */
export const DecisionBriefV1Schema = DecisionBriefSchema;
export type DecisionBriefV1 = DecisionBrief;
export const ReportSectionSchema = z.object({
  key: z.enum([
    'executive_summary',
    'inventory_overview',
    'trend',
    'aging_analysis',
    'price_analysis',
    'segment_analysis',
    'comparison',
    'data_quality_limitations',
    'evidence_lineage',
  ]),
  title: z.string(),
  artifact_refs: z.array(IdSchema),
  metric_keys: z.array(MetricKeySchema),
  status: z.enum(['available', 'limited', 'unavailable']),
  limitations: z.array(z.string()),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;
export const ReportPayloadSchema = z.object({
  title: z.string(),
  summary: z.string(),
  claims: z.array(ClaimSchema),
  metrics: z.array(MetricSchema),
  units: z.array(CalculatedUnitSchema),
  calculation_artifact_id: IdSchema,
  chart_artifact_id: IdSchema,
  comparison_artifact_id: IdSchema,
  sections: z.array(ReportSectionSchema),
  limitations: z.array(z.string()),
  decision_brief: DecisionBriefSchema.optional(),
  /** Canonical v2 pack for new runs; the embedded v1 brief remains a compatibility projection. */
  decision_intelligence_artifact_id: IdSchema.optional(),
});
export type ReportPayload = z.infer<typeof ReportPayloadSchema>;

// Agent-workflow contracts are deliberately separate from the legacy artifact
// union below.  Phase A only establishes typed boundaries; writers are added
// behind the agent workflow version after persistence support is available.
export const UseCaseCapabilitySchema = z.enum([
  'analysis',
  'comparison',
  'chart',
  'analyst_follow_up',
  'report_revision',
]);
export type UseCaseCapability = z.infer<typeof UseCaseCapabilitySchema>;
export const DecisionMaterialityRuleSchema = z
  .object({
    rule_id: z.string().trim().min(1).max(160),
    metric_key: MetricKeySchema,
    delta_kind: z.enum(['relative_pct', 'percentage_points']),
    watch_threshold: z.number().positive(),
    material_threshold: z.number().positive(),
    direction: z.enum(['higher_is_worse', 'higher_is_better', 'context_only']),
    comparability_required: z.literal(true),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.material_threshold < rule.watch_threshold)
      ctx.addIssue({
        code: 'custom',
        path: ['material_threshold'],
        message: 'Material threshold must be at least the watch threshold',
      });
  });
export type DecisionMaterialityRule = z.infer<typeof DecisionMaterialityRuleSchema>;
export const DecisionPriorityPolicySchema = z
  .object({
    entity_types: z.array(PriorityEntityTypeSchema).min(1).max(6),
    max_units: z.number().int().min(1).max(20),
    max_segments: z.number().int().min(1).max(20),
    max_total: z.number().int().min(1).max(40),
    tie_breakers: z.array(z.enum(['entity_type', 'entity_key'])).min(1).max(2),
  })
  .strict();
export type DecisionPriorityPolicy = z.infer<typeof DecisionPriorityPolicySchema>;
export const DecisionActionPolicySchema = z
  .object({
    rule_id: z.string().trim().min(1).max(160),
    kind: DecisionActionKindSchema,
    min_support: z.enum(['high', 'medium', 'exploratory']),
    target_entity_types: z.array(PriorityEntityTypeSchema).max(6),
    label_template_id: z.string().trim().min(1).max(160),
    rationale_template_id: z.string().trim().min(1).max(160),
  })
  .strict();
export type DecisionActionPolicy = z.infer<typeof DecisionActionPolicySchema>;
export const DecisionVisualizationPolicySchema = z
  .object({
    preferred_intents: z.array(ChartIntentSchema).min(1).max(8),
    primary_cap: z.number().int().min(1).max(3),
    comparison_required_intents: z.array(ChartIntentSchema).max(8),
  })
  .strict();
export type DecisionVisualizationPolicy = z.infer<typeof DecisionVisualizationPolicySchema>;
export const DecisionAudienceProfileSchema = z
  .object({
    audience_key: z.literal('sales_operations'),
    decision_horizon: z.string().trim().min(1).max(160),
    terminology: z.enum(['concise_operational']),
    visible_limitations_required: z.literal(true),
  })
  .strict();
export type DecisionAudienceProfile = z.infer<typeof DecisionAudienceProfileSchema>;
export const DecisionUseCasePolicySchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    materiality: z.array(DecisionMaterialityRuleSchema).min(1).max(30),
    priority: DecisionPriorityPolicySchema,
    actions: z.array(DecisionActionPolicySchema).min(1).max(20),
    visualization: DecisionVisualizationPolicySchema,
    audience: DecisionAudienceProfileSchema,
  })
  .strict();
export type DecisionUseCasePolicy = z.infer<typeof DecisionUseCasePolicySchema>;
export const UseCaseDefinitionSchema = z
  .object({
    contract_version: z.union([z.literal('use-case-v1'), z.literal(USE_CASE_CONTRACT_VERSION)]),
    key: UseCaseKeySchema,
    version: z.string().trim().min(1).max(100),
    display_name: z.string().trim().min(1).max(200),
    scope_policy: z
      .object({ project_required: z.literal(true), zone_optional: z.literal(true) })
      .strict(),
    comparison_windows_days: z
      .array(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .min(1)
      .max(3),
    required_fields: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    supported_dimensions: z
      .array(z.enum(['project', 'zone', 'unit_type', 'bedrooms', 'status']))
      .min(1)
      .max(10),
    capabilities: z.array(UseCaseCapabilitySchema).min(1).max(10),
    provisional_limitation: z.string().trim().min(1).max(2_000),
    /** Required for v2 registry entries; absent historical definitions remain parseable. */
    decision_policy: DecisionUseCasePolicySchema.optional(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.contract_version === USE_CASE_CONTRACT_VERSION && !definition.decision_policy)
      ctx.addIssue({
        code: 'custom',
        path: ['decision_policy'],
        message: 'A v2 use-case definition requires a decision policy',
      });
  });
export type UseCaseDefinition = z.infer<typeof UseCaseDefinitionSchema>;

export const CanonicalEvidenceRefSchema = z
  .object({
    artifact_id: IdSchema,
    artifact_key: z.string().trim().min(1).max(160),
    path: z.string().trim().min(1).max(500),
  })
  .strict();
export type CanonicalEvidenceRef = z.infer<typeof CanonicalEvidenceRefSchema>;
export const CanonicalMetricRefSchema = CanonicalEvidenceRefSchema.extend({
  metric_key: MetricKeySchema,
}).strict();
export type CanonicalMetricRef = z.infer<typeof CanonicalMetricRefSchema>;
export const EntityRefSchema = z
  .object({
    type: PriorityEntityTypeSchema,
    key: z.string().trim().min(1).max(300),
    label: z.string().trim().min(1).max(500),
  })
  .strict();
export type EntityRef = z.infer<typeof EntityRefSchema>;
export const ArtifactHandoffSchema = z
  .object({
    completeness: z.enum(['complete', 'partial', 'insufficient']),
    available_components: z.array(z.string().trim().min(1).max(100)).max(100),
    missing_components: z
      .array(
        z
          .object({
            component: z.string().trim().min(1).max(100),
            reason: z.string().trim().min(1).max(2_000),
            required_for_publication: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    optional_inputs_present: z.array(z.string().trim().min(1).max(100)).max(100),
    optional_inputs_missing: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .strict();
export type ArtifactHandoff = z.infer<typeof ArtifactHandoffSchema>;
export const DecisionKpiCardSchema = z
  .object({
    kpi_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    label: z.string().trim().min(1).max(300),
    metric_key: MetricKeySchema,
    value: MetricValueSchema.nullable(),
    unit: MetricUnitSchema,
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    status: z.enum(['available', 'unavailable']),
    metric_ref: CanonicalMetricRefSchema,
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type DecisionKpiCard = z.infer<typeof DecisionKpiCardSchema>;
export const MaterialChangeSchema = z
  .object({
    change_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    rule_id: z.string().trim().min(1).max(160),
    metric_key: MetricKeySchema,
    period_days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    current_value: MetricValueSchema,
    comparison_value: MetricValueSchema,
    delta: DeltaValueSchema,
    delta_unit: MetricUnitSchema,
    unit: MetricUnitSchema,
    direction: z.enum(['improving', 'deteriorating', 'context_only']),
    severity: z.enum(['watch', 'material']),
    comparable: z.literal(true),
    metric_refs: z.array(CanonicalMetricRefSchema).min(2).max(4),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type MaterialChange = z.infer<typeof MaterialChangeSchema>;
export const HotspotSchema = z
  .object({
    hotspot_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    entity: EntityRefSchema,
    metric_key: MetricKeySchema,
    value: MetricValueSchema,
    unit: MetricUnitSchema,
    metric_ref: CanonicalMetricRefSchema,
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type Hotspot = z.infer<typeof HotspotSchema>;
export const BusinessImplicationSchema = z
  .object({
    implication_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    kind: z.enum(['descriptive', 'candidate']),
    support_level: z.enum(['high', 'medium', 'limited']),
    template_id: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(2_000),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type BusinessImplication = z.infer<typeof BusinessImplicationSchema>;
export const DecisionWatchoutSchema = z
  .object({
    watchout_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    label: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(2_000),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).max(20),
  })
  .strict();
export type DecisionWatchout = z.infer<typeof DecisionWatchoutSchema>;
export const DataQualitySummarySchema = z
  .object({
    status: z.enum(['available', 'limited', 'unavailable']),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
  })
  .strict();
export type DataQualitySummary = z.infer<typeof DataQualitySummarySchema>;
export const DECISION_BRIEF_V2_VERSION = 'decision-brief-v2' as const;
export const DecisionBriefV2Schema = z
  .object({
    version: z.literal(DECISION_BRIEF_V2_VERSION),
    headline: z.string().trim().min(1).max(1_000),
    status: z.enum(['improving', 'stable', 'deteriorating', 'mixed', 'insufficient_evidence']),
    scope: ScopeSchema,
    requested_data_as_of: DateSchema,
    effective_snapshot_date: DateSchema.nullable(),
    semantic_version: z.string().trim().min(1).max(100),
    kpi_cards: z.array(DecisionKpiCardSchema).max(12),
    material_changes: z.array(MaterialChangeSchema).max(20),
    hotspots: z.array(HotspotSchema).max(20),
    business_implications: z.array(BusinessImplicationSchema).max(20),
    watchouts: z.array(DecisionWatchoutSchema).max(30),
    data_quality_summary: DataQualitySummarySchema,
    primary_visual_ids: z.array(z.string().trim().min(1).max(300)).max(3),
    priority_entity_ids: z.array(z.string().trim().min(1).max(300)).max(40),
    action_candidate_ids: z.array(z.string().trim().min(1).max(300)).max(40),
    drilldown_ids: z.array(z.string().trim().min(1).max(300)).max(100),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();
export type DecisionBriefV2 = z.infer<typeof DecisionBriefV2Schema>;
export const AnyDecisionBriefSchema = z.discriminatedUnion('version', [
  DecisionBriefV1Schema,
  DecisionBriefV2Schema,
]);
export type AnyDecisionBrief = z.infer<typeof AnyDecisionBriefSchema>;
export const VisualStorySchema = z
  .object({
    version: z.literal('visual-story-v1'),
    headline: z.string().trim().min(1).max(1_000),
    ordered_visuals: z
      .array(
        z
          .object({
            chart_id: z.string().trim().min(1).max(300),
            role: z.enum(['primary', 'supporting']),
            display_priority: z.number().int().min(1).max(100),
            reason: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .max(20),
    primary_visual_ids: z.array(z.string().trim().min(1).max(300)).max(3),
    supporting_visual_ids: z.array(z.string().trim().min(1).max(300)).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();
export type VisualStory = z.infer<typeof VisualStorySchema>;
export const PriorityEntitySchema = z
  .object({
    priority_entity_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    entity: EntityRefSchema,
    rank: z.number().int().positive(),
    tier: z.enum(['critical', 'high', 'medium', 'watch']),
    policy_rule_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
    reason_codes: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
    metric_refs: z.array(CanonicalMetricRefSchema).min(1).max(20),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    support_level: z.enum(['high', 'medium', 'limited']),
    action_candidate_ids: z.array(z.string().trim().min(1).max(300)).max(20),
    drilldown_ids: z.array(z.string().trim().min(1).max(300)).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type PriorityEntity = z.infer<typeof PriorityEntitySchema>;
export const DrillDownContextSchema = z
  .object({
    run_id: IdSchema,
    org_id: IdSchema,
    use_case: UseCaseKeySchema,
    use_case_version: z.string().trim().min(1).max(100),
    scope: ScopeSchema,
    requested_data_as_of: DateSchema,
    effective_snapshot_date: DateSchema.nullable(),
    semantic_version: z.string().trim().min(1).max(100),
    snapshot_refs: z.array(IdSchema).max(20_000),
  })
  .strict();
export type DrillDownContext = z.infer<typeof DrillDownContextSchema>;
export const TypedFilterSchema = z
  .object({
    dimension: z.enum(['project', 'zone', 'unit_type', 'bedrooms', 'status']),
    operator: z.literal('equals'),
    value: z.string().trim().min(1).max(300),
  })
  .strict();
export type TypedFilter = z.infer<typeof TypedFilterSchema>;
const DrillDownBaseSchema = z.object({
  drilldown_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
  label: z.string().trim().min(1).max(500),
  context: DrillDownContextSchema,
});
export const DrillDownSchema = z.discriminatedUnion('kind', [
  DrillDownBaseSchema.extend({
    kind: z.literal('open_report_section'),
    section_key: ReportSectionSchema.shape.key,
  }).strict(),
  DrillDownBaseSchema.extend({
    kind: z.literal('open_chart'),
    chart_id: z.string().trim().min(1).max(300),
    chart_pack_artifact_id: IdSchema,
  }).strict(),
  DrillDownBaseSchema.extend({
    kind: z.literal('open_evidence'),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
  }).strict(),
  DrillDownBaseSchema.extend({
    kind: z.literal('inspect_entities'),
    entity_refs: z.array(EntityRefSchema).min(1).max(20),
    filters: z.array(TypedFilterSchema).max(10),
  }).strict(),
  DrillDownBaseSchema.extend({
    kind: z.literal('compare_segment'),
    dimension: z.enum(['zone', 'unit_type', 'bedrooms', 'status']),
    segment_key: z.string().trim().min(1).max(300),
  }).strict(),
  DrillDownBaseSchema.extend({
    kind: z.literal('start_scoped_analysis'),
    target_scope: ScopeSchema,
  }).strict(),
]);
export type DrillDown = z.infer<typeof DrillDownSchema>;
export const ActionCandidateSchema = z
  .object({
    action_candidate_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    kind: DecisionActionKindSchema,
    label: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(2_000),
    policy_rule_id: z.string().trim().min(1).max(160),
    support_level: z.enum(['high', 'medium', 'exploratory']),
    target_entity_ids: z.array(z.string().trim().min(1).max(300)).max(20),
    target_signal_ids: z.array(z.string().trim().min(1).max(300)).max(20),
    drilldown_id: z.string().trim().min(1).max(300),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(30),
  })
  .strict();
export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;
export const WorkflowPackMetadataSchema = z
  .object({
    contract_version: z.string().trim().min(1).max(100),
    pack_id: IdSchema,
    run_id: IdSchema,
    org_id: IdSchema,
    use_case: UseCaseKeySchema,
    use_case_version: z.string().trim().min(1).max(100),
    scope: ScopeSchema,
    data_as_of: DateSchema,
    semantic_version: z.string().trim().min(1).max(100),
    input_refs: z.array(IdSchema).max(100),
    snapshot_refs: z.array(IdSchema).max(20_000),
    source_refs: z.array(IdSchema).max(20_000),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();
export type WorkflowPackMetadata = z.infer<typeof WorkflowPackMetadataSchema>;

export const CoordinatorDecisionSchema = z
  .object({
    contract_version: z.literal('coordinator-decision-v1'),
    decision_id: IdSchema,
    org_id: IdSchema,
    use_case: UseCaseKeySchema,
    use_case_version: z.string().trim().min(1).max(100),
    scope: ScopeSchema,
    requested_data_as_of: DateSchema,
    effective_data_as_of: DateSchema,
    comparison_windows_days: z
      .array(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .min(1)
      .max(3),
    entrypoint: z.enum(['interactive', 'scheduled']),
    requested_capability: UseCaseCapabilitySchema,
    agent_target: AgentKeySchema.nullable(),
    action: z.enum(['new_run', 'reuse_result', 'unsupported']),
    reuse_run_id: IdSchema.nullable(),
    unsupported_reason: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'reuse_result' && !value.reuse_run_id)
      ctx.addIssue({ code: 'custom', path: ['reuse_run_id'], message: 'Reuse requires a run id' });
    if (value.action !== 'reuse_result' && value.reuse_run_id)
      ctx.addIssue({
        code: 'custom',
        path: ['reuse_run_id'],
        message: 'Only reuse may name a run',
      });
    if (value.action === 'unsupported' && !value.unsupported_reason)
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Unsupported decisions need a reason',
      });
    if (value.action !== 'unsupported' && value.unsupported_reason)
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Only unsupported decisions include a reason',
      });
  });
export type CoordinatorDecision = z.infer<typeof CoordinatorDecisionSchema>;

export const DataAnalysisPackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('data-analysis-pack-v1'),
  metric_config: z.object({ slow_moving_threshold_days: z.number().int().positive() }).strict(),
  dataset: z
    .object({
      row_count: z.number().int().nonnegative(),
      query_artifact_id: IdSchema,
      query_result_artifact_id: IdSchema,
      calculation_artifact_id: IdSchema,
      comparison_calculation_artifact_id: IdSchema,
      /** A legacy-report/chart adapter produced by the Data boundary, never by a peer branch. */
      comparison_artifact_id: IdSchema,
    })
    .strict(),
  metrics: z.array(MetricSchema).max(100),
  // The approved pinned-read boundary is 20,000 rows. Do not silently
  // truncate deterministic unit or peer inputs when constructing a pack.
  units: z.array(CalculatedUnitSchema).max(20_000),
  age_buckets: CalculationPayloadSchema.shape.age_buckets,
  breakdowns: CalculationPayloadSchema.shape.breakdowns,
  period_comparisons: CalculationPayloadSchema.shape.period_comparisons,
  segment_comparisons: CalculationPayloadSchema.shape.segment_comparisons,
  notable_changes: CalculationPayloadSchema.shape.notable_changes,
  peer_items: z.array(ComparisonItemSchema).max(20_000),
  insight_candidates: CalculationPayloadSchema.shape.insight_candidates,
  quality_limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
});
export type DataAnalysisPack = z.infer<typeof DataAnalysisPackSchema>;

export const ComparisonPackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('comparison-pack-v1'),
  data_analysis_pack_artifact_id: IdSchema,
  comparisons: z.array(ComparisonItemSchema).max(20_000),
  period_comparisons: CalculationPayloadSchema.shape.period_comparisons,
  segment_comparisons: CalculationPayloadSchema.shape.segment_comparisons,
  notable_changes: CalculationPayloadSchema.shape.notable_changes,
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
});
export type ComparisonPack = z.infer<typeof ComparisonPackSchema>;

export const ChartPackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('chart-pack-v1'),
  data_analysis_pack_artifact_id: IdSchema,
  charts: z.array(ChartSpecSchema).max(100),
  unavailable: z.array(ChartUnavailableSchema).max(100),
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
});
export type ChartPack = z.infer<typeof ChartPackSchema>;

export const AnalysisFindingSchema = z
  .object({
    finding_id: z.string().trim().min(1).max(300),
    candidate_id: z.string().trim().min(1).max(300),
    category: z.enum([
      'concentration',
      'anomaly',
      'current_state',
      'data_quality',
      'trend',
      'segment',
    ]),
    kind: z.enum(['descriptive', 'interpretive']),
    statement: z.string().trim().min(1).max(2_000),
    metric_key: MetricKeySchema,
    support_level: z.enum(['high', 'medium', 'limited']),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(20),
  })
  .strict();
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;
export const AnalysisPackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('analysis-pack-v1'),
  data_analysis_pack_artifact_id: IdSchema,
  findings: z.array(AnalysisFindingSchema).max(100),
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
});
export type AnalysisPack = z.infer<typeof AnalysisPackSchema>;

export const InsightPackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('insight-pack-v1'),
  data_analysis_pack_artifact_id: IdSchema,
  comparison_pack_artifact_id: IdSchema,
  chart_pack_artifact_id: IdSchema,
  analysis_pack_artifact_id: IdSchema,
  summary: z.string().trim().min(1).max(5_000),
  claims: z.array(ClaimSchema).max(100),
  selected_finding_ids: z.array(z.string().trim().min(1).max(300)).max(100),
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
  provider: z.enum(['deterministic', 'gemini', 'openai']),
});
export type InsightPack = z.infer<typeof InsightPackSchema>;

export const DECISION_INTELLIGENCE_PACK_VERSION = 'decision-intelligence-pack-v1' as const;
export const DecisionIntelligencePackSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal(DECISION_INTELLIGENCE_PACK_VERSION),
  requested_data_as_of: DateSchema,
  effective_snapshot_date: DateSchema.nullable(),
  data_analysis_pack_artifact_id: IdSchema,
  comparison_pack_artifact_id: IdSchema,
  chart_pack_artifact_id: IdSchema,
  analysis_pack_artifact_id: IdSchema,
  insight_pack_artifact_id: IdSchema,
  decision_brief: DecisionBriefV2Schema,
  visual_story: VisualStorySchema,
  priority_entities: z.array(PriorityEntitySchema).max(40),
  action_candidates: z.array(ActionCandidateSchema).max(40),
  drilldowns: z.array(DrillDownSchema).max(100),
  handoff: ArtifactHandoffSchema,
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
}).superRefine((pack, ctx) => {
  const unique = (values: string[], path: (string | number)[]) => {
    if (new Set(values).size !== values.length)
      ctx.addIssue({ code: 'custom', path, message: 'Duplicate identifier' });
  };
  const entities = pack.priority_entities.map((entity) => entity.priority_entity_id);
  const actions = pack.action_candidates.map((action) => action.action_candidate_id);
  const drilldowns = pack.drilldowns.map((drilldown) => drilldown.drilldown_id);
  unique(entities, ['priority_entities']);
  unique(actions, ['action_candidates']);
  unique(drilldowns, ['drilldowns']);
  const ranks = pack.priority_entities.map((entity) => entity.rank).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1))
    ctx.addIssue({ code: 'custom', path: ['priority_entities'], message: 'Ranks must be contiguous' });
  if (
    pack.decision_brief.primary_visual_ids.length > 3 ||
    new Set(pack.decision_brief.primary_visual_ids).size !== pack.decision_brief.primary_visual_ids.length
  )
    ctx.addIssue({ code: 'custom', path: ['decision_brief', 'primary_visual_ids'], message: 'Invalid primary visuals' });
  const visualIds = pack.visual_story.ordered_visuals.map((visual) => visual.chart_id);
  unique(visualIds, ['visual_story', 'ordered_visuals']);
  if (
    pack.decision_brief.primary_visual_ids.some((id) => !visualIds.includes(id)) ||
    pack.visual_story.primary_visual_ids.some((id) => !visualIds.includes(id))
  )
    ctx.addIssue({ code: 'custom', path: ['visual_story'], message: 'Unknown visual reference' });
  if (
    pack.decision_brief.priority_entity_ids.some((id) => !entities.includes(id)) ||
    pack.decision_brief.action_candidate_ids.some((id) => !actions.includes(id)) ||
    pack.decision_brief.drilldown_ids.some((id) => !drilldowns.includes(id))
  )
    ctx.addIssue({ code: 'custom', path: ['decision_brief'], message: 'Unknown decision component' });
  for (const [index, entity] of pack.priority_entities.entries()) {
    if (
      entity.action_candidate_ids.some((id) => !actions.includes(id)) ||
      entity.drilldown_ids.some((id) => !drilldowns.includes(id))
    )
      ctx.addIssue({ code: 'custom', path: ['priority_entities', index], message: 'Unknown entity target' });
  }
  for (const [index, action] of pack.action_candidates.entries()) {
    if (
      action.target_entity_ids.some((id) => !entities.includes(id)) ||
      !drilldowns.includes(action.drilldown_id)
    )
      ctx.addIssue({ code: 'custom', path: ['action_candidates', index], message: 'Unknown action target' });
  }
  for (const [index, drilldown] of pack.drilldowns.entries()) {
    if (
      drilldown.context.run_id !== pack.run_id ||
      drilldown.context.org_id !== pack.org_id ||
      drilldown.context.use_case !== pack.use_case ||
      drilldown.context.use_case_version !== pack.use_case_version ||
      drilldown.context.requested_data_as_of !== pack.requested_data_as_of ||
      drilldown.context.effective_snapshot_date !== pack.effective_snapshot_date ||
      drilldown.context.semantic_version !== pack.semantic_version ||
      JSON.stringify(drilldown.context.scope) !== JSON.stringify(pack.scope)
    )
      ctx.addIssue({ code: 'custom', path: ['drilldowns', index, 'context'], message: 'Drill-down context must match the pack' });
  }
});
export type DecisionIntelligencePack = z.infer<typeof DecisionIntelligencePackSchema>;

export const ReportDraftSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('report-draft-v1'),
  draft_id: IdSchema,
  revision: z.number().int().min(1).max(2),
  data_analysis_pack_artifact_id: IdSchema,
  comparison_pack_artifact_id: IdSchema,
  chart_pack_artifact_id: IdSchema,
  analysis_pack_artifact_id: IdSchema,
  insight_pack_artifact_id: IdSchema,
  /** Required by the agent-v1 graph for newly produced decision-ready drafts. */
  decision_intelligence_artifact_id: IdSchema.optional(),
  report: ReportPayloadSchema,
  evidence_refs: z.array(CanonicalEvidenceRefSchema).min(1).max(2_000),
});
export type ReportDraft = z.infer<typeof ReportDraftSchema>;

export const ReviewIssueSchema = z
  .object({
    issue_id: z.string().trim().min(1).max(300),
    severity: z.enum(['blocking', 'warning']),
    category: z.enum([
      'evidence',
      'metric_mismatch',
      'chart_mismatch',
      'scope_date',
      'contradiction',
      'overstatement',
      'limitation',
    ]),
    claim_id: z.string().trim().min(1).max(500).nullable(),
    message: z.string().trim().min(1).max(2_000),
    required_correction: z.string().trim().min(1).max(2_000).nullable(),
    evidence_refs: z.array(CanonicalEvidenceRefSchema).max(20),
  })
  .strict();
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export const ReviewResultSchema = WorkflowPackMetadataSchema.extend({
  contract_version: z.literal('review-result-v1'),
  review_id: IdSchema,
  draft_artifact_id: IdSchema,
  draft_id: IdSchema,
  draft_revision: z.number().int().min(1).max(2),
  draft_content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['PASS', 'REVISION_REQUIRED']),
  issues: z.array(ReviewIssueSchema).max(100),
  summary: z.string().trim().min(1).max(5_000),
  provider: z.enum(['deterministic', 'gemini', 'openai']),
}).superRefine((value, ctx) => {
  if (value.status === 'PASS' && value.issues.some((issue) => issue.severity === 'blocking'))
    ctx.addIssue({
      code: 'custom',
      path: ['issues'],
      message: 'PASS cannot contain blocking issues',
    });
  if (
    value.status === 'REVISION_REQUIRED' &&
    !value.issues.some((issue) => issue.severity === 'blocking')
  )
    ctx.addIssue({
      code: 'custom',
      path: ['issues'],
      message: 'Revision requires a blocking issue',
    });
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

const ArtifactBase = z.object({
  artifact_id: IdSchema,
  org_id: IdSchema,
  run_id: IdSchema,
  task_id: IdSchema,
  schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
  created_at: TimestampSchema,
  semantic_version: z.literal(SEMANTIC_VERSION),
  provisional: z.literal(true),
  data_as_of: DateSchema,
  input_refs: z.array(IdSchema),
  snapshot_refs: z.array(IdSchema),
  source_refs: z.array(IdSchema),
  limitations: z.array(z.string()),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ArtifactSchema = z.discriminatedUnion('kind', [
  ArtifactBase.extend({ kind: z.literal('analysis_request'), payload: AnalysisRequestSchema }),
  ArtifactBase.extend({
    kind: z.literal('analysis_plan'),
    payload: z.object({
      steps: z.array(
        z.object({ kind: z.enum(TASK_KINDS), dependencies: z.array(z.enum(TASK_KINDS)) }),
      ),
      scope: ScopeSchema,
    }),
  }),
  ArtifactBase.extend({
    kind: z.literal('query'),
    payload: z.object({
      sql: z.string(),
      parameters: z.array(z.string().nullable()),
      row_limit: z.number().int().positive(),
      timeout_ms: z.number().int().positive(),
    }),
  }),
  ArtifactBase.extend({
    kind: z.literal('query_result'),
    payload: z.object({
      rows: z.array(UnitSnapshotSchema),
      row_count: z.number().int().nonnegative(),
      truncated: z.literal(false),
    }),
  }),
  ArtifactBase.extend({ kind: z.literal('calculation'), payload: CalculationPayloadSchema }),
  ArtifactBase.extend({
    kind: z.literal('coordinator_decision'),
    payload: CoordinatorDecisionSchema,
  }),
  ArtifactBase.extend({ kind: z.literal('data_analysis_pack'), payload: DataAnalysisPackSchema }),
  ArtifactBase.extend({
    kind: z.literal('visual_evidence'),
    payload: VisualEvidencePayloadSchema,
  }),
  ArtifactBase.extend({
    kind: z.literal('comparison_calculation'),
    payload: z.object({
      items: z.array(ComparisonItemSchema),
      rounding: z.literal('decimal-half-up-6dp'),
      rule: z.string(),
    }),
  }),
  ArtifactBase.extend({
    kind: z.literal('comparison'),
    payload: z.object({
      items: z.array(ComparisonItemSchema),
      period_comparisons: CalculationPayloadSchema.shape.period_comparisons,
      segment_comparisons: CalculationPayloadSchema.shape.segment_comparisons,
      calculation_artifact_id: IdSchema,
    }),
  }),
  ArtifactBase.extend({ kind: z.literal('comparison_pack'), payload: ComparisonPackSchema }),
  ArtifactBase.extend({ kind: z.literal('chart_pack'), payload: ChartPackSchema }),
  ArtifactBase.extend({ kind: z.literal('analysis_pack'), payload: AnalysisPackSchema }),
  ArtifactBase.extend({
    kind: z.literal('insight'),
    payload: z.object({
      summary: z.string(),
      claims: z.array(ClaimSchema),
      candidate_ids: z.array(z.string()),
      provider: z.enum(['gemini', 'openai']),
    }),
  }),
  ArtifactBase.extend({ kind: z.literal('insight_pack'), payload: InsightPackSchema }),
  ArtifactBase.extend({
    kind: z.literal('decision_intelligence_pack'),
    payload: DecisionIntelligencePackSchema,
  }),
  ArtifactBase.extend({ kind: z.literal('report_draft'), payload: ReportDraftSchema }),
  ArtifactBase.extend({ kind: z.literal('review_result'), payload: ReviewResultSchema }),
  ArtifactBase.extend({ kind: z.literal('report'), payload: ReportPayloadSchema }),
]);
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactKind = Artifact['kind'];
export type ArtifactOf<K extends ArtifactKind> = Extract<Artifact, { kind: K }>;
export const ArtifactValidationSchema = z.object({
  artifact_id: IdSchema,
  org_id: IdSchema,
  run_id: IdSchema,
  validated_at: TimestampSchema,
  validator_version: z.literal('mvp-validator-v1'),
  valid: z.boolean(),
  checks: z.array(z.string()),
});
export type ArtifactValidation = z.infer<typeof ArtifactValidationSchema>;
export const ReportDefinitionInputSchema = z
  .object({
    org_id: IdSchema,
    name: z.string().trim().min(1).max(200),
    scope: ScopeSchema,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
    local_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    data_as_of_policy: z.enum(['scheduled_date', 'previous_day']).default('scheduled_date'),
    enabled: z.boolean().default(true),
    use_case: UseCaseKeySchema.default(DEFAULT_USE_CASE),
  })
  .strict();
export const ReportDefinitionSchema = ReportDefinitionInputSchema.extend({
  report_definition_id: IdSchema,
  definition_version: z.number().int().positive(),
  created_by: IdSchema,
  created_at: TimestampSchema,
  next_run_at: TimestampSchema,
});
export type ReportDefinitionInput = z.input<typeof ReportDefinitionInputSchema>;
export type ResolvedReportDefinitionInput = z.output<typeof ReportDefinitionInputSchema>;
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export const ReportOccurrenceSchema = z.object({
  occurrence_id: IdSchema,
  org_id: IdSchema,
  report_definition_id: IdSchema,
  definition_version: z.number().int().positive(),
  definition_snapshot: ReportDefinitionSchema,
  scheduled_for: TimestampSchema,
  run_id: IdSchema,
  created_at: TimestampSchema,
});
export type ReportOccurrence = z.infer<typeof ReportOccurrenceSchema>;
export const ReportRecordSchema = z.object({
  report_id: IdSchema,
  org_id: IdSchema,
  run_id: IdSchema,
  artifact_id: IdSchema,
  created_at: TimestampSchema,
  occurrence_id: IdSchema.nullable(),
});
export type ReportRecord = z.infer<typeof ReportRecordSchema>;
export const SessionSchema = z.object({
  user_id: IdSchema,
  email: z.string(),
  mode: z.literal('supabase'),
  organizations: z.array(z.object({ org_id: IdSchema, name: z.string(), role: RoleSchema })),
});
export type Session = z.infer<typeof SessionSchema>;
export const CatalogSchema = z.object({
  projects: z.array(
    z.object({
      project_external_id: z.string(),
      project_name: z.string(),
      zones: z.array(z.object({ zone_external_id: z.string(), zone_name: z.string() })),
    }),
  ),
  latest_snapshot_date: DateSchema.nullable(),
});
export type Catalog = z.infer<typeof CatalogSchema>;
export const ConversationKindSchema = z.enum(['interactive', 'scheduled']);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;
export const ConversationSchema = z
  .object({
    conversation_id: IdSchema,
    org_id: IdSchema,
    created_by: IdSchema,
    kind: ConversationKindSchema,
    title: z.string().trim().min(1).max(80),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;
export const MessageStatusSchema = z.enum([
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;
export const SignalRefSchema = z
  .object({
    run_id: IdSchema,
    signal_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
  })
  .strict();
export type SignalRef = z.infer<typeof SignalRefSchema>;
export const DecisionRefSchema = z
  .object({
    run_id: IdSchema,
    component_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
  })
  .strict();
export type DecisionRef = z.infer<typeof DecisionRefSchema>;
export const DrillDownRefSchema = z
  .object({
    run_id: IdSchema,
    drilldown_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
  })
  .strict();
export type DrillDownRef = z.infer<typeof DrillDownRefSchema>;
export const MessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(5_000) }).strict(),
  z.object({ type: z.literal('run_ref'), run_id: IdSchema, status: RunStatusSchema }).strict(),
  z.object({ type: z.literal('report_ref'), run_id: IdSchema, report_id: IdSchema }).strict(),
  z
    .object({
      type: z.literal('artifact_ref'),
      run_id: IdSchema,
      artifact_id: IdSchema,
      kind: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('signal_ref'),
      run_id: IdSchema,
      signal_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    })
    .strict(),
  z
    .object({
      type: z.literal('decision_ref'),
      run_id: IdSchema,
      component_id: DecisionRefSchema.shape.component_id,
    })
    .strict(),
  z
    .object({
      type: z.literal('drilldown_ref'),
      run_id: IdSchema,
      drilldown_id: DrillDownRefSchema.shape.drilldown_id,
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      code: z
        .string()
        .trim()
        .regex(/^[A-Z0-9_]+$/)
        .max(100),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;
export const MessageSchema = z
  .object({
    message_id: IdSchema,
    org_id: IdSchema,
    conversation_id: IdSchema,
    run_id: IdSchema.nullable(),
    client_turn_id: IdSchema.nullable().default(null),
    role: z.enum(['user', 'assistant']),
    /** Null is the legacy assistant label; specialized identities are additive. */
    sender_agent: AgentKeySchema.nullable().optional(),
    status: MessageStatusSchema.default('completed'),
    content: z.string().max(5_000),
    parts: z.array(MessagePartSchema).max(32).default([]),
    created_at: TimestampSchema,
    updated_at: TimestampSchema.optional(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;
export const ConversationListItemSchema = ConversationSchema.extend({
  latest_status: MessageStatusSchema.nullable(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;
export const CursorSchema = z.string().min(1).max(500);
export const PageRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: CursorSchema.nullable().default(null),
  })
  .strict();
export type PageRequest = z.infer<typeof PageRequestSchema>;
export const ConversationPageSchema = z
  .object({
    conversations: z.array(ConversationListItemSchema),
    next_cursor: CursorSchema.nullable(),
  })
  .strict();
export type ConversationPage = z.infer<typeof ConversationPageSchema>;
export const MessagePageSchema = z
  .object({ messages: z.array(MessageSchema), next_cursor: CursorSchema.nullable() })
  .strict();
export type MessagePage = z.infer<typeof MessagePageSchema>;
export const AgentTurnRequestSchema = z
  .object({
    org_id: IdSchema,
    client_turn_id: IdSchema,
    text: z.string().trim().min(1).max(2_000),
    scope: ScopeSchema,
    data_as_of: DateSchema,
    signal_ref: SignalRefSchema.nullable().optional(),
    signal_action: z.enum(['inspect', 'analyze_segment']).nullable().optional(),
    drilldown_ref: DrillDownRefSchema.nullable().optional(),
    use_case: UseCaseKeySchema.default(DEFAULT_USE_CASE),
    agent_target: AgentKeySchema.nullable().optional(),
  })
  .strict()
  .superRefine((turn, ctx) => {
    if (turn.signal_action !== null && turn.signal_action !== undefined && !turn.signal_ref)
      ctx.addIssue({
        code: 'custom',
        path: ['signal_action'],
        message: 'Signal action requires a signal reference',
      });
    if (turn.signal_ref && turn.drilldown_ref && turn.signal_ref.run_id !== turn.drilldown_ref.run_id)
      ctx.addIssue({
        code: 'custom',
        path: ['drilldown_ref'],
        message: 'Signal and drill-down references must name the same run',
      });
  });
export type AgentTurnRequest = z.input<typeof AgentTurnRequestSchema>;
export type ResolvedAgentTurnRequest = z.output<typeof AgentTurnRequestSchema>;
export const AgentFocusSchema = z.enum([
  'current_inventory',
  'slow_moving',
  'inventory_comparison',
  'price_distribution',
  'peer_comparison',
  'full_report',
]);
export type AgentFocus = z.infer<typeof AgentFocusSchema>;
export const UnsupportedReasonCodeSchema = z.enum([
  'UNSUPPORTED_REQUEST',
  'UNSUPPORTED_CAUSAL_REQUEST',
  'UNSUPPORTED_SCOPE',
  'MISSING_CONTEXT',
  'NO_AUTHORIZED_RESULT',
]);
export type UnsupportedReasonCode = z.infer<typeof UnsupportedReasonCodeSchema>;
export const CreateAnalysisToolInputSchema = z
  .object({
    action: z.literal('create_analysis'),
    focus: AgentFocusSchema,
    scope_ref: ScopeSchema.optional(),
  })
  .strict();
export const GetAnalysisResultToolInputSchema = z
  .object({ action: z.literal('get_analysis_result'), run_id: IdSchema })
  .strict();
export const InspectSignalToolInputSchema = z
  .object({
    action: z.literal('inspect_signal'),
    run_id: IdSchema,
    signal_id: SignalRefSchema.shape.signal_id,
  })
  .strict();
export const UnsupportedDecisionSchema = z
  .object({ action: z.literal('unsupported'), reason_code: UnsupportedReasonCodeSchema })
  .strict();
export const AgentDecisionSchema = z.discriminatedUnion('action', [
  CreateAnalysisToolInputSchema,
  GetAnalysisResultToolInputSchema,
  InspectSignalToolInputSchema,
  UnsupportedDecisionSchema,
]);
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export const AgentTurnAcceptedSchema = z
  .object({
    conversation_id: IdSchema,
    user_message_id: IdSchema,
    assistant_message_id: IdSchema,
    run_id: IdSchema.nullable(),
    assistant_status: MessageStatusSchema,
  })
  .strict();
export type AgentTurnAccepted = z.infer<typeof AgentTurnAcceptedSchema>;
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  run_id: IdSchema.optional(),
});
export const RunDetailSchema = z.object({
  run: RunSchema,
  tasks: z.array(RunTaskSchema),
  events: z.array(RunEventSchema),
});
/**
 * A compact, role-gated view of private workflow checkpoints. It deliberately
 * omits draft/report prose, artifact identifiers and hashes so chat clients
 * can render review progress without hydrating private canonical artifacts.
 */
export const AgentWorkflowStageStatusSchema = z
  .object({
    agent: AgentKeySchema,
    status: RunTaskSchema.shape.status,
    error_code: z.string().nullable(),
  })
  .strict();
export const AgentWorkflowStatusSchema = z
  .object({
    run_id: IdSchema,
    org_id: IdSchema,
    workflow_version: WorkflowVersionSchema,
    stages: z.array(AgentWorkflowStageStatusSchema).max(8),
    draft_revision: z.number().int().min(1).max(2).nullable(),
    review: z
      .object({
        draft_revision: z.number().int().min(1).max(2),
        status: z.enum(['PASS', 'REVISION_REQUIRED']),
      })
      .strict()
      .nullable(),
    publication_status: RunTaskSchema.shape.status.nullable(),
  })
  .strict();
export type AgentWorkflowStatus = z.infer<typeof AgentWorkflowStatusSchema>;
export const ArtifactListSchema = z.object({
  artifacts: z.array(ArtifactSchema),
  validations: z.array(ArtifactValidationSchema),
  sources: z.array(ImportManifestSchema),
});
export const DecisionBriefResponseSchema = z
  .object({
    run_id: IdSchema,
    org_id: IdSchema,
    scope: ScopeSchema,
    requested_data_as_of: DateSchema,
    effective_snapshot_date: DateSchema.nullable(),
    decision_brief: DecisionBriefSchema,
    report_artifact_id: IdSchema,
    calculation_artifact_id: IdSchema,
    evidence_artifact_ids: z.array(IdSchema),
    validations: z.array(ArtifactValidationSchema),
  })
  .strict();
export type DecisionBriefResponse = z.infer<typeof DecisionBriefResponseSchema>;
export const DecisionIntelligenceResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      run_id: IdSchema,
      org_id: IdSchema,
      report_artifact_id: IdSchema,
      decision_intelligence_artifact_id: IdSchema,
      decision_intelligence: DecisionIntelligencePackSchema,
      validations: z.array(ArtifactValidationSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal('legacy_report_brief'),
      run_id: IdSchema,
      org_id: IdSchema,
      decision_brief: DecisionBriefSchema,
      report_artifact_id: IdSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      run_id: IdSchema,
      org_id: IdSchema,
      reason: z.enum(['RUN_NOT_SUCCEEDED', 'DECISION_ARTIFACT_NOT_AVAILABLE']),
    })
    .strict(),
]);
export type DecisionIntelligenceResponse = z.infer<typeof DecisionIntelligenceResponseSchema>;
export const ReportDetailSchema = z.object({
  report: ReportRecordSchema,
  artifact: ArtifactSchema,
});
export const AcceptedSchema = z.object({
  run_id: IdSchema,
  conversation_id: IdSchema,
  status: RunStatusSchema,
});
export const ExportRequestSchema = z.object({ format: z.enum(['json', 'csv']) }).strict();
export const ExportResponseSchema = z.object({ url: z.string(), expires_at: TimestampSchema });
export const LoginSchema = z
  .object({ email: z.email(), password: z.string().min(1).max(200) })
  .strict();
export const SetupSchema = z.object({
  mode: z.literal('supabase'),
  llm_primary_provider: z.enum(['gemini', 'openai']),
  llm_fallback_provider: z.enum(['gemini', 'openai']),
  development_role_bypass: z.boolean(),
  ready: z.boolean(),
  message: z.string(),
});
