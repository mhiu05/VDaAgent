import { z } from 'zod';
import {
  AgentKeySchema,
  DateSchema,
  IdSchema,
  ScopeSchema,
  UseCaseKeySchema,
} from '../common/primitives';
import { UseCaseCapabilitySchema } from './use-case';
import { MetricKeySchema, MetricSchema } from '../analysis/metrics';
import {
  CalculatedUnitSchema,
  CalculationPayloadSchema,
  ComparisonItemSchema,
} from '../analysis/calculation';
import {
  ActionCandidateSchema,
  ArtifactHandoffSchema,
  CanonicalEvidenceRefSchema,
  DrillDownSchema,
  PriorityEntitySchema,
  VisualStorySchema,
} from '../decision/intelligence';
import { ChartSpecSchema, ChartUnavailableSchema, ClaimSchema } from '../analysis/chart';
import { DecisionBriefV2Schema } from '../decision/brief';
import { ReportPayloadSchema } from '../reports/report';

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
    ctx.addIssue({
      code: 'custom',
      path: ['priority_entities'],
      message: 'Ranks must be contiguous',
    });
  if (
    pack.decision_brief.primary_visual_ids.length > 3 ||
    new Set(pack.decision_brief.primary_visual_ids).size !==
      pack.decision_brief.primary_visual_ids.length
  )
    ctx.addIssue({
      code: 'custom',
      path: ['decision_brief', 'primary_visual_ids'],
      message: 'Invalid primary visuals',
    });
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
    ctx.addIssue({
      code: 'custom',
      path: ['decision_brief'],
      message: 'Unknown decision component',
    });
  for (const [index, entity] of pack.priority_entities.entries()) {
    if (
      entity.action_candidate_ids.some((id) => !actions.includes(id)) ||
      entity.drilldown_ids.some((id) => !drilldowns.includes(id))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['priority_entities', index],
        message: 'Unknown entity target',
      });
  }
  for (const [index, action] of pack.action_candidates.entries()) {
    if (
      action.target_entity_ids.some((id) => !entities.includes(id)) ||
      !drilldowns.includes(action.drilldown_id)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['action_candidates', index],
        message: 'Unknown action target',
      });
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
      ctx.addIssue({
        code: 'custom',
        path: ['drilldowns', index, 'context'],
        message: 'Drill-down context must match the pack',
      });
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
