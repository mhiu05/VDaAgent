import { z } from 'zod';
import { DateSchema, IdSchema, ScopeSchema } from '../common/primitives';
import { MetricKeySchema } from '../analysis/metrics';
import { RunStatusSchema } from '../analysis/run';

/**
 * Grok workspace selections are references only. The browser must never send
 * rendered dashboard text, organization identity, role, or canonical values.
 */
export const ComponentIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9:._-]*$/)
  .max(200);
export const EvidencePathSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_$.[\]-]+$/)
  .max(500);

export const CapabilityModeSchema = z.enum([
  'grok',
  'data',
  'insight',
  'compare',
  'chart',
  'report',
]);
export type CapabilityMode = z.infer<typeof CapabilityModeSchema>;

export const AgentFocusSchema = z.enum([
  'current_inventory',
  'slow_moving',
  'inventory_comparison',
  'price_distribution',
  'peer_comparison',
  'full_report',
]);
export type AgentFocus = z.infer<typeof AgentFocusSchema>;

export const DashboardSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kpi'), kpi_id: ComponentIdSchema }).strict(),
  z.object({ kind: z.literal('chart'), chart_id: ComponentIdSchema }).strict(),
  z.object({ kind: z.literal('priority'), priority_entity_id: ComponentIdSchema }).strict(),
  z.object({ kind: z.literal('insight'), insight_id: ComponentIdSchema }).strict(),
  z.object({ kind: z.literal('action'), action_candidate_id: ComponentIdSchema }).strict(),
]);
export type DashboardSelection = z.infer<typeof DashboardSelectionSchema>;

export const EvidenceReferenceSchema = z
  .object({
    artifact_id: IdSchema,
    evidence_path: EvidencePathSchema.nullable().default(null),
  })
  .strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

/**
 * The workspace snapshot is navigation state, not an authorization grant.
 * These compact reference shapes deliberately retain the producing run so a
 * server can reject cross-run descendants before anything reaches a provider.
 */
export const WorkspaceModeV1Schema = z.enum(['agent_chat', 'report_dashboard']);
export type WorkspaceModeV1 = z.infer<typeof WorkspaceModeV1Schema>;
export const RunRefV1Schema = z.object({ run_id: IdSchema }).strict();
export type RunRefV1 = z.infer<typeof RunRefV1Schema>;
export const ReportRefV1Schema = z.object({ run_id: IdSchema, report_id: IdSchema }).strict();
export type ReportRefV1 = z.infer<typeof ReportRefV1Schema>;
export const ArtifactRefV1Schema = z.object({ run_id: IdSchema, artifact_id: IdSchema }).strict();
export type ArtifactRefV1 = z.infer<typeof ArtifactRefV1Schema>;
export const ChartRefV1Schema = z
  .object({ run_id: IdSchema, chart_id: ComponentIdSchema })
  .strict();
export type ChartRefV1 = z.infer<typeof ChartRefV1Schema>;
export const PriorityEntityRefV1Schema = z
  .object({ run_id: IdSchema, priority_entity_id: ComponentIdSchema })
  .strict();
export type PriorityEntityRefV1 = z.infer<typeof PriorityEntityRefV1Schema>;
export const DrilldownRefV1Schema = z
  .object({ run_id: IdSchema, drilldown_id: ComponentIdSchema })
  .strict();
export type DrilldownRefV1 = z.infer<typeof DrilldownRefV1Schema>;
export const WorkspaceEvidenceRefV1Schema = z
  .object({ run_id: IdSchema, artifact_id: IdSchema, evidence_path: EvidencePathSchema })
  .strict();
export type WorkspaceEvidenceRefV1 = z.infer<typeof WorkspaceEvidenceRefV1Schema>;

export const WorkspaceContextV1Schema = z
  .object({
    version: z.literal(1),
    mode: WorkspaceModeV1Schema,
    org_id: IdSchema,
    conversation_id: IdSchema.nullable(),
    scope: ScopeSchema,
    data_as_of: DateSchema,
    active_run_ref: RunRefV1Schema.nullable(),
    active_report_ref: ReportRefV1Schema.nullable(),
    active_artifact_ref: ArtifactRefV1Schema.nullable(),
    dashboard_selection: z
      .object({
        chart_ref: ChartRefV1Schema.nullable(),
        priority_entity_ref: PriorityEntityRefV1Schema.nullable(),
      })
      .strict()
      .nullable(),
    drilldown: DrilldownRefV1Schema.nullable(),
    evidence_ref: WorkspaceEvidenceRefV1Schema.nullable(),
  })
  .strict();
export type WorkspaceContextV1 = z.infer<typeof WorkspaceContextV1Schema>;

