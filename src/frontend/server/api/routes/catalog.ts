import { CatalogSchema, WorkspaceSummarySchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { workspaceSummary } from '../queries/workspace-summary';
import { json } from '../middleware/response';

export async function catalogRoute(
  method: string,
  route: string,
  repo: Repository,
  userId: string,
  orgFromQuery: () => string,
): Promise<Response | null> {
  if (route === 'catalog' && method === 'GET')
    return json(CatalogSchema, await repo.catalog(userId, orgFromQuery()));
  if (route === 'workspace-summary' && method === 'GET') {
    const orgId = orgFromQuery();
    return json(WorkspaceSummarySchema, await workspaceSummary(repo, userId, orgId));
  }
  return null;
}
