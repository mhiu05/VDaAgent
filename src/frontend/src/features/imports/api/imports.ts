import { z } from 'zod';
import { ImportManifestSchema } from '@vda/contracts';
import { api, post, scoped } from '../../../lib/http/api-client';

export function listImports(orgId: string) {
  return api(scoped('/imports', orgId), z.object({ imports: z.array(ImportManifestSchema) }));
}

export function submitImport(orgId: string, source: string, csv: string) {
  return api(
    '/imports',
    z.object({ manifest: ImportManifestSchema }),
    post({ org_id: orgId, source_name: source, csv }),
  );
}
