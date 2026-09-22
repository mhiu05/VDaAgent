import { z } from 'zod';
import {
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  AgentWorkflowStatusSchema,
  ConversationPageSchema,
  ConversationSchema,
  MessagePageSchema,
  type AgentTurnRequest,
  type PageRequest,
} from '@vda/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public runId?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = z
      .object({
        detail: z.string().optional(),
        title: z.string().optional(),
        run_id: z.string().optional(),
      })
      .passthrough()
      .safeParse(body);
    throw new ApiError(
      problem.success
        ? (problem.data.detail ?? problem.data.title ?? 'Yêu cầu thất bại.')
        : 'Yêu cầu thất bại.',
      response.status,
      problem.success ? problem.data.run_id : undefined,
    );
  }
  return schema.parse(body);
}

export function scoped(path: string, orgId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}org_id=${encodeURIComponent(orgId)}`;
}

export function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export type TurnRequestIdentity = { client_turn_id: string; idempotency_key: string };

export function createTurnIdentity(): TurnRequestIdentity {
  const id = crypto.randomUUID();
  return { client_turn_id: id, idempotency_key: crypto.randomUUID() };
}

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

/** Owner/analyst-only compact status for private draft/review checkpoints. */
export function getAgentWorkflowStatus(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}/workflow-status`, orgId), AgentWorkflowStatusSchema);
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể hoàn thành yêu cầu. Vui lòng thử lại.';
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
