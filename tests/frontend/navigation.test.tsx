import { describe, expect, it } from 'vitest';
import { workspaceRouteHref, workspaceRouteMeta } from '../../src/frontend/components/shell/routes';

describe('shareable workspace routes', () => {
  it('encodes run and organization identifiers separately', () => {
    expect(
      workspaceRouteHref(
        { page: 'runs', runId: 'run/with reserved characters' },
        'org/with reserved characters',
      ),
    ).toBe('/runs/run%2Fwith%20reserved%20characters?org_id=org%2Fwith%20reserved%20characters');
  });

  it('uses the analysis surface for a run detail while keeping Runs selected', () => {
    expect(workspaceRouteMeta({ page: 'runs', runId: 'run-id' })).toMatchObject({
      section: 'runs',
      surface: 'analysis',
      title: 'Chi tiết lượt chạy',
    });
  });
});
