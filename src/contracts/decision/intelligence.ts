import { z } from 'zod';
import { DateSchema, IdSchema, ScopeSchema, UseCaseKeySchema } from '../common/primitives';
import {
  DeltaValueSchema,
  MetricKeySchema,
  MetricUnitSchema,
  MetricValueSchema,
} from '../analysis/metrics';
import { ReportSectionSchema } from '../reports/section';

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
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
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
