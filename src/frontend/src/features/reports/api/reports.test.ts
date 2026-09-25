import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../lib/http/api-client';
import { getReportDetail } from './reports';

vi.mock('../../../lib/http/api-client', () => ({
  api: vi.fn(),
  scoped: (path: string) => path,
}));

const detail = {
  report: {
    report_id: 'report-1',
    org_id: 'org-1',
    run_id: 'run-1',
    artifact_id: 'artifact-1',
  },
  artifact: {
    kind: 'report',
    artifact_id: 'artifact-1',
    org_id: 'org-1',
    run_id: 'run-1',
  },
};
const mismatches: Array<[
  string,
  { report?: Partial<typeof detail.report>; artifact?: Partial<typeof detail.artifact> },
]> = [
  ['report ID', { report: { report_id: 'report-2' } }],
  ['report organization', { report: { org_id: 'org-2' } }],
  ['artifact ID', { artifact: { artifact_id: 'artifact-2' } }],
  ['artifact organization', { artifact: { org_id: 'org-2' } }],
  ['artifact run', { artifact: { run_id: 'run-2' } }],
  ['artifact kind', { artifact: { kind: 'report_draft' } }],
];

describe('getReportDetail', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('accepts a report whose record and artifact match the requested organization', async () => {
    vi.mocked(api).mockResolvedValue(detail as never);
    await expect(getReportDetail('org-1', 'report-1')).resolves.toEqual(detail);
  });

  it.each(mismatches)('rejects a mismatched %s', async (_label, change) => {
    vi.mocked(api).mockResolvedValue({
      report: { ...detail.report, ...change.report },
      artifact: { ...detail.artifact, ...change.artifact },
    } as never);
    await expect(getReportDetail('org-1', 'report-1')).rejects.toThrow();
  });
});
