import type { AdminDataset, AdminQuery, ManagedUser } from './types';
import { fold, paginate, validInstant } from '../../reports/model/query';

export const defaultAdminQuery = (): AdminQuery => ({ q: '', statuses: [], sort: 'createdAt', direction: 'desc', page: 1, pageSize: 25 });
export function parseAdminQuery(params: URLSearchParams): AdminQuery {
  const query = defaultAdminQuery();
  query.q = (params.get('q') ?? '').trim().slice(0, 500);
  query.statuses = [...new Set(params.getAll('status'))].filter((s): s is 'active' | 'disabled' => s === 'active' || s === 'disabled').sort();
  const sort = params.get('sort'); if (sort === 'name' || sort === 'lastActiveAt') query.sort = sort;
  if (params.get('direction') === 'asc') query.direction = 'asc';
  const page = Number(params.get('page')); if (Number.isSafeInteger(page) && page > 0) query.page = page;
  const size = Number(params.get('pageSize')); if (size === 25 || size === 50 || size === 100) query.pageSize = size;
  query.user = params.get('user') || undefined;
  return query;
}
export function serializeAdminQuery(query: AdminQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const status of [...new Set(query.statuses)].sort()) params.append('status', status);
  for (const key of ['sort', 'direction', 'page', 'pageSize', 'user'] as const) if (query[key] !== undefined) params.set(key, String(query[key]));
  return params;
}
export function updateAdminQuery(query: AdminQuery, patch: Partial<AdminQuery>): AdminQuery { return { ...query, ...patch, page: patch.page ?? 1 }; }
export function queryUsers(data: AdminDataset, query: AdminQuery) {
  const rows = data.users.filter(u => u.role === 'USER' && (!query.q || fold(`${u.name} ${u.email}`).includes(fold(query.q))) && (!query.statuses.length || query.statuses.includes(u.status)));
  const sortValue = (u: ManagedUser): string | number | null => query.sort === 'name' ? fold(u.name) : u[query.sort] && validInstant(u[query.sort]!) ? Date.parse(u[query.sort]!) : null;
  rows.sort((a, b) => {
    const av = sortValue(a); const bv = sortValue(b);
    if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * (query.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
  return paginate(rows, query.page, query.pageSize);
}
