import { z } from 'zod';
import { AgentKeySchema, CursorSchema, IdSchema, TimestampSchema } from '../common/primitives';
import { MessageSchema } from './message';

/** Job invocations are turn/capability records; runtime invocations are actual TeamRuntime calls. */
export const ExecutionRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('job'), job_id: IdSchema, invocation_id: IdSchema }).strict(),
  z.object({ source: z.literal('runtime'), run_id: IdSchema, activity_id: IdSchema }).strict(),
]);
export type ExecutionRef = z.infer<typeof ExecutionRefSchema>;

export const AgentItemIdSchema = z.templateLiteral([z.enum(['message:', 'activity:']), IdSchema]);
export type AgentItemId = z.infer<typeof AgentItemIdSchema>;
export const AgentViewStateSchema = z.enum(['idle', 'queued', 'working', 'waiting']);
export const AcceptedWorkStateSchema = z.enum(['queued', 'running', 'waiting']);

export const DelegationViewSchema = z
  .object({
    request_activity_id: IdSchema,
    response_activity_id: IdSchema.nullable(),
    run_id: IdSchema,
    child: ExecutionRefSchema.nullable(),
    parent: ExecutionRefSchema.nullable(),
    root: ExecutionRefSchema.nullable(),
    caller_agent: AgentKeySchema,
    callee_agent: AgentKeySchema,
    request_summary: z.string().max(2000),
    result_summary: z.string().max(2000).nullable(),
    status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'unknown']),
    error_code: z.string().max(100).nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    artifact_refs: z.array(IdSchema).max(32),
    evidence_refs: z.array(z.string().max(500)).max(32),
    delegate_tool_activity_id: IdSchema.nullable(),
    initiating_message_id: IdSchema.nullable(),
    linkage: z.enum(['exact', 'historical_partial']),
  })
  .strict();
export type DelegationView = z.infer<typeof DelegationViewSchema>;

const ItemBaseSchema = z.object({
  item_id: AgentItemIdSchema,
  created_at: TimestampSchema,
  run_id: IdSchema.nullable(),
});
export const AgentFeedItemSchema = z.discriminatedUnion('kind', [
  ItemBaseSchema.extend({
    kind: z.literal('message'),
    message: MessageSchema,
    recipient_agent: AgentKeySchema,
    placement: z.enum(['accepted_request', 'sender', 'historical_default']),
    execution: ExecutionRefSchema.nullable(),
  }).strict(),
  ItemBaseSchema.extend({
    kind: z.enum(['delegation', 'inbound_request', 'delegated_result']),
    delegation: DelegationViewSchema,
  }).strict(),
]);
export type AgentFeedItem = z.infer<typeof AgentFeedItemSchema>;

export const AgentFeedPageSchema = z
  .object({
    conversation_id: IdSchema,
    agent_key: AgentKeySchema,
    items: z.array(AgentFeedItemSchema).max(100),
    older_cursor: CursorSchema.nullable(),
    newer_cursor: CursorSchema.nullable(),
    focus_item: AgentItemIdSchema.nullable(),
    revision: z.string().min(1).max(200),
  })
  .strict();
export type AgentFeedPage = z.infer<typeof AgentFeedPageSchema>;

export const AcceptedWorkSchema = z
  .object({
    work_id: z.string().min(1).max(120),
    kind: z.enum(['turn', 'runtime_child']),
    agent_key: AgentKeySchema,
    caller: z.union([z.literal('human'), AgentKeySchema]),
    state: AcceptedWorkStateSchema,
    summary: z.string().max(2000),
    accepted_at: TimestampSchema,
    started_at: TimestampSchema.nullable(),
    execution: ExecutionRefSchema.nullable(),
    item_id: AgentItemIdSchema.nullable(),
    waiting_on: z.array(ExecutionRefSchema).max(40),
    run_id: IdSchema.nullable(),
  })
  .strict();
export type AcceptedWork = z.infer<typeof AcceptedWorkSchema>;
export const AgentWorkPageSchema = z
  .object({
    conversation_id: IdSchema,
    agent_key: AgentKeySchema,
    items: z.array(AcceptedWorkSchema).max(100),
    next_cursor: CursorSchema.nullable(),
    revision: z.string().min(1).max(200),
  })
  .strict();
export type AgentWorkPage = z.infer<typeof AgentWorkPageSchema>;

export const AgentSummarySchema = z
  .object({
    agent_key: AgentKeySchema,
    state: AgentViewStateSchema,
    active_count: z.number().int().nonnegative(),
    queued_count: z.number().int().nonnegative(),
    running_count: z.number().int().nonnegative(),
    waiting_count: z.number().int().nonnegative(),
    recent_error: z.boolean(),
    latest_activity_at: TimestampSchema.nullable(),
    previews: z.array(AcceptedWorkSchema).max(10),
  })
  .strict();
export const ConversationAgentsSchema = z
  .object({
    conversation_id: IdSchema,
    agents: z.array(AgentSummarySchema).length(8),
    revision: z.string().min(1).max(200),
    active_job_ids: z.array(IdSchema),
    active_run_ids: z.array(IdSchema),
  })
  .strict();
export type ConversationAgents = z.infer<typeof ConversationAgentsSchema>;
