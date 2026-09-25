import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rehydrateAction } from './action-hydration';

const { getRunArtifacts, getRunDecision, getRunDetail, getReportDetail } = vi.hoisted(() => ({
  getRunArtifacts: vi.fn(),
  getRunDecision: vi.fn(),
  getRunDetail: vi.fn(),
  getReportDetail: vi.fn(),
}));
vi.mock('../../analysis/api/run-data', () => ({ getRunArtifacts, getRunDecision, getRunDetail }));
vi.mock('../../reports/api/reports', () => ({ getReportDetail }));

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const artifactId = '30000000-0000-4000-8000-000000000001';

beforeEach(() => vi.clearAllMocks());

describe('Grok action hydration', () => {
  it('rejects an evidence action whose artifact is absent from the authorized run bundle', async () => {
    getRunArtifacts.mockResolvedValue({ artifacts: [] });
    await expect(
      rehydrateAction(orgId, {
        type: 'open_evidence',
        run_id: runId,
        artifact_id: artifactId,
        evidence_path: null,
      }),
    ).rejects.toThrow('stale workspace action');
    expect(getRunArtifacts).toHaveBeenCalledWith(orgId, runId);
  });

  it('rejects a report reference whose authorized report belongs to another run', async () => {
    getReportDetail.mockResolvedValue({ report: { run_id: 'other-run' } });
    await expect(
      rehydrateAction(orgId, { type: 'open_dashboard', run_id: runId, report_id: 'report-id' }),
    ).rejects.toThrow('stale workspace action');
  });

  it('requires an available decision and a referenced chart before a visual action', async () => {
    getRunDecision.mockResolvedValue({ status: 'unavailable' });
    await expect(
      rehydrateAction(orgId, { type: 'focus_visual', run_id: runId, chart_id: 'chart-id' }),
    ).rejects.toThrow('stale workspace action');
    getRunDecision.mockResolvedValue({
      status: 'available',
      decision_intelligence: { visual_story: { ordered_visuals: [] } },
    });
    await expect(
      rehydrateAction(orgId, { type: 'focus_visual', run_id: runId, chart_id: 'chart-id' }),
    ).rejects.toThrow('stale workspace action');
  });
});
