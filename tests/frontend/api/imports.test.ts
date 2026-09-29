import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitImport } from '../../../src/frontend/features/imports/api/imports';

afterEach(() => vi.unstubAllGlobals());

describe('CSV import API wire contract', () => {
  it('forwards the organization, source name and exact CSV bytes', async () => {
    const orgId = '10000000-0000-4000-8000-000000000001';
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            manifest: {
              import_id: '20000000-0000-4000-8000-000000000001',
              org_id: orgId,
              source_name: 'inventory.csv',
              created_by: '30000000-0000-4000-8000-000000000001',
              file_hash: 'a'.repeat(64),
              storage_path: null,
              schema_version: 'csv-v1',
              provisional: true,
              row_count: 1,
              created_at: '2026-09-20T00:00:00.000Z',
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitImport(orgId, 'inventory.csv', 'col\nvalue')).resolves.toHaveProperty(
      'manifest',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/imports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, source_name: 'inventory.csv', csv: 'col\nvalue' }),
      }),
    );
  });
});
