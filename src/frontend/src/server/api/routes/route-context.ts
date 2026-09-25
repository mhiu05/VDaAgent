import { PageRequestSchema, type AgentTurnRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';

export type AuthenticatedRouteContext = {
  request: Request;
  path: string[];
  method: string;
  url: URL;
  route: string;
  actor: { user_id: string; email: string };
  repo: Repository;
  orgFromQuery: () => string;
  agentTurnFromBody: (routeConversationId?: string) => Promise<AgentTurnRequest>;
  pageFromQuery: () => ReturnType<typeof PageRequestSchema.parse>;
};
