import { z } from 'zod';
import { ImportManifestSchema, ImportRequestSchema } from '@vda/contracts';
import { body } from '../middleware/request-body';
import { json } from '../middleware/response';
import type { AuthenticatedRouteContext } from './route-context';

export async function importRoutes(context: AuthenticatedRouteContext): Promise<Response | null> {
  const { method, route, repo, actor, orgFromQuery, request } = context;
  if (route === 'imports') {
    if (method === 'GET')
      return json(z.object({ imports: z.array(ImportManifestSchema) }), {
        imports: await repo.listImports(actor.user_id, orgFromQuery()),
      });
    if (method === 'POST')
      return json(
        z.object({ manifest: ImportManifestSchema }),
        {
          manifest: await repo.importCsv(
            actor.user_id,
            ImportRequestSchema.parse(await body(request)),
          ),
        },
        201,
      );
  }
  return null;
}