export const ContextResolutionIssueV1Schema = z
  .object({
    ref_kind: z.enum([
      'run',
      'report',
      'artifact',
      'chart',
      'priority_entity',
      'drilldown',
      'evidence',
    ]),
    code: z.enum(['NO_AUTHORIZED_RESULT', 'STALE_CONTEXT', 'MISSING_CONTEXT']),
    disposition: z.enum(['drop', 'replace', 'reject']),
  })
  .strict();
export type ContextResolutionIssueV1 = z.infer<typeof ContextResolutionIssueV1Schema>;

export const AgentRuntimeErrorCodeSchema = z.enum([
  'UNSUPPORTED_REQUEST',
  'UNSUPPORTED_CAUSAL_REQUEST',
  'UNSUPPORTED_SCOPE',
  'MISSING_CONTEXT',
  'NO_AUTHORIZED_RESULT',
  'STALE_CONTEXT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_OUTPUT_INVALID',
  'RUNTIME_LIMIT_EXCEEDED',
  'CAPABILITY_DENIED',
  'CAPABILITY_UNAVAILABLE',
  'CAPABILITY_OUTPUT_INVALID',
  'GROUNDING_INVALID',
  'TURN_CANCELLED',
]);
export type AgentRuntimeErrorCode = z.infer<typeof AgentRuntimeErrorCodeSchema>;

export const ClaimReferenceSchema = z
  .object({ run_id: IdSchema, artifact_id: IdSchema, claim_id: ComponentIdSchema })
  .strict();
export type ClaimReference = z.infer<typeof ClaimReferenceSchema>;

export const MetricReferenceSchema = z
  .object({
    run_id: IdSchema,
    artifact_id: IdSchema,
    metric_key: MetricKeySchema,
    evidence_path: EvidencePathSchema,
  })
  .strict();
export type MetricReference = z.infer<typeof MetricReferenceSchema>;

export const ArtifactReferenceSchema = z
  .object({ run_id: IdSchema, artifact_id: IdSchema, kind: z.string().trim().min(1).max(100) })
  .strict();
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const EvidenceRefV1Schema = z
  .object({ run_id: IdSchema, artifact_id: IdSchema, evidence_path: EvidencePathSchema })
  .strict();
export type EvidenceRefV1 = z.infer<typeof EvidenceRefV1Schema>;

export const QualityReferenceSchema = z
  .object({
    run_id: IdSchema,
    artifact_id: IdSchema,
    quality_id: ComponentIdSchema,
    kind: z.enum(['limitation', 'quality']),
  })
  .strict();
export type QualityReference = z.infer<typeof QualityReferenceSchema>;

export const RunReferenceSchema = z.object({ run_id: IdSchema, status: RunStatusSchema }).strict();
export type RunReference = z.infer<typeof RunReferenceSchema>;

/**
 * Server-produced, non-numeric presentation data that a provider may use to
 * describe an authorized component. Values and quantitative payloads remain
 * in canonical artifacts and are rendered separately.
 */
export const CapabilityDisplayFragmentKindSchema = z.enum([
  'status',
  'kpi',
  'visual',
  'priority_entity',
  'insight',
  'action',
  'drilldown',
  'report',
  'artifact',
]);
export type CapabilityDisplayFragmentKind = z.infer<typeof CapabilityDisplayFragmentKindSchema>;
export const CapabilityDisplaySupportLevelSchema = z.enum([
  'high',
  'medium',
  'limited',
  'exploratory',
]);
export type CapabilityDisplaySupportLevel = z.infer<typeof CapabilityDisplaySupportLevelSchema>;
export const CapabilityDisplayFragmentSchema = z
  .object({
    kind: CapabilityDisplayFragmentKindSchema,
    run_id: IdSchema,
    component_id: ComponentIdSchema,
    label: z.string().trim().min(1).max(500),
    support_level: CapabilityDisplaySupportLevelSchema.nullable().default(null),
    limitation_ids: z.array(ComponentIdSchema).max(12).default([]),
  })
  .strict();
export type CapabilityDisplayFragment = z.infer<typeof CapabilityDisplayFragmentSchema>;

export const WorkspaceActionV1Schema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('open_dashboard'), run_id: IdSchema, report_id: IdSchema.nullable() })
    .strict(),
  z
    .object({
      type: z.literal('open_drilldown'),
      run_id: IdSchema,
      drilldown_id: ComponentIdSchema,
    })
    .strict(),
  z
    .object({ type: z.literal('focus_visual'), run_id: IdSchema, chart_id: ComponentIdSchema })
    .strict(),
  z
    .object({
      type: z.literal('focus_priority_entity'),
      run_id: IdSchema,
      priority_entity_id: ComponentIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('open_evidence'),
      run_id: IdSchema,
      artifact_id: IdSchema,
      evidence_path: EvidencePathSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal('switch_capability_mode'), mode: CapabilityModeSchema }).strict(),
]);
export type WorkspaceActionV1 = z.infer<typeof WorkspaceActionV1Schema>;
