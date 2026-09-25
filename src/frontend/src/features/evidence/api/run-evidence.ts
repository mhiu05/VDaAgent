import { ArtifactListSchema, RunDetailSchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export function getRunEvidence(orgId: string, runId: string) {
  return Promise.all([
    api(scoped('/runs/' + runId, orgId), RunDetailSchema),
    api(scoped('/runs/' + runId + '/artifacts', orgId), ArtifactListSchema).catch(() => null),
  ]);
}
