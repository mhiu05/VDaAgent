import { RepositoryError } from '../../features/reports/model/types';
import type { MockReadOptions, ReportDataset, ReportQuery, ReportsRepository, ReportScope } from '../../features/reports/model/types';
import { defaultReportQuery, inPeriod, paginate, validateRange } from '../../features/reports/model/query';
import { savedVersions, selectReports, summarizeRecord, visibleReport } from '../../features/reports/model/lifecycle';
import { mockRead } from './runtime';
import { decodeReportVersion } from '../../features/reports/adapters/decode-version';

export function createReportsRepository(seed: ReportDataset, options: MockReadOptions): ReportsRepository {
  const data = structuredClone(seed);
  for (const rows of [data.records, data.versions, data.attempts, data.evidence, data.artifacts]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new RepositoryError('validation', 'Duplicate canonical report ID');
  }
  const principal = structuredClone(options.principal);
  const authorize = () => {
    if (principal.role !== 'USER') throw new RepositoryError('forbidden', 'Reports require USER');
    if (data.source.completeness === 'missing') throw new RepositoryError('unavailable', 'Report source is missing');
  };
  const scopeQuery = (scope: ReportScope): ReportQuery => ({ ...defaultReportQuery(), ...scope,
    projects: scope.project ? [scope.project] : [], markets: scope.market ? [scope.market] : [],
    statuses: ['completed'], dateField: 'completedAt', sort: 'completedAt', direction: 'desc',
  });
  const select = (query: ReportQuery) => { validateRange(query.from, query.to, query.timezone); return selectReports(data, principal, query); };
  const findRecord = (id: string) => {
    const record = data.records.find(r => r.id === id);
    if (!record || !visibleReport(record, principal)) throw new RepositoryError('notFound', 'Report unavailable in this scope');
    return record;
  };
  return {
    async list(query, signal) {
      authorize(); await mockRead(options, 'reports.list', signal);
      return structuredClone(paginate(select(query), query.page, query.pageSize));
    },
    async summarize(scope, signal) {
      authorize(); await mockRead(options, 'reports.summarize', signal);
      const rows = select(scopeQuery(scope));
      return { distinctReports: rows.length,
        completedVersions: rows.reduce((sum, row) => sum + savedVersions(row.record, data).filter(v => inPeriod(v.completedAt, scope.from, scope.to, scope.timezone)).length, 0), source: structuredClone(data.source) };
    },
    async readRecent(scope, limit, signal) {
      authorize(); await mockRead(options, 'reports.recent', signal);
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) throw new RepositoryError('validation', 'Invalid recent limit');
      return structuredClone(select(scopeQuery(scope)).slice(0, limit));
    },
    async readDetail(id, versionId, signal) {
      authorize(); await mockRead(options, 'reports.detail', signal);
      const record = findRecord(id); const versions = savedVersions(record, data);
      const saved = versionId ? versions.find(v => v.id === versionId) : versions[0];
      const version = saved?.schema ? decodeReportVersion(saved, { reportId: record.id, versionId: saved.id }) : saved;
      if (version?.schema && version.schema.reportTypeId !== record.type) throw new RepositoryError('validation', 'Report type identity mismatch');
      if (versionId && !version) throw new RepositoryError('notFound', 'Version does not belong to this report');
      return structuredClone({ summary: summarizeRecord(record, data), version: version ?? null, versions,
        evidence: data.evidence.filter(e => version?.evidenceIds.includes(e.id)),
        artifacts: data.artifacts.filter(a => a.versionId === version?.id && version.artifactIds.includes(a.id)).map(a => ({ id: a.id, versionId: a.versionId, filename: a.filename, mediaType: a.mediaType })),
      });
    },
    async resolveDownload(id, versionId, artifactId, signal) {
      authorize(); await mockRead(options, 'reports.download', signal);
      const record = findRecord(id);
      const version = savedVersions(record, data).find(v => v.id === versionId);
      const artifact = data.artifacts.find(a => a.id === artifactId && a.versionId === versionId && version?.artifactIds.includes(a.id));
      if (!artifact) throw new RepositoryError('notFound', 'Artifact unavailable for the selected version');
      return { ...structuredClone(artifact), sizeBytes: new TextEncoder().encode(artifact.content).byteLength, sourceMode: 'mock' };
    },
    async delete(id, signal) {
      authorize(); await mockRead(options, 'reports.delete', signal);
      const record = findRecord(id);
      if (savedVersions(record, data).length > 0) throw new RepositoryError('conflict', 'Report has a published version');
      data.records = data.records.filter(r => r.id !== id);
      data.attempts = data.attempts.filter(a => a.reportId !== id);
    },
  };
}
