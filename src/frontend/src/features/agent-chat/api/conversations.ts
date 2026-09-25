import {
  AgentTurnAcceptedSchema,
  AgentTurnJobViewSchema,
  AgentInvocationSchema,
  AgentExecutionEventSchema,
  AgentTurnRequestSchema,
  ConversationPageSchema,
  ConversationSchema,
  MessagePageSchema,
  type AgentTurnRequest,
  type PageRequest,
} from '@vda/contracts';
import { z } from 'zod';
import { api, scoped } from '../../../lib/http/api-client';
import type { TurnRequestIdentity } from '../../../lib/http/turn-identity';
export { createTurnIdentity } from '../../../lib/http/turn-identity';
export type { TurnRequestIdentity } from '../../../lib/http/turn-identity';

function pageQuery(page: Partial<PageRequest> = {}): string {
  const query = new URLSearchParams();
  if (page.limit !== undefined) query.set('limit', String(page.limit));
  if (page.cursor) query.set('cursor', page.cursor);
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function listConversations(orgId: string, page?: Partial<PageRequest>) {
  return api(scoped(`/conversations${pageQuery(page)}`, orgId), ConversationPageSchema);
}

export function getConversation(orgId: string, conversationId: string) {
  return api(scoped(`/conversations/${conversationId}`, orgId), ConversationSchema);
}

export const AgentTurnJobSnapshotSchema = z.object({
  job: AgentTurnJobViewSchema,
  invocations: z.array(AgentInvocationSchema).max(100),
  events: z.array(AgentExecutionEventSchema).max(100),
}).strict();
export type AgentTurnJobSnapshot = z.infer<typeof AgentTurnJobSnapshotSchema>;

export function getConversationAgentTurnJob(orgId: string, conversationId: string) {
  return api(scoped(`/conversations/${conversationId}/agent-turn-job`, orgId), AgentTurnJobSnapshotSchema.nullable());
}

export function getAgentTurnJob(orgId: string, jobId: string) {
  return api(scoped(`/agent-turn-jobs/${jobId}`, orgId), AgentTurnJobSnapshotSchema.nullable());
}

export function cancelAgentTurnJob(orgId: string, jobId: string) {
  return api(scoped(`/agent-turn-jobs/${jobId}/cancel`, orgId), AgentTurnJobViewSchema, { method: 'POST' });
}

export function listConversationMessages(
  orgId: string,
  conversationId: string,
  page?: Partial<PageRequest>,
) {
  return api(
    scoped(`/conversations/${conversationId}/messages${pageQuery(page)}`, orgId),
    MessagePageSchema,
  );
}

export function sendTurn(
  orgId: string,
  input: Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'>,
  identity: TurnRequestIdentity,
  conversationId?: string,
) {
  const body = AgentTurnRequestSchema.parse({
    ...input,
    org_id: orgId,
    client_turn_id: identity.client_turn_id,
  });
  const path = conversationId ? `/conversations/${conversationId}/messages` : '/conversations';
  return api(scoped(path, orgId), AgentTurnAcceptedSchema, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': identity.idempotency_key },
  });
}
