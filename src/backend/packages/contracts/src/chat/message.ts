import { z } from 'zod';
import { MessageContextRefSchema } from '../runtime/workspace';
import {
  AgentKeySchema,
  CursorSchema,
  DEFAULT_USE_CASE,
  DateSchema,
  IdSchema,
  ScopeSchema,
  TimestampSchema,
  UseCaseKeySchema,
} from '../common/primitives';
import { RunStatusSchema } from '../analysis/run';
import {
  AgentFocusSchema,
  ClaimReferenceSchema,
  EvidenceRefV1Schema,
  MetricReferenceSchema,
  QualityReferenceSchema,
  WorkspaceActionV1Schema,
  WorkspaceContextV1Schema,
} from '../runtime/context';

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

/** A report reference always retains the run that produced it. */
export const ReportReferenceSchema = z.object({ run_id: IdSchema, report_id: IdSchema }).strict();
export type ReportReference = z.infer<typeof ReportReferenceSchema>;

/** Explicit aliases make capability observations self-describing without changing message refs. */
export const DecisionReferenceSchema = DecisionRefSchema;
export type DecisionReference = DecisionRef;
export const DrillDownReferenceSchema = DrillDownRefSchema;
export type DrillDownReference = DrillDownRef;
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
  z.object({ type: z.literal('claim_ref'), ref: ClaimReferenceSchema }).strict(),
  z.object({ type: z.literal('metric_ref'), ref: MetricReferenceSchema }).strict(),
  z.object({ type: z.literal('evidence_ref'), ref: EvidenceRefV1Schema }).strict(),
  z.object({ type: z.literal('workspace_action'), action: WorkspaceActionV1Schema }).strict(),
  z.object({ type: z.literal('quality_ref'), ref: QualityReferenceSchema }).strict(),
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
    context_refs: z.array(MessageContextRefSchema).max(24).optional(),
    reply_to_message_id: IdSchema.nullable().optional(),
    report_intent: z.enum(['new', 'update']).nullable().optional(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema.optional(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;
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
    workspace_context: WorkspaceContextV1Schema.nullable().optional(),
    context_refs: z.array(MessageContextRefSchema).max(24).optional(),
    reply_to_message_id: IdSchema.nullable().optional(),
    report_intent: z.enum(['new', 'update']).nullable().optional(),
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
    if (
      turn.signal_ref &&
      turn.drilldown_ref &&
      turn.signal_ref.run_id !== turn.drilldown_ref.run_id
    )
      ctx.addIssue({
        code: 'custom',
        path: ['drilldown_ref'],
        message: 'Signal and drill-down references must name the same run',
      });
    const workspace = turn.workspace_context;
    if (!workspace) return;
    if (workspace.org_id !== turn.org_id)
      ctx.addIssue({
        code: 'custom',
        path: ['workspace_context', 'org_id'],
        message: 'Workspace organization must match the turn organization',
      });
    if (
      workspace.scope.project_external_id !== turn.scope.project_external_id ||
      workspace.scope.zone_external_id !== turn.scope.zone_external_id
    )
      ctx.addIssue({
        code: 'custom',
        path: ['workspace_context', 'scope'],
        message: 'Workspace scope must match the turn scope',
      });
    if (workspace.data_as_of !== turn.data_as_of)
      ctx.addIssue({
        code: 'custom',
        path: ['workspace_context', 'data_as_of'],
        message: 'Workspace data_as_of must match the turn data_as_of',
      });
  });
export type AgentTurnRequest = z.input<typeof AgentTurnRequestSchema>;
export type ResolvedAgentTurnRequest = z.output<typeof AgentTurnRequestSchema>;
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
    agent_turn_job_id: IdSchema.optional(),
  })
  .strict();
export type AgentTurnAccepted = z.infer<typeof AgentTurnAcceptedSchema>;
