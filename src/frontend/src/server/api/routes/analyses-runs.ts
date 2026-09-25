import { z } from 'zod';
import {
  AcceptedSchema,
  AnalysisRequestSchema,
  RunSchema,
  RunDetailSchema,
  IdSchema,
  ArtifactListSchema,
  AgentWorkflowStatusSchema,
  DecisionBriefResponseSchema,
  DecisionIntelligenceResponseSchema,
} from '@vda/contracts';
import { body } from '../middleware/request-body';
import { json } from '../middleware/response';
import { workflowStatus } from '../queries/workflow-status';
import { OrgBody, OkSchema } from './schemas';
import type { AuthenticatedRouteContext } from './route-context';

export async function analysisRoutes(context: AuthenticatedRouteContext): Promise<Response | null> {
  const { method, route, repo, actor, orgFromQuery, request, path } = context;
  if (route === 'analyses' && method === 'POST') {
    const input = AnalysisRequestSchema.parse(await body(request));
    const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
    const run = await repo.createRun(actor.user_id, input, key);
    return json(
      AcceptedSchema,
      { run_id: run.run_id, conversation_id: run.request.conversation_id, status: run.status },
      202,
    );
  }

  if (route === 'runs' && method === 'GET')
    return json(z.object({ runs: z.array(RunSchema) }), {
      runs: await repo.listRuns(actor.user_id, orgFromQuery()),
    });

  if (path[0] === 'runs' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(RunDetailSchema, await repo.getRun(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'artifacts' && method === 'GET')
      return json(ArtifactListSchema, await repo.artifacts(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'workflow-status' && method === 'GET') {
      const orgId = orgFromQuery();
      return json(AgentWorkflowStatusSchema, await workflowStatus(repo, actor.user_id, orgId, id));
    }
    if (path[2] === 'brief' && method === 'GET')
      return json(
        DecisionBriefResponseSchema,
        await repo.decisionBrief(actor.user_id, orgFromQuery(), id),
      );
    if (path[2] === 'decision-intelligence' && method === 'GET')
      return json(
        DecisionIntelligenceResponseSchema,
        await repo.decisionIntelligence(actor.user_id, orgFromQuery(), id),
      );
    if (path[2] === 'cancel' && method === 'POST') {
      const input = OrgBody.parse(await body(request));
      await repo.cancelRun(actor.user_id, input.org_id, id);
      return json(OkSchema, { ok: true });
    }
  }
  return null;
}
