import { z } from 'zod';
import {
  ARTIFACT_SCHEMA_VERSION,
  DateSchema,
  IdSchema,
  SEMANTIC_VERSION,
  ScopeSchema,
  TimestampSchema,
} from '../common/primitives';
import { AnalysisRequestSchema } from '../analysis/request';
import { TASK_KINDS } from '../analysis/run';
import { UnitSnapshotSchema } from '../imports/inventory';
import { CalculationPayloadSchema, ComparisonItemSchema } from '../analysis/calculation';
import {
  AnalysisPackSchema,
  ChartPackSchema,
  ComparisonPackSchema,
  CoordinatorDecisionSchema,
  DataAnalysisPackSchema,
  DecisionIntelligencePackSchema,
  InsightPackSchema,
  ReportDraftSchema,
  ReviewResultSchema,
} from '../agents/workflow-packs';
import { ClaimSchema, VisualEvidencePayloadSchema } from '../analysis/chart';
import { ReportPayloadSchema } from '../reports/report';

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
