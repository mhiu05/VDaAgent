import { z } from 'zod';
import {
  ReportRecordSchema,
  ReportDetailSchema,
  ExportRequestSchema,
  ExportResponseSchema,
  IdSchema,
} from '@vda/contracts';
import { createReportExport, resolveReportDownload } from '../queries/report-export';
import { body } from '../middleware/request-body';
import { json, noStore } from '../middleware/response';

import type { AuthenticatedRouteContext } from './route-context';

export async function reportRoutes(context: AuthenticatedRouteContext): Promise<Response | null> {
  const { method, route, repo, actor, orgFromQuery, request, path, url } = context;
  if (route === 'reports' && method === 'GET')
    return json(z.object({ reports: z.array(ReportRecordSchema) }), {
      reports: await repo.listReports(actor.user_id, orgFromQuery()),
    });

  if (path[0] === 'reports' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(ReportDetailSchema, await repo.getReport(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'exports' && method === 'POST') {
      const input = ExportRequestSchema.parse(await body(request));
      const orgId = orgFromQuery();
      return json(
        ExportResponseSchema,
        await createReportExport(repo, actor.user_id, orgId, id, input.format),
      );
    }
    if (path[2] === 'download' && method === 'GET') {
      const { exported, format } = await resolveReportDownload(
        repo,
        actor.user_id,
        id,
        url.searchParams.get('token'),
      );
      return new Response(exported.body, {
        headers: {
          ...noStore,
          'Content-Type': exported.contentType,
          'Content-Disposition': `attachment; filename="vda-report-${id}.${format}"`,
        },
      });
    }
  }
  return null;
}
