import { z } from 'zod';
import { AcceptedSchema, ReportDefinitionSchema, type ReportDefinitionInput } from '@vda/contracts';
import { api, post, scoped } from '../../../lib/http/api-client';

export function listReportDefinitions(orgId: string) {
  return api(
    scoped('/report-definitions', orgId),
    z.object({ definitions: z.array(ReportDefinitionSchema) }),
  );
}

export function saveReportDefinition(input: ReportDefinitionInput, definitionId?: string) {
  return api(
    definitionId ? `/report-definitions/${definitionId}` : '/report-definitions',
    z.unknown(),
    { method: definitionId ? 'PATCH' : 'POST', body: JSON.stringify(input) },
  );
}

export function tickScheduler(orgId: string) {
  return api('/scheduler/tick', z.object({ enqueued: z.number() }), post({ org_id: orgId }));
}

export function triggerReportDefinition(orgId: string, definitionId: string) {
  return api(
    `/report-definitions/${definitionId}/trigger`,
    AcceptedSchema,
    post({ org_id: orgId }),
  );
}

export function deleteReportDefinition(orgId: string, definitionId: string) {
  return api(scoped(`/report-definitions/${definitionId}`, orgId), z.unknown(), {
    method: 'DELETE',
  });
}
