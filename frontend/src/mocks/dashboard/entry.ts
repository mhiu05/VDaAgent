import type { Principal } from '../../shared/contracts/auth';
import type { MockContext } from '../core/scenarios';
import type { DashboardService } from '../../features/dashboard/services/dashboard-service';
import type { ReportsService } from '../../features/reports/services/reports-service';
import type { DashboardRepository } from '../../features/dashboard/model/types';
import { RepositoryError } from '../../features/reports/model/types';
import { createDashboardRepository } from './repository';
import { createDashboardFixtures } from './fixtures';
import { createDashboardScenario } from './scenarios';
import { scopedPrincipal, serviceCall } from '../reports/integration';

export function createDashboardMockService(context: MockContext, reports: ReportsService): DashboardService {
  const repositories = new Map<string, DashboardRepository>();
  let failInventory = context.scenario === 'error';
  function repository(principal: Principal) {
    const scope = scopedPrincipal(principal, 'USER');
    let instance = repositories.get(principal.id);
    if (!instance) {
      const data = context.scenario === 'interrupted' ? createDashboardScenario('S06') : createDashboardFixtures();
      if (context.scenario === 'empty') { data.snapshots = data.snapshots.map(s => ({ ...s, properties: [] })); data.transactions = []; data.tasks = []; }
      const unwrap = async <T,>(request: Promise<import('../../shared/contracts/service-result').ServiceResult<T>>) => {
        const result = await request; if (result.error) throw new RepositoryError('unavailable', 'Reports unavailable'); return result.data;
      };
      instance = createDashboardRepository(data, {
        summarize: (query, signal) => unwrap(reports.summarize(principal, query, signal)),
        readRecent: (query, limit, signal) => unwrap(reports.recent(principal, query, limit, signal)),
      }, { principal: scope, clock: context.clock, fail: operation => { if (failInventory && operation === 'dashboard.inventory') { failInventory = false; return new Error('demo'); } return undefined; } });
      repositories.set(principal.id, instance);
    }
    return instance;
  }
  return {
    catalog: (p, signal) => reports.catalog(p, signal),
    overview: (p, scope, signal) => serviceCall(context, () => repository(p).readOverview(scope, signal), signal),
    breakdown: (p, kind, scope, query, signal) => serviceCall(context, () => repository(p).readBreakdown(kind, scope, query, signal), signal),
  };
}
