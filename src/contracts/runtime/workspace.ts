import { z } from 'zod';
import { IdSchema, TimestampSchema } from '../common/primitives';

export const ThreadContextSchema = z.object({
  dataset_ids: z.array(IdSchema).max(24).default([]),
  active_artifact_id: IdSchema.nullable().default(null),
  active_report_id: IdSchema.nullable().default(null),
  current_run_id: IdSchema.nullable().default(null),
  referenced_artifact_ids: z.array(IdSchema).max(24).default([]),
}).strict();
export type ThreadContext = z.infer<typeof ThreadContextSchema>;
export const MessageContextRefSchema = z.object({
  type: z.enum(['dataset', 'artifact', 'report', 'file']), id: IdSchema,
}).strict();
export type MessageContextRef = z.infer<typeof MessageContextRefSchema>;
export const AgentDefinitionSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().max(120), role: z.string().max(120),
  description: z.string().max(1000), instructions: z.string().max(12000),
  allowed_tools: z.array(z.string()).max(64), capabilities: z.array(z.string()).max(64),
  avatar: z.object({ initials: z.string().max(4), color: z.string().max(80) }),
  model_config: z.object({ provider: z.string().optional(), model: z.string().optional(), temperature: z.number().min(0).max(2).optional() }).optional(),
  output_schema: z.string().optional(),
}).strict();
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

const key = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,159}$/);
export const RuntimeActivityInputSchema = z.object({
  kind: z.enum(['invocation', 'message', 'tool']), step_key: key,
  parent_step_key: key.optional(), agent_key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']).default('completed'),
  tool_name: z.string().max(160).optional(),
  message_type: z.enum(['task_request', 'task_result', 'data_request', 'analysis_request', 'review_request', 'clarification_request', 'handoff', 'status', 'error', 'request', 'response']).optional(),
  target_agent_key: z.string().max(80).optional(), summary: z.string().max(2000),
  artifact_refs: z.array(IdSchema).max(32).optional(), evidence_refs: z.array(z.string().max(500)).max(32).optional(),
  duration_ms: z.number().int().nonnegative().optional(), input_summary: z.string().max(2000).optional(),
  context_build_ms: z.number().int().nonnegative().optional(), context_tokens: z.number().int().nonnegative().optional(),
  error_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).optional(),
  correlation_id: z.string().max(200).optional(), parent_message_id: IdSchema.optional(),
}).strict();
export type RuntimeActivityInput = z.input<typeof RuntimeActivityInputSchema>;
export const RuntimeActivityRecordSchema = RuntimeActivityInputSchema.extend({
  activity_id: IdSchema, org_id: IdSchema, run_id: IdSchema,
  conversation_id: IdSchema.nullable(), created_at: TimestampSchema, updated_at: TimestampSchema,
});
export type RuntimeActivityRecord = z.infer<typeof RuntimeActivityRecordSchema>;
export type RuntimeActivity = RuntimeActivityRecord;
export const RuntimeActivityEventSchema = z.object({
  event_id: IdSchema, run_id: IdSchema, sequence: z.number().int().positive(),
  type: z.enum(['invocation', 'message', 'tool']), record: RuntimeActivityRecordSchema, created_at: TimestampSchema,
});
export type RuntimeActivityEvent = z.infer<typeof RuntimeActivityEventSchema>;
export const RunRuntimeSnapshotSchema = z.object({
  records: z.array(RuntimeActivityRecordSchema), events: z.array(RuntimeActivityEventSchema),
  last_sequence: z.number().int().nonnegative(),
});
export type RunRuntimeSnapshot = z.infer<typeof RunRuntimeSnapshotSchema>;

export const MemoryInputSchema = z.object({
  layer: z.enum(['working', 'episodic', 'workspace']), conversation_id: IdSchema.nullable().optional(),
  run_id: IdSchema.nullable().optional(), key: z.string().min(1).max(160),
  summary: z.string().trim().min(1).max(4000), artifact_refs: z.array(IdSchema).max(24).default([]),
  expires_at: TimestampSchema.nullable().optional(),
}).strict().superRefine((memory, ctx) => {
  if (memory.layer === 'working' && !memory.run_id) ctx.addIssue({ code: 'custom', message: 'Working memory requires a run', path: ['run_id'] });
  if (memory.layer === 'episodic' && !memory.conversation_id) ctx.addIssue({ code: 'custom', message: 'Episodic memory requires a thread', path: ['conversation_id'] });
  if (memory.layer === 'workspace' && (memory.conversation_id || memory.run_id)) ctx.addIssue({ code: 'custom', message: 'Workspace memory must not have a thread or run scope' });
});
export type MemoryInput = z.input<typeof MemoryInputSchema>;
export const MemoryEntrySchema = MemoryInputSchema.safeExtend({ memory_id: IdSchema, org_id: IdSchema, created_at: TimestampSchema, updated_at: TimestampSchema });
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export interface MemoryQuery { conversation_id?: string; run_id?: string; query?: string; limit?: number }
