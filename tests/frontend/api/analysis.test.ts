import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAcknowledgedRun,
  cancelAnalysisRun,
  createAnalysis,
} from '../../../src/frontend/features/analysis/api/run-data';

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const conversationId = '30000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());

describe('analysis API wire contract', () => {
  it('sends the selected tenant, scope, date, question and idempotency key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ run_id: runId, conversation_id: conversationId, status: 'queued' }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createAnalysis(orgId, 'PROJECT', '', '2026-09-20', 'Question', conversationId);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analyses',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          org_id: orgId,
          scope: { project_external_id: 'PROJECT', zone_external_id: null },
          data_as_of: '2026-09-20',
          question: 'Question',
          conversation_id: conversationId,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('keeps separate cancellation response contracts for Workspace and Agent Chat', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(cancelAnalysisRun(orgId, runId)).resolves.toEqual({ ok: false });
    await expect(cancelAcknowledgedRun(orgId, runId)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/runs/${runId}/cancel?org_id=${orgId}`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ org_id: orgId }) }),
    );
  });
});
