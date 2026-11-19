import type { Principal } from '../../../shared/contracts/auth';
import type { ServiceResult } from '../../../shared/contracts/service-result';
import type { WorkspaceCatalog } from '../../reports/services/reports-service';
import type { Page, ReportScope } from '../../reports/model/types';
import type { BreakdownKind, BreakdownQuery, BreakdownRow, DashboardOverview } from '../model/types';
export interface DashboardService {
  catalog(principal: Principal, signal?: AbortSignal): Promise<ServiceResult<WorkspaceCatalog>>;
  overview(principal: Principal, scope: ReportScope, signal?: AbortSignal): Promise<ServiceResult<DashboardOverview>>;
  breakdown(principal: Principal, kind: BreakdownKind, scope: ReportScope, query: BreakdownQuery, signal?: AbortSignal): Promise<ServiceResult<Page<BreakdownRow>>>;
}
