import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteReportDefinition,
  saveReportDefinition,
  tickScheduler,
  triggerReportDefinition,
} from '../../../src/frontend/features/schedules/api/report-definitions';

const orgId = '10000000-0000-4000-8000-000000000001';
const definitionId = '20000000-0000-4000-8000-000000000001';
const input = {
  org_id: orgId,
  name: 'Daily inventory',
  scope: { project_external_id: 'P1', zone_external_id: null },
  timezone: 'Asia/Bangkok',
  local_time: '08:00',
  data_as_of_policy: 'scheduled_date' as const,
  enabled: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('schedule client contract', () => {
  it('keeps create, update, and tenant-scoped delete requests stable', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await saveReportDefinition(input);
    await saveReportDefinition(input, definitionId);
    await deleteReportDefinition(orgId, definitionId);
    expect(fetchMock.mock.calls).toEqual([
      [
        '/api/report-definitions',
        expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
      ],
      [
        `/api/report-definitions/${definitionId}`,
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify(input) }),
      ],
      [
        `/api/report-definitions/${definitionId}?org_id=${orgId}`,
        expect.objectContaining({ method: 'DELETE' }),
      ],
    ]);
  });

  it('keeps scheduler tick and manual trigger responses distinct', async () => {
    const accepted = {
      run_id: '30000000-0000-4000-8000-000000000001',
      conversation_id: '40000000-0000-4000-8000-000000000001',
      status: 'queued',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enqueued: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accepted)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(tickScheduler(orgId)).resolves.toEqual({ enqueued: 2 });
    await expect(triggerReportDefinition(orgId, definitionId)).resolves.toEqual(accepted);
    expect(fetchMock.mock.calls).toEqual([
      [
        '/api/scheduler/tick',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ org_id: orgId }) }),
      ],
      [
        `/api/report-definitions/${definitionId}/trigger`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ org_id: orgId }) }),
      ],
    ]);
  });
});
