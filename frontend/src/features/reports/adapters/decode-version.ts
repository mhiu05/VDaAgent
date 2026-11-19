import { RepositoryError, type ReportBlock, type ReportVersion, type SourceMeta } from '../model/types';
import { validInstant } from '../model/query';
import { decodeReportSchema } from './decode-schema';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('validation', 'Expected a report object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new RepositoryError('validation', 'Missing report text');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new RepositoryError('validation', 'Missing report collection');
  return value;
}
function strings(value: unknown): string[] { return list(value).map(text); }
function instant(value: unknown): string {
  const raw = text(value);
  if (!validInstant(raw)) throw new RepositoryError('validation', 'Invalid report timestamp');
  return new Date(raw).toISOString();
}
function numeric(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RepositoryError('validation', 'Invalid report number');
  return value;
}
function source(value: unknown): SourceMeta {
  const item = object(value);
  if (item.mode !== 'mock' && item.mode !== 'api') throw new RepositoryError('validation', 'Unknown report source mode');
  if (item.completeness !== 'full' && item.completeness !== 'partial' && item.completeness !== 'missing') throw new RepositoryError('validation', 'Unknown source completeness');
  return { id: text(item.id), label: text(item.label), mode: item.mode, completeness: item.completeness,
    dataThrough: instant(item.dataThrough), updatedAt: instant(item.updatedAt) };
}
function section(value: unknown): ReportBlock {
  const item = object(value);
  const base = { id: text(item.id), title: text(item.title) };
  const kind = item.kind;
  if (kind === 'text' || kind === 'methodology' || kind === 'limitations') return { ...base, kind, paragraphs: strings(item.paragraphs) };
  if (kind === 'finding' || kind === 'recommendation') return { ...base, kind, text: text(item.text), evidenceIds: strings(item.evidenceIds) };
  if (kind === 'metric-table' || kind === 'comparison') {
    const columns = strings(item.columns);
    const rows = list(item.rows).map(value => list(value).map(cell => typeof cell === 'string' ? cell : numeric(cell)));
    if (rows.some(row => row.length !== columns.length)) throw new RepositoryError('validation', 'Report table columns do not match');
    return { ...base, kind, columns, rows, unit: text(item.unit) };
  }
  if (kind === 'chart') {
    const labels = strings(item.labels); const values = list(item.values).map(numeric);
    if (labels.length !== values.length) throw new RepositoryError('validation', 'Report chart labels do not match');
    if (item.chartType !== undefined && item.chartType !== 'bar' && item.chartType !== 'line' && item.chartType !== 'area') throw new RepositoryError('validation', 'Unsupported report chart type');
    return { ...base, kind, labels, values, question: text(item.question), unit: text(item.unit), sourceId: text(item.sourceId),
      ...(item.chartType ? { chartType: item.chartType } : {}) };
  }
  throw new RepositoryError('validation', 'Unsupported report block kind');
}

/** Validate the domain payload after a real adapter maps its agreed DTO; no backend DTO is assumed. */
export function decodeReportVersion(value: unknown, expected: { reportId: string; versionId?: string }): ReportVersion {
  const item = object(value);
  const id = text(item.id); const reportId = text(item.reportId);
  if (reportId !== expected.reportId || (expected.versionId && id !== expected.versionId)) throw new RepositoryError('validation', 'Report version identity mismatch');
  if (typeof item.sequence !== 'number' || !Number.isSafeInteger(item.sequence) || item.sequence < 1) throw new RepositoryError('validation', 'Invalid report version sequence');
  const sections = list(item.sections).map(section); const evidenceIds = strings(item.evidenceIds);
  if (new Set(sections.map(item => item.id)).size !== sections.length) throw new RepositoryError('validation', 'Duplicate report section identity');
  if (sections.some(item => 'evidenceIds' in item && item.evidenceIds.some(id => !evidenceIds.includes(id)))) throw new RepositoryError('validation', 'Evidence reference outside report version');
  const completedAt = instant(item.completedAt); const provenance = source(item.source);
  if (Date.parse(provenance.dataThrough) > Date.parse(completedAt) || Date.parse(provenance.updatedAt) > Date.parse(completedAt)) throw new RepositoryError('validation', 'Report source is newer than saved version');
  let schema: ReportVersion['schema'];
  let schemaIssue: string | undefined;
  if (item.schema !== undefined) {
    const raw = object(item.schema);
    if (raw.schemaVersion !== 1) schemaIssue = 'Unsupported report schema version';
    else schema = decodeReportSchema(raw, { reportId, versionId: id, evidenceIds });
  }
  return { id, reportId, sequence: item.sequence, completedAt, source: provenance,
    ...(schema ? { schema } : {}), ...(schemaIssue ? { schemaIssue } : {}),
    policyVersion: text(item.policyVersion), contentRevision: text(item.contentRevision), sections,
    evidenceIds, artifactIds: strings(item.artifactIds) };
}
