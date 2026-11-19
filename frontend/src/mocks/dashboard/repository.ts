import type { MockReadOptions, ReportScope, ReportsReadPort } from '../../features/reports/index';
import { RepositoryError } from '../../features/reports/index';
import { inPeriod, paginate, validInstant, validateRange } from '../../features/reports/model/query';
import type { BreakdownRow, DashboardDataset, DashboardRepository, Section } from '../../features/dashboard/model/types';
import { ageBand, closingSnapshot, deduplicate, inventoryMetrics, inventorySummary, transactionMetric } from '../../features/dashboard/model/metrics';
import { attentionItems } from '../../features/dashboard/model/attention';
import { mockRead } from '../reports/runtime';

export function createDashboardRepository(seed: DashboardDataset, reports: ReportsReadPort, options: MockReadOptions): DashboardRepository {
  const data = structuredClone(seed); const principal = structuredClone(options.principal);
  const projectIds = (scope: ReportScope) => {
    if (principal.role !== 'USER') throw new RepositoryError('forbidden', 'Dashboard requires USER');
    validateRange(scope.from, scope.to, scope.timezone);
    return data.projects.filter(p => principal.projectIds.includes(p.id) && (!scope.project || p.id === scope.project) && (!scope.market || p.marketId === scope.market)).map(p => p.id);
  };
  const tasksInScope = (ids: readonly string[]) => deduplicate(data.tasks.filter(t => ids.includes(t.projectId) && validInstant(t.observedAt) && Date.parse(t.observedAt) <= options.clock.now().getTime())).rows;
  async function section<T>(name: string, signal: AbortSignal | undefined, read: () => T | Promise<T>): Promise<Section<T>> {
    try { await mockRead(options, name, signal); return { state: 'ready', data: await read() }; }
    catch (error) { signal?.throwIfAborted(); return { state: 'error', error: error instanceof Error ? error.message : 'Source unavailable' }; }
  }
  return {
    async readOverview(scope, signal) {
      const ids = projectIds(scope); signal?.throwIfAborted();
      const [inventory, transactions, tasks, reportSection] = await Promise.all([
        section('dashboard.inventory', signal, () => {
          const result = inventoryMetrics(data, scope, ids); const snapshot = scope.timezone === data.businessTimezone ? closingSnapshot(data, scope.to) : null;
          const rows = snapshot ? data.projects.filter(p => ids.includes(p.id)).map(project => ({ project, summary: inventorySummary(snapshot, [project.id]) })) : [];
          rows.sort((a, b) => {
            const eligible = (r: typeof a) => r.summary.eligible >= 20 && (r.summary.coverage ?? 0) >= 90;
            return Number(eligible(b)) - Number(eligible(a)) || (b.summary.share ?? -1) - (a.summary.share ?? -1) || a.project.id.localeCompare(b.project.id);
          });
          return { ...result, projects: rows };
        }),
        section('dashboard.transactions', signal, () => transactionMetric(data, scope, ids)),
        section('dashboard.tasks', signal, () => {
          const tasks = tasksInScope(ids); const missing = data.taskSource.completeness === 'missing';
          return { active: missing ? null : tasks.filter(t => t.state === 'queued' || t.state === 'running').length,
            failed: missing ? null : tasks.filter(t => t.state === 'failed' && inPeriod(t.failedAt, scope.from, scope.to, scope.timezone)).length,
            observedAt: data.taskSource.dataThrough, source: data.taskSource };
        }),
        section('dashboard.reports', signal, async () => {
          const [aggregate, recent] = await Promise.all([reports.summarize(scope, signal), reports.readRecent(scope, 5, signal)]);
          return { aggregate, recent };
        }),
      ]);
      const snapshot = closingSnapshot(data, scope.to);
      const failedIds = tasks.state === 'ready' && tasks.data.failed !== null ? tasksInScope(ids).filter(t => t.state === 'failed' && inPeriod(t.failedAt, scope.from, scope.to, scope.timezone)).map(t => t.id) : [];
      return structuredClone({ asOf: options.clock.now().toISOString(), sourceMode: 'mock', scope,
        inventory, transactions, tasks, reports: reportSection,
        attention: attentionItems(data, inventory.state === 'ready' ? inventory.data.summary : null, inventory.state === 'ready' ? inventory.data.projects : [], failedIds, snapshot?.id),
      });
    },
    async readBreakdown(kind, scope, query, signal) {
      const ids = projectIds(scope); await mockRead(options, `dashboard.breakdown.${kind}`, signal);
      let rows: BreakdownRow[];
      if (kind === 'inventory' || kind === 'slow') {
        const snapshot = scope.timezone === data.businessTimezone ? closingSnapshot(data, scope.to) : null;
        if (!snapshot) throw new RepositoryError('unavailable', 'Closing snapshot is missing');
        rows = deduplicate(snapshot.properties.filter(p => ids.includes(p.projectId))).rows.filter(p => p.status === 'available')
          .filter(p => kind !== 'slow' || ['slow', 'old'].includes(ageBand(p, snapshot.businessDate)))
          .filter(p => !query.ageBand || ageBand(p, snapshot.businessDate) === query.ageBand);
      } else if (kind === 'transactions') {
        rows = deduplicate(data.transactions.filter(t => ids.includes(t.projectId))).rows.filter(t => t.status === 'completed' && !t.test && inPeriod(t.completedAt, scope.from, scope.to, scope.timezone));
      } else {
        rows = tasksInScope(ids).filter(t => query.taskState === 'active' ? t.state === 'queued' || t.state === 'running' : query.taskState === 'failed' ? t.state === 'failed' && inPeriod(t.failedAt, scope.from, scope.to, scope.timezone) : true);
      }
      return structuredClone(paginate(rows.sort((a, b) => a.id.localeCompare(b.id)), query.page, query.pageSize));
    },
  };
}
