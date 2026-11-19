import type { ReportScope } from '../../reports/index';
import { validateRange } from '../../reports/model/query';
import type { Project } from './types';
import { daysBetween } from './metrics';

export interface DashboardQuery {
  scope: ReportScope;
  inspect?: 'inventory' | 'slow' | 'transactions' | 'project' | 'tasks';
  target?: string;
  taskState?: 'active' | 'failed' | 'all';
}
export function parseDashboardQuery(params: URLSearchParams, fallback: ReportScope, projects: readonly Pick<Project, 'id' | 'marketId'>[]): { query: DashboardQuery; warnings: string[] } {
  const warnings: string[] = [];
  const scope: ReportScope = { from: params.get('from') ?? fallback.from, to: params.get('to') ?? fallback.to, timezone: params.get('timezone') ?? fallback.timezone };
  try { if (!scope.from || !scope.to) throw new Error('Dashboard dates are required'); validateRange(scope.from, scope.to, scope.timezone); if ((daysBetween(scope.from, scope.to) ?? 0) > 366) throw new Error('Range exceeds demo limit'); } catch { Object.assign(scope, fallback); warnings.push('dateRange'); }
  const market = params.get('market');
  if (market && projects.some(p => p.marketId === market)) scope.market = market;
  else if (market) warnings.push('market');
  const project = params.get('project');
  if (project && projects.some(p => p.id === project && (!scope.market || scope.market === p.marketId))) scope.project = project;
  else if (project) warnings.push('project');
  const query: DashboardQuery = { scope };
  const inspect = params.get('inspect');
  if (inspect && ['inventory', 'slow', 'transactions', 'project', 'tasks'].includes(inspect)) query.inspect = inspect as DashboardQuery['inspect'];
  if (query.inspect) query.target = params.get('target') || undefined;
  const state = params.get('taskState');
  if (query.inspect === 'tasks' && (state === 'active' || state === 'failed' || state === 'all')) query.taskState = state;
  return { query, warnings };
}
export function serializeDashboardQuery(query: DashboardQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query.scope, inspect: query.inspect, target: query.target, taskState: query.taskState })) if (value !== undefined) params.set(key, value);
  return params;
}
