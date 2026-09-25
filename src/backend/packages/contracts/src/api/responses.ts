import { z } from 'zod';
import {
  AgentKeySchema,
  DateSchema,
  IdSchema,
  ScopeSchema,
  TimestampSchema,
  WorkflowVersionSchema,
} from '../common/primitives';
import { RunEventSchema, RunSchema, RunStatusSchema, RunTaskSchema } from '../analysis/run';
import { ReportRecordSchema } from '../reports/report';
import { ImportManifestSchema } from '../imports/inventory';
import { ConversationListItemSchema } from '../chat/conversation';
import { ReportDefinitionSchema } from '../reports/schedule';
import { ArtifactSchema, ArtifactValidationSchema } from '../artifacts/artifact';
import { DecisionBriefSchema } from '../decision/brief';
import { DecisionIntelligencePackSchema } from '../agents/workflow-packs';

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
/** Workspace entry projection; backed only by persisted tenant records. */
export const WorkspaceSummarySchema = z
  .object({
    org_id: IdSchema,
    recent_runs: z.array(RunSchema).max(6),
    run_counts: z
      .object({
        queued: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
      })
      .strict(),
    recent_reports: z.array(ReportRecordSchema).max(6),
    recent_imports: z.array(ImportManifestSchema).max(6),
    recent_conversations: z.array(ConversationListItemSchema).max(6),
    active_schedules: z.array(ReportDefinitionSchema).max(6),
  })
  .strict();
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
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
  grok_runtime_enabled: z.boolean().default(false),
  grok_workspace_enabled: z.boolean().default(false),
  grok_sse_enabled: z.boolean().default(false),
  development_role_bypass: z.boolean(),
  ready: z.boolean(),
  message: z.string(),
});
