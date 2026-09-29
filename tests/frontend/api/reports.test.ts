import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../src/frontend/lib/http/api-client';
import { getReportDetail } from '../../../src/frontend/features/reports/api/reports';

vi.mock('../../../src/frontend/lib/http/api-client', () => ({
  api: vi.fn(),
  scoped: (path: string) => path,
}));

const valid = {
  report: { report_id: 'report-1', org_id: 'org-1', run_id: 'run-1', artifact_id: 'artifact-1' },
  artifact: { kind: 'report', artifact_id: 'artifact-1', org_id: 'org-1', run_id: 'run-1' },
};
const mismatches: Array<
  [string, { report?: Partial<typeof valid.report>; artifact?: Partial<typeof valid.artifact> }]
> = [
  ['report ID', { report: { report_id: 'report-2' } }],
  ['report tenant', { report: { org_id: 'org-2' } }],
  ['artifact ID', { artifact: { artifact_id: 'artifact-2' } }],
  ['artifact tenant', { artifact: { org_id: 'org-2' } }],
  ['artifact run', { artifact: { run_id: 'run-2' } }],
  ['artifact kind', { artifact: { kind: 'report_draft' } }],
];

afterEach(() => vi.mocked(api).mockReset());

describe('report detail trust boundary', () => {
  it('accepts matching report and artifact identity', async () => {
    vi.mocked(api).mockResolvedValue(valid as never);
    await expect(getReportDetail('org-1', 'report-1')).resolves.toEqual(valid);
  });

  it.each(mismatches)('rejects a mismatched %s', async (_label, update) => {
    vi.mocked(api).mockResolvedValue({
      report: { ...valid.report, ...update.report },
      artifact: { ...valid.artifact, ...update.artifact },
    } as never);
    await expect(getReportDetail('org-1', 'report-1')).rejects.toThrow();
  });
});
