import { RepositoryError } from '@vda/db';
import { checkOrigin } from './middleware/origin';
import { authenticatedContext } from './middleware/authenticated-context';
import { logInternalError, problemResponse } from './problem-response';
import { authRoute, sessionRoute } from './routes/auth';
import { catalogRoute } from './routes/catalog';
import { analysisRoutes } from './routes/analyses-runs';
import { conversationRoutes } from './routes/conversations';
import { importRoutes } from './routes/imports';
import { reportDefinitionRoutes } from './routes/report-definitions';
import { schedulerRoutes } from './routes/scheduler';
import { reportRoutes } from './routes/reports';
import { principal, repository } from '../context';

async function handle(request: Request, path: string[]): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);
  const route = path.join('/');
  checkOrigin(request, url);
  const authResponse = await authRoute(request, method, route);
  if (authResponse) return authResponse;
  const actor = await principal();
  const repo = await repository();
  const sessionResponse = await sessionRoute(repo, actor, method, route);
  if (sessionResponse) return sessionResponse;
  const routeContext = authenticatedContext(request, path, method, url, route, actor, repo);
  const catalogResponse = await catalogRoute(
    method,
    route,
    repo,
    actor.user_id,
    routeContext.orgFromQuery,
  );
  if (catalogResponse) return catalogResponse;
  const analysisRoutesResponse = await analysisRoutes(routeContext);
  if (analysisRoutesResponse) return analysisRoutesResponse;
  const conversationRoutesResponse = await conversationRoutes(routeContext);
  if (conversationRoutesResponse) return conversationRoutesResponse;
  const importRoutesResponse = await importRoutes(routeContext);
  if (importRoutesResponse) return importRoutesResponse;
  const reportDefinitionRoutesResponse = await reportDefinitionRoutes(routeContext);
  if (reportDefinitionRoutesResponse) return reportDefinitionRoutesResponse;
  const schedulerRoutesResponse = await schedulerRoutes(routeContext);
  if (schedulerRoutesResponse) return schedulerRoutesResponse;
  const reportRoutesResponse = await reportRoutes(routeContext);
  if (reportRoutesResponse) return reportRoutesResponse;
  throw new RepositoryError('NOT_FOUND', 404);
}
export async function api(request: Request, path: string[]) {
  try {
    return await handle(request, path);
  } catch (error) {
    logInternalError(error, request.method, path.join('/'));
    return problemResponse(error);
  }
}
