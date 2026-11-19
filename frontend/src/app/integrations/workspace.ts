/** FROZEN F0 bridge. Machine 2 may replace only this file to integrate its entries. */
import type { FeatureRegistration, LocaleMessages } from '../../shared/contracts/feature-registration';
import type { MockContext } from '../../mocks/core/scenarios';
import { featureRegistration as dashboard, messages as dashboardMessages } from '../../features/dashboard/entry';
import { featureRegistration as reports, messages as reportsMessages } from '../../features/reports/entry';
import { featureRegistration as adminUsers, messages as adminMessages } from '../../features/admin-users/entry';
import { createDashboardMockService } from '../../mocks/dashboard/entry';
import { createReportsMockService, hasReport } from '../../mocks/reports/entry';
import { createAdminUsersMockService } from '../../mocks/admin-users/entry';
export interface WorkspaceIntegration {
  registrations: readonly FeatureRegistration[];
  messages: Partial<Record<'dashboard' | 'reports' | 'admin-users', LocaleMessages>>;
  createServices(context: MockContext): Record<string, unknown>;
  hasReport(reportId: string): boolean;
}
let catalogScenario: MockContext['scenario'] = 'success';
export const workspace: WorkspaceIntegration = {
  registrations: [dashboard, reports, adminUsers],
  messages: { dashboard: dashboardMessages, reports: reportsMessages, 'admin-users': adminMessages },
  createServices(context) {
    catalogScenario = context.scenario;
    const reports = createReportsMockService(context);
    return { reports, dashboard: createDashboardMockService(context, reports), 'admin-users': createAdminUsersMockService(context) };
  },
  hasReport: id => hasReport(id, catalogScenario),
};
