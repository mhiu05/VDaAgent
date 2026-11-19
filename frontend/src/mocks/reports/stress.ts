/** Harness-only; never imported by the default service factory. */
import type { ReportDataset } from '../../features/reports/index';
import { createReportFixtures } from './fixtures';

export function createStressReports(count = 10_000): ReportDataset {
  const sample = createReportFixtures();
  return { ...sample, records: Array.from({ length: count }, (_, i) => ({ ...structuredClone(sample.records[16]), id: `stress-${String(i).padStart(5, '0')}`, code: `DEMO-${i}`, title: `Báo cáo mô phỏng ${i}`, versionIds: [], latestAttemptId: null })), versions: [], attempts: [], evidence: [], artifacts: [] };
}
