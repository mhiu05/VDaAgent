import { z } from 'zod';
import { RunSchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export function listRuns(orgId: string) {
  return api(scoped('/runs', orgId), z.object({ runs: z.array(RunSchema) }));
}
