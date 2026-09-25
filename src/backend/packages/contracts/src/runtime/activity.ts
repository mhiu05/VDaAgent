import { z } from 'zod';
import { CapabilityNameSchema } from './capabilities';
import { IdSchema } from '../common/primitives';
import { AgentRuntimeErrorCodeSchema } from './context';
import { AgentTurnAcceptedSchema } from '../chat/message';

export const AgentActivityEventV1Schema = z
  .object({
    version: z.literal('agent-activity-v1'),
    sequence: z.number().int().nonnegative(),
    type: z.enum([
      'context_started',
      'context_ready',
      'tool_started',
      'tool_completed',
      'run_created',
      'run_progress',
      'artifact_ready',
      'answer_started',
      'answer_completed',
      'error',
    ]),
    label: z.enum([
      'understanding_context',
      'inspecting_context',
      'starting_analysis',
      'analysis_queued',
      'analysis_progress',
      'preparing_answer',
      'answer_ready',
      'safe_error',
    ]),
    capability: CapabilityNameSchema.nullable().default(null),
    run_id: IdSchema.nullable().default(null),
    artifact_id: IdSchema.nullable().default(null),
    error_code: AgentRuntimeErrorCodeSchema.nullable().default(null),
  })
  .strict();
export type AgentActivityEventV1 = z.infer<typeof AgentActivityEventV1Schema>;
/**
 * The only events emitted by the optional POST-over-fetch turn stream. Activity
 * remains the bounded public projection; the terminal frame either identifies
 * the persisted turn or reports a deliberately generic transport failure.
 */
export const AgentTurnStreamEventV1Schema = z.discriminatedUnion('type', [
  z
    .object({
      version: z.literal('agent-turn-stream-v1'),
      sequence: z.number().int().nonnegative(),
      type: z.literal('activity'),
      activity: AgentActivityEventV1Schema,
    })
    .strict(),
  z
    .object({
      version: z.literal('agent-turn-stream-v1'),
      sequence: z.number().int().nonnegative(),
      type: z.literal('terminal'),
      accepted: AgentTurnAcceptedSchema.nullable(),
      error_code: AgentRuntimeErrorCodeSchema.nullable(),
    })
    .strict()
    .superRefine((event, ctx) => {
      if ((event.accepted === null) === (event.error_code === null))
        ctx.addIssue({
          code: 'custom',
          message: 'A terminal stream event must contain either an accepted turn or an error code',
        });
    }),
]);
export type AgentTurnStreamEventV1 = z.infer<typeof AgentTurnStreamEventV1Schema>;
