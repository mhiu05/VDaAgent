import { describe, expect, it } from 'vitest';
import { workspaceRouteHref, workspaceRouteMeta } from './routes';

describe('workspace routes', () => {
  it('keeps a detail route tenant-scoped when an organization is supplied', () => {
    expect(
      workspaceRouteHref(
        { page: 'runs', runId: 'run/with reserved characters' },
        'org/with reserved characters',
      ),
    ).toBe('/runs/run%2Fwith%20reserved%20characters?org_id=org%2Fwith%20reserved%20characters');
  });

  it('maps a run detail to the analysis surface while retaining the Runs navigation section', () => {
    expect(workspaceRouteMeta({ page: 'runs', runId: 'run-id' })).toMatchObject({
      section: 'runs',
      surface: 'analysis',
      title: 'Chi tiết lượt chạy',
    });
  });
});
