import type { Principal } from "../../shared/contracts/auth";
import type { DashboardService } from "../../features/dashboard/services/dashboard-service";
import type { DashboardDataset, DashboardRepository } from "../../features/dashboard/model/types";
import type { ReportScope } from "../../features/reports/model/types";
import { RepositoryError } from "../../features/reports/model/types";
import type { ReportsService } from "../../features/reports/services/reports-service";
import type { ServiceResult } from "../../shared/contracts/service-result";
import { createDashboardRepository } from "../../mocks/dashboard/repository";
import type { ApiClient } from "./http";
import { call, forbidden } from "./result";

/** `GET /api/dashboard/dataset`, then the same pure computation the mock uses (doc 19
 * "Computation"): the rules live in one tested place. */
const CACHE_MS = 30_000;

function emptyDataset(now: Date): DashboardDataset {
  const source = { id: "dashboard", mode: "api" as const, label: "Chưa có dữ liệu",
    dataThrough: now.toISOString(), updatedAt: now.toISOString(), completeness: "missing" as const };
  return { businessTimezone: "Asia/Ho_Chi_Minh", projects: [], snapshots: [], transactions: [],
    tasks: [], transactionSource: source, taskSource: { ...source, completeness: "full" },
    coveredDates: [] };
}

export function createApiDashboard(client: ApiClient, reports: ReportsService, now: () => Date): DashboardService {
  const cache = new Map<string, { at: number; repo: DashboardRepository }>();
  async function repository(p: Principal, signal?: AbortSignal): Promise<DashboardRepository> {
    const hit = cache.get(p.id);
    if (hit && now().getTime() - hit.at < CACHE_MS) return hit.repo;
    const body = await client.get<{ dataset: DashboardDataset | null }>("/api/dashboard/dataset", undefined, signal);
    const data = body.dataset ?? emptyDataset(now());
    const unwrap = async <T,>(r: Promise<ServiceResult<T>>) => {
      const result = await r;
      if (result.error) throw new RepositoryError("unavailable", "Reports unavailable");
      return result.data;
    };
    const repo = createDashboardRepository(data, {
      summarize: (scope: ReportScope, s?: AbortSignal) => unwrap(reports.summarize(p, scope, s)),
      readRecent: (scope: ReportScope, limit: number, s?: AbortSignal) => unwrap(reports.recent(p, scope, limit, s)),
    }, { principal: { id: p.id, role: "USER", projectIds: data.projects.map((x) => x.id), reportIds: [] },
      clock: { now } });
    cache.set(p.id, { at: now().getTime(), repo });
    return repo;
  }
  const user = (p: Principal) => p.role === "USER";
  return {
    catalog: (p, signal) => reports.catalog(p, signal),
    overview: async (p, scope, signal) => !user(p) ? forbidden() : call(async () => {
      const overview = await (await repository(p, signal)).readOverview(scope, signal);
      return { ...overview, sourceMode: "api" };
    }, signal),
    breakdown: async (p, kind, scope, query, signal) => !user(p) ? forbidden() : call(async () =>
      (await repository(p, signal)).readBreakdown(kind, scope, query, signal), signal),
  };
}
