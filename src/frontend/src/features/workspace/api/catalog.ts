import { CatalogSchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export function getCatalog(orgId: string) {
  return api(scoped('/catalog', orgId), CatalogSchema);
}
