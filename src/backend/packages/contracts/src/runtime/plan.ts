import { z } from 'zod';
import { CapabilityInvocationSchema } from './capabilities';
import { AgentRuntimeErrorCodeSchema, RunReferenceSchema } from './context';

export const AgentPlanV1Schema = z
  .object({
    version: z.literal('agent-plan-v1'),
    intent: z.string().trim().min(1).max(120),
    steps: z.array(CapabilityInvocationSchema).max(3),
    answer_mode: z.enum(['grounded', 'queued', 'unavailable']),
    unsupported_reason: AgentRuntimeErrorCodeSchema.nullable().default(null),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (new Set(plan.steps.map((step) => step.step_id)).size !== plan.steps.length)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Plan step IDs must be unique' });
    if (new Set(plan.steps.map((step) => step.capability_id)).size !== plan.steps.length)
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Each capability can be invoked at most once per plan',
      });
    const hasCreate = plan.steps.some((step) => step.capability_id === 'create_analysis');
    if (plan.answer_mode === 'grounded' && plan.steps.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'A grounded plan requires at least one read capability',
      });
    if (
      plan.answer_mode === 'queued' &&
      (plan.steps.length !== 1 || !hasCreate || plan.unsupported_reason !== null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'A queued plan must contain only create_analysis',
      });
    if (
      plan.answer_mode === 'unavailable' &&
      (plan.steps.length !== 0 || plan.unsupported_reason === null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'An unavailable plan has no steps and requires a normalized reason',
      });
  });
export type AgentPlanV1 = z.infer<typeof AgentPlanV1Schema>;

export const GroundedResponseSelectionV1Schema = z
  .object({
    version: z.literal('grounded-response-selection-v1'),
    status: z.enum(['complete', 'partial', 'queued', 'unavailable']),
    title_key: z.enum([
      'analysis_answer',
      'analysis_queued',
      'analysis_partial',
      'analysis_unavailable',
    ]),
    blocks: z
      .array(
        z
          .object({
            kind: z.enum(['summary', 'detail', 'limitation']),
            observation_ids: z
              .array(
                z
                  .string()
                  .trim()
                  .regex(/^[a-z][a-z0-9_-]{0,63}$/),
              )
              .max(12),
          })
          .strict(),
      )
      .max(8),
    workspace_action_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_-]{0,63}$/),
      )
      .max(8),
    queued_run_ref: RunReferenceSchema.nullable(),
    error_code: AgentRuntimeErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((selection, ctx) => {
    const observationIds = selection.blocks.flatMap((block) => block.observation_ids);
    if (observationIds.length > 12)
      ctx.addIssue({
        code: 'custom',
        path: ['blocks'],
        message: 'A grounded response may select at most twelve observations',
      });
    if (new Set(observationIds).size !== observationIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['blocks'],
        message: 'Observation IDs may be selected only once',
      });
    if (new Set(selection.workspace_action_ids).size !== selection.workspace_action_ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['workspace_action_ids'],
        message: 'Workspace action IDs may be selected only once',
      });
  });
export type GroundedResponseSelectionV1 = z.infer<typeof GroundedResponseSelectionV1Schema>;

/** @deprecated The runtime now uses ID-only GroundedResponseSelectionV1. */
export const GroundedAssistantResponseV1Schema = GroundedResponseSelectionV1Schema;
export type GroundedAssistantResponseV1 = GroundedResponseSelectionV1;
