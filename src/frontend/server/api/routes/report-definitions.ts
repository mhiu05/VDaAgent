import { z } from 'zod';
import {
  ReportDefinitionSchema,
  ReportDefinitionInputSchema,
  AcceptedSchema,
  IdSchema,
} from '@vda/contracts';
import { body } from '../middleware/request-body';
import { json } from '../middleware/response';
import { OkSchema, TriggerBody } from './schemas';
import type { AuthenticatedRouteContext } from './route-context';

export async function reportDefinitionRoutes(
  context: AuthenticatedRouteContext,
): Promise<Response | null> {
  const { method, route, repo, actor, orgFromQuery, request, path } = context;
  if (route === 'report-definitions') {
    if (method === 'GET')
      return json(z.object({ definitions: z.array(ReportDefinitionSchema) }), {
        definitions: await repo.listDefinitions(actor.user_id, orgFromQuery()),
      });
    if (method === 'POST')
      return json(
        ReportDefinitionSchema,
        await repo.createDefinition(
          actor.user_id,
          ReportDefinitionInputSchema.parse(await body(request)),
        ),
        201,
      );
  }

  if (path[0] === 'report-definitions' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'PATCH') {
      const input = ReportDefinitionInputSchema.parse(await body(request));
      return json(
        ReportDefinitionSchema,
        await repo.updateDefinition(actor.user_id, input.org_id, id, input),
      );
    }
    if (path.length === 2 && method === 'DELETE') {
      await repo.deleteDefinition(actor.user_id, orgFromQuery(), id);
      return json(OkSchema, { ok: true });
    }
    if (path[2] === 'trigger' && method === 'POST') {
      const input = TriggerBody.parse(await body(request));
      const occurrence = await repo.triggerDefinition(
        actor.user_id,
        input.org_id,
        id,
        input.scheduled_for ? new Date(input.scheduled_for) : undefined,
      );
      const { run } = await repo.getRun(actor.user_id, input.org_id, occurrence.run_id);
      return json(
        AcceptedSchema,
        { run_id: run.run_id, conversation_id: run.request.conversation_id, status: run.status },
        202,
      );
    }
  }
  return null;
}
