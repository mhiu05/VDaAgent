import { z } from 'zod';
import { IdSchema, TimestampSchema, WorkflowVersionSchema } from '../common/primitives';
import { AnalysisRequestSchema } from './request';

export const TASK_KINDS = [
  'orchestrator',
  'coordinator',
  'data',
  'calculation',
  'chart',
  'comparison',
  'analyst',
  'insight',
  'validation',
  'report',
  'reviewer',
  'publication',
] as const;
export const RunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const RunTaskSchema = z.object({
  task_id: IdSchema,
  run_id: IdSchema,
  org_id: IdSchema,
  kind: z.enum(TASK_KINDS),
  dependencies: z.array(z.enum(TASK_KINDS)),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  attempt: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
});
export type RunTask = z.infer<typeof RunTaskSchema>;
export const RunEventSchema = z.object({
  event_id: IdSchema,
  run_id: IdSchema,
  org_id: IdSchema,
  created_at: TimestampSchema,
  task_id: IdSchema.nullable(),
  message: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
export const RunSchema = z.object({
  run_id: IdSchema,
  org_id: IdSchema,
  created_by: IdSchema,
  request: AnalysisRequestSchema,
  status: RunStatusSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  idempotency_key: z.string(),
  request_hash: z.string(),
  entrypoint: z.enum(['interactive', 'scheduled']),
  occurrence_id: IdSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  fencing_token: z.number().int().nonnegative(),
  lease_until: TimestampSchema.nullable(),
  error_code: z.string().nullable(),
  report_artifact_id: IdSchema.nullable(),
  cancel_requested: z.boolean(),
  /** Absent on historical payloads; nested request.use_case is the source of truth. */
  workflow_version: WorkflowVersionSchema.optional(),
});
export type AnalysisRun = z.infer<typeof RunSchema>;
