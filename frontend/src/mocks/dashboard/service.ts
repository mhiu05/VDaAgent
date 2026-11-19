import type { MockReadOptions, ReportsReadPort } from '../../features/reports/index';
import type { DashboardDataset } from '../../features/dashboard/index';
import { createDashboardRepository } from './repository';
import { createDashboardFixtures } from './fixtures';

export function createDashboardMockService(options: MockReadOptions, reports: ReportsReadPort, fixtures: DashboardDataset = createDashboardFixtures()) {
  return createDashboardRepository(fixtures, reports, options);
}
