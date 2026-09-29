import { z } from 'zod';
import { body } from '../middleware/request-body';
import { json } from '../middleware/response';
import { TickBody } from './schemas';
import type { AuthenticatedRouteContext } from './route-context';

export async function schedulerRoutes(
  context: AuthenticatedRouteContext,
): Promise<Response | null> {
  const { method, route, repo, actor, request } = context;
  if (route === 'scheduler/tick' && method === 'POST') {
    const input = TickBody.parse(await body(request));
    const occurrences = await repo.tick(input.now ? new Date(input.now) : undefined, {
      userId: actor.user_id,
      orgId: input.org_id,
    });
    return json(z.object({ enqueued: z.number().int().nonnegative() }), {
      enqueued: occurrences.length,
    });
  }
  return null;
}
