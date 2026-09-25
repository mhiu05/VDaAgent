import { z } from 'zod';
import { IdSchema, TimestampSchema } from '../common/primitives';
import { AgentTurnRequestSchema, type AgentTurnRequest } from '../chat/message';

export const AgentExecutionStatusSchema = z.enum([
  'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled',
]);
export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatusSchema>;
export const AgentExecutionEventTypeSchema = z.enum([
  'turn_queued', 'turn_claimed', 'turn_waiting', 'turn_completed', 'turn_failed',
  'turn_cancelled', 'run_linked', 'invocation_queued', 'invocation_started', 'invocation_waiting',
  'invocation_completed', 'invocation_failed', 'invocation_cancelled',
]);
export type AgentExecutionEventType = z.infer<typeof AgentExecutionEventTypeSchema>;
export const AgentExecutionEventDataSchema = z.object({
  run_id: IdSchema.optional(),
  artifact_id: IdSchema.optional(),
  error_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).optional(),
}).strict();
export const AgentTurnJobSchema = z.object({
  job_id: IdSchema, org_id: IdSchema, conversation_id: IdSchema,
  user_message_id: IdSchema, assistant_message_id: IdSchema, created_by: IdSchema,
  status: AgentExecutionStatusSchema, run_id: IdSchema.nullable(),
  attempt: z.number().int().min(0).max(3), fencing_token: z.number().int().min(0),
  worker_id: z.string().nullable(), lease_until: TimestampSchema.nullable(),
  error_code: z.string().nullable(), created_at: TimestampSchema, updated_at: TimestampSchema,
}).strict();
export type AgentTurnJob = z.infer<typeof AgentTurnJobSchema>;
export const AgentTurnJobViewSchema = z.object({
  job_id: IdSchema, conversation_id: IdSchema, user_message_id: IdSchema, assistant_message_id: IdSchema,
  status: AgentExecutionStatusSchema, run_id: IdSchema.nullable(), error_code: z.string().nullable(),
  created_at: TimestampSchema, updated_at: TimestampSchema,
}).strict();
export type AgentTurnJobView = z.infer<typeof AgentTurnJobViewSchema>;
export const AgentInvocationSchema = z.object({
  invocation_id: IdSchema, org_id: IdSchema, job_id: IdSchema,
  parent_invocation_id: IdSchema.nullable(), step_key: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,119}$/),
  agent_key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
  depth: z.number().int().min(0).max(16), status: AgentExecutionStatusSchema,
  run_id: IdSchema.nullable(), analysis_stage_id: IdSchema.nullable(),
  created_at: TimestampSchema, updated_at: TimestampSchema,
}).strict();
export type AgentInvocation = z.infer<typeof AgentInvocationSchema>;
export const AgentExecutionEventSchema = z.object({
  event_id: IdSchema, org_id: IdSchema, job_id: IdSchema,
  invocation_id: IdSchema.nullable(), sequence: z.number().int().positive(),
  type: AgentExecutionEventTypeSchema, data: AgentExecutionEventDataSchema,
  created_at: TimestampSchema,
}).strict();
export type AgentExecutionEvent = z.infer<typeof AgentExecutionEventSchema>;

const transitions: Record<AgentExecutionStatus, readonly AgentExecutionStatus[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['waiting', 'completed', 'failed', 'cancelled'],
  waiting: ['queued', 'completed', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: [],
};
export function canTransitionAgentExecution(from: AgentExecutionStatus, to: AgentExecutionStatus) {
  return transitions[from].includes(to);
}

export const AGENT_PERSONA_KEYS = ['orchestrator', 'data', 'compare', 'insight', 'report'] as const;
export const AgentPersonaKeySchema = z.enum(AGENT_PERSONA_KEYS);
export type AgentPersonaKey = z.infer<typeof AgentPersonaKeySchema>;

/** Public persona-to-canonical-task mapping for the pinned agent-v1 workflow. */
export const AGENT_V1_PERSONA_STAGES: Readonly<Record<Exclude<AgentPersonaKey, 'orchestrator'>, readonly string[]>> = {
  data: ['data'],
  compare: ['comparison'],
  insight: ['analyst', 'insight'],
  report: ['chart', 'report', 'reviewer', 'publication'],
};

export function aggregatePersonaStageStatus(
  statuses: readonly ('pending' | 'running' | 'succeeded' | 'failed' | 'cancelled')[],
): AgentExecutionStatus {
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.length > 0 && statuses.every((status) => status === 'succeeded')) return 'completed';
  if (statuses.some((status) => status === 'running' || status === 'succeeded')) return 'running';
  return 'queued';
}

/** A deliberately small, deterministic admission rule for the first durable inventory run. */
export function isApprovedDurableAnalysisTurn(value: AgentTurnRequest): boolean {
  const parsed = AgentTurnRequestSchema.safeParse(value);
  if (!parsed.success) return false;
  const turn = parsed.data;
  if (
    turn.use_case !== 'slow_moving_inventory' ||
    turn.agent_target || turn.signal_ref || turn.signal_action || turn.drilldown_ref
  ) return false;
  const text = turn.text.trim();
  return (
    /\b(?:inventory|stock|slow[ -]moving)\b|tồn kho/iu.test(text) &&
    /\b(?:analy[sz]e|analysis|show|compare|report|summari[sz]e)\b|phân tích|so sánh|xem|báo cáo/iu.test(text) &&
    !/\b(?:why|cause|causal|sql|query|delete|update|insert|drop|alter)\b|tại sao|vì sao|nguyên nhân|truy vấn/iu.test(text)
  );
}
