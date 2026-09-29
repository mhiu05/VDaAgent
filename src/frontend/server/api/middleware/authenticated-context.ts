import { AgentTurnRequestSchema, IdSchema, PageRequestSchema } from '@vda/contracts';
import { RepositoryError, type Repository } from '@vda/db';
import { assertWorkspaceConversationCoherence } from '@vda/agents';
import { body } from './request-body';
import type { AuthenticatedRouteContext } from '../routes/route-context';

export function authenticatedContext(
  request: Request,
  path: string[],
  method: string,
  url: URL,
  route: string,
  actor: { user_id: string; email: string },
  repo: Repository,
): AuthenticatedRouteContext {
  const orgFromQuery = () => IdSchema.parse(url.searchParams.get('org_id'));
  /**
   * The query/route tenant is authoritative for a chat turn. The duplicate
   * body field remains for legacy request compatibility, but it cannot select
   * a different organization before a runtime context is built.
   */
  const agentTurnFromBody = async (routeConversationId?: string) => {
    const input = AgentTurnRequestSchema.parse(await body(request));
    if (input.org_id !== orgFromQuery()) throw new RepositoryError('NO_AUTHORIZED_RESULT', 403);
    // Enforce the route as the conversation authority before selecting either
    // runtime path. The legacy handler intentionally remains available during
    // rollout, but it must not become a bypass for the versioned snapshot.
    assertWorkspaceConversationCoherence(input, routeConversationId);
    return input;
  };
  const pageFromQuery = () =>
    PageRequestSchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? null,
    });
  return {
    request,
    path,
    method,
    url,
    route,
    actor,
    repo,
    orgFromQuery,
    agentTurnFromBody,
    pageFromQuery,
  };
}
