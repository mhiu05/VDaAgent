import { z } from 'zod';
import { DateSchema, IdSchema, ScopeSchema } from '../common/primitives';
import {
  AbstentionReasonSchema,
  DeltaValueSchema,
  MetricKeySchema,
  MetricUnitSchema,
  MetricValueSchema,
} from '../analysis/metrics';
import {
  BusinessImplicationSchema,
  CanonicalEvidenceRefSchema,
  DataQualitySummarySchema,
  DecisionKpiCardSchema,
  DecisionWatchoutSchema,
  HotspotSchema,
  MaterialChangeSchema,
} from './intelligence';

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
