import type { ReportDataset, ReportQuery, ReportRecord, ReportStatus, ReportSummary, ReportVersion, Principal } from './types';
import { fold, inPeriod, validInstant } from './query';

export function savedVersions(record: ReportRecord, data: ReportDataset): ReportVersion[] {
  return data.versions.filter(v => v.reportId === record.id && record.versionIds.includes(v.id) && validInstant(v.completedAt))
    .sort((a, b) => b.sequence - a.sequence || a.id.localeCompare(b.id));
}
export function summarizeRecord(record: ReportRecord, data: ReportDataset, query?: ReportQuery): ReportSummary {
  const versions = savedVersions(record, data);
  const latestAttempt = data.attempts.find(a => a.id === record.latestAttemptId && a.reportId === record.id) ?? null;
  let status: ReportStatus = versions.length ? 'completed' : 'draft';
  if (!versions.length && latestAttempt) {
    status = ({ queued: 'generating', running: 'generating', failed: 'failed', succeeded: 'unsupported', unknown: 'unsupported' } as const)[latestAttempt.state] ?? 'unsupported';
  }
  const matchedVersion = query?.dateField === 'completedAt'
    ? versions.filter(v => inPeriod(v.completedAt, query.from, query.to, query.timezone))[0] ?? null
    : versions[0] ?? null;
  return { record, status, latestVersion: versions[0] ?? null, matchedVersion, latestAttempt };
}
export function visibleReport(record: ReportRecord, principal: Principal): boolean {
  return principal.role === 'USER' && principal.reportIds.includes(record.id)
    && record.projectIds.every(id => principal.projectIds.includes(id));
}
export function selectReports(data: ReportDataset, principal: Principal, query: ReportQuery): ReportSummary[] {
  const matches = (selected: readonly string[], actual: readonly string[]) => !selected.length || selected.some(v => actual.includes(v));
  const reportIds = new Set(principal.reportIds); const projectIds = new Set(principal.projectIds);
  const projectNames = new Map(data.projects.map(project => [project.id, project.name]));
  return data.records.filter(record => principal.role === 'USER' && reportIds.has(record.id) && record.projectIds.every(id => projectIds.has(id))).map(record => summarizeRecord(record, data, query)).filter(row => {
    const record = row.record;
    return (!query.q || fold(`${record.code} ${record.title} ${record.projectIds.map(id => projectNames.get(id) ?? id).join(' ')} ${record.author.name}`).includes(fold(query.q)))
      && matches(query.types, [record.type]) && matches(query.statuses, [row.status])
      && matches(query.projects, record.projectIds) && matches(query.markets, record.marketIds)
      && matches(query.authors, [record.author.id]) && matches(query.agents, [record.agent])
      && (query.dateField === 'completedAt' ? row.matchedVersion !== null : inPeriod(record.createdAt, query.from, query.to, query.timezone));
  }).sort((a, b) => {
    const field = (row: ReportSummary): string | number | null => {
      if (query.sort === 'title') return fold(row.record.title);
      if (query.sort === 'status') return row.status;
      const value = query.sort === 'createdAt' ? row.record.createdAt : row.matchedVersion?.completedAt;
      return value && validInstant(value) ? Date.parse(value) : null;
    };
    const av = field(a); const bv = field(b);
    if (av === null || bv === null) return av === bv ? a.record.id.localeCompare(b.record.id) : av === null ? 1 : -1;
    const comparison = av < bv ? -1 : av > bv ? 1 : 0;
    return comparison * (query.direction === 'asc' ? 1 : -1) || a.record.id.localeCompare(b.record.id);
  });
}
