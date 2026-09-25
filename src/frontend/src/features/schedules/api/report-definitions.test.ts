import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteReportDefinition,
  saveReportDefinition,
  tickScheduler,
  triggerReportDefinition,
} from './report-definitions';

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

describe('report definition requests', () => {
  it('preserves create, update, and tenant-scoped delete wire shapes', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await saveReportDefinition(input);
    await saveReportDefinition(input, definitionId);
    await deleteReportDefinition(orgId, definitionId);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/v1/report-definitions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/v1/report-definitions/${definitionId}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(input) }),
    ]);
    expect(fetchMock.mock.calls[2]).toEqual([
      `/api/v1/report-definitions/${definitionId}?org_id=${orgId}`,
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });

  it('preserves scheduler tick and manual trigger response contracts', async () => {
    const runId = '30000000-0000-4000-8000-000000000001';
    const conversationId = '40000000-0000-4000-8000-000000000001';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enqueued: 2 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ run_id: runId, conversation_id: conversationId, status: 'queued' }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(tickScheduler(orgId)).resolves.toEqual({ enqueued: 2 });
    await expect(triggerReportDefinition(orgId, definitionId)).resolves.toEqual({
      run_id: runId,
      conversation_id: conversationId,
      status: 'queued',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/scheduler/tick');
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/report-definitions/${definitionId}/trigger`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ org_id: orgId }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ org_id: orgId }),
    });
  });
});
