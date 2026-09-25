import { z } from 'zod';
import {
  AgentFocusSchema,
  AgentRuntimeErrorCodeSchema,
  ArtifactReferenceSchema,
  CapabilityDisplaySupportLevelSchema,
  ClaimReferenceSchema,
  ComponentIdSchema,
  EvidencePathSchema,
  EvidenceRefV1Schema,
  MetricReferenceSchema,
  QualityReferenceSchema,
  RunReferenceSchema,
  WorkspaceActionV1Schema,
} from './context';
import { IdSchema } from '../common/primitives';

/** The P0 planner can select only these server-registered operations. */
export const AgentCapabilityIdV1Schema = z.enum([
  'create_analysis',
  'get_analysis_result',
  'inspect_signal',
  'inspect_decision_intelligence',
  'inspect_visual',
  'inspect_priority_entity',
  'inspect_evidence',
  'get_report_context',
  'inspect_agent_checkpoint',
]);
export type AgentCapabilityIdV1 = z.infer<typeof AgentCapabilityIdV1Schema>;
/** @deprecated Use AgentCapabilityIdV1. Retained as an internal type alias. */
export const CapabilityNameSchema = AgentCapabilityIdV1Schema;
export type CapabilityName = AgentCapabilityIdV1;

const CapabilityStepIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const CreateAnalysisCapabilityInputSchema = z
  .object({ focus: AgentFocusSchema.nullable().default(null) })
  .strict();
export const GetAnalysisResultCapabilityInputSchema = z.object({ run_id: IdSchema }).strict();
export const InspectSignalCapabilityInputSchema = z
  .object({ run_id: IdSchema, signal_id: ComponentIdSchema })
  .strict();
export const InspectDecisionIntelligenceCapabilityInputSchema = z
  .object({ run_id: IdSchema })
  .strict();
export const InspectVisualCapabilityInputSchema = z
  .object({ run_id: IdSchema, chart_id: ComponentIdSchema })
  .strict();
export const InspectPriorityEntityCapabilityInputSchema = z
  .object({ run_id: IdSchema, priority_entity_id: ComponentIdSchema })
  .strict();
export const InspectEvidenceCapabilityInputSchema = z
  .object({ run_id: IdSchema, artifact_id: IdSchema, evidence_path: EvidencePathSchema })
  .strict();
export const GetReportContextCapabilityInputSchema = z
  .object({ run_id: IdSchema, report_id: IdSchema })
  .strict();
export const InspectAgentCheckpointCapabilityInputSchema = z
  .object({ agent_target: z.enum(['analyst', 'comparison', 'chart', 'report']) })
  .strict();

export const CapabilityInvocationSchema = z.discriminatedUnion('capability_id', [
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('create_analysis'),
      input: CreateAnalysisCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('get_analysis_result'),
      input: GetAnalysisResultCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_signal'),
      input: InspectSignalCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_decision_intelligence'),
      input: InspectDecisionIntelligenceCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_visual'),
      input: InspectVisualCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_priority_entity'),
      input: InspectPriorityEntityCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_evidence'),
      input: InspectEvidenceCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('get_report_context'),
      input: GetReportContextCapabilityInputSchema,
    })
    .strict(),
  z
    .object({
      step_id: CapabilityStepIdSchema,
      capability_id: z.literal('inspect_agent_checkpoint'),
      input: InspectAgentCheckpointCapabilityInputSchema,
    })
    .strict(),
]);
export type CapabilityInvocation = z.infer<typeof CapabilityInvocationSchema>;

export const GroundingReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), ref: RunReferenceSchema }).strict(),
  z.object({ type: z.literal('claim'), ref: ClaimReferenceSchema }).strict(),
  z.object({ type: z.literal('metric'), ref: MetricReferenceSchema }).strict(),
  z.object({ type: z.literal('artifact'), ref: ArtifactReferenceSchema }).strict(),
  z.object({ type: z.literal('evidence'), ref: EvidenceRefV1Schema }).strict(),
  z.object({ type: z.literal('quality'), ref: QualityReferenceSchema }).strict(),
]);
export type GroundingReference = z.infer<typeof GroundingReferenceSchema>;
export const GroundingRefV1Schema = GroundingReferenceSchema;
export type GroundingRefV1 = GroundingReference;

export const CanonicalAgentObservationV1Schema = z
  .object({
    observation_id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/),
    kind: z.enum(['claim', 'metric', 'decision', 'status', 'limitation']),
    availability: z.enum(['available', 'unavailable', 'pending', 'failed']),
    canonical_text: z.string().trim().min(1).max(1_200),
    display_value: z.string().trim().min(1).max(240).nullable(),
    support_level: CapabilityDisplaySupportLevelSchema.nullable(),
    grounding_refs: z.array(GroundingReferenceSchema).max(12),
  })
  .strict()
  .superRefine((observation, ctx) => {
    if (
      observation.availability === 'available' &&
      ['claim', 'metric', 'decision'].includes(observation.kind) &&
      observation.grounding_refs.length === 0
    )
      ctx.addIssue({
        code: 'custom',
        path: ['grounding_refs'],
        message: 'Available factual observations require grounding references',
      });
  });
export type CanonicalAgentObservationV1 = z.infer<typeof CanonicalAgentObservationV1Schema>;

export const AvailableWorkspaceActionV1Schema = z
  .object({
    action_id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/),
    action: WorkspaceActionV1Schema,
  })
  .strict();
export type AvailableWorkspaceActionV1 = z.infer<typeof AvailableWorkspaceActionV1Schema>;

export const CapabilityResultV1Schema = z
  .object({
    version: z.literal('capability-result-v1'),
    capability_id: AgentCapabilityIdV1Schema,
    status: z.enum(['available', 'unavailable', 'pending', 'failed']),
    observations: z.array(CanonicalAgentObservationV1Schema).max(12),
    available_workspace_actions: z.array(AvailableWorkspaceActionV1Schema).max(8).default([]),
    queued_run_ref: RunReferenceSchema.nullable().default(null),
    error_code: AgentRuntimeErrorCodeSchema.nullable().default(null),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (
      new Set(result.observations.map((item) => item.observation_id)).size !==
      result.observations.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Observation IDs must be unique',
      });
    if (
      new Set(result.available_workspace_actions.map((item) => item.action_id)).size !==
      result.available_workspace_actions.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['available_workspace_actions'],
        message: 'Workspace action IDs must be unique',
      });
    if (result.status === 'pending' && result.queued_run_ref === null)
      ctx.addIssue({
        code: 'custom',
        path: ['queued_run_ref'],
        message: 'Pending capability results require a committed run reference',
      });
    if (result.status !== 'pending' && result.queued_run_ref !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['queued_run_ref'],
        message: 'Only pending capability results may include a queued run reference',
      });
  });
export type CapabilityResultV1 = z.infer<typeof CapabilityResultV1Schema>;
