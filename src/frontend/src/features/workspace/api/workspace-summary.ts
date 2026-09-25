import { WorkspaceSummarySchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export function getWorkspaceSummary(orgId: string) {
  return api(scoped('/workspace-summary', orgId), WorkspaceSummarySchema);
}
