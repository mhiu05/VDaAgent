import type { MockReadOptions, ReportDataset } from '../../features/reports/model/types';
import { createReportsRepository } from './repository';
import { createReportFixtures } from './fixtures';

/** Local binding only. Shared-context signature will be adapted after contract freeze. */
export function createReportsMockService(options: MockReadOptions, fixtures: ReportDataset = createReportFixtures()) {
  return createReportsRepository(fixtures, options);
}
