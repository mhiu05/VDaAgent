import type { Evidence, ReportBlock, ReportDetail, ReportStatus, ReportType, SourceMeta } from './types';

export interface ReportKpi {
  id: string;
  sectionId: string;
  label: string;
  value: number | null;
  unit: string;
  definition?: string;
}
export type ReportSummaryChart = Extract<ReportBlock, { kind: 'chart' }>;
export type ReportSummaryFinding = Extract<ReportBlock, { kind: 'finding' | 'recommendation' }>;
/** A view of one persisted version, derived without a live dashboard dependency. */
export interface ReportVersionSummary {
  reportId: string;
  versionId: string;
  sequence: number;
  title: string;
  type: ReportType;
  status: ReportStatus;
  scope: { projectIds: readonly string[]; marketIds: readonly string[] };
  completedAt: string;
  dataCutoff: string;
  source: SourceMeta;
  policyVersion: string;
  contentRevision: string;
  overview: readonly string[];
  kpis: readonly ReportKpi[];
  charts: readonly ReportSummaryChart[];
  findings: readonly ReportSummaryFinding[];
  recommendations: readonly ReportSummaryFinding[];
  limitations: readonly string[];
  evidence: readonly Evidence[];
  artifacts: ReportDetail['artifacts'];
}

/** Never falls back to latestVersion: every collection belongs to detail.version. */
export function deriveReportVersionSummary(detail: ReportDetail): ReportVersionSummary | null {
  const version = detail.version;
  if (!version) return null;
  const record = detail.summary.record;
  if (version.reportId !== record.id) throw new Error('Report version does not belong to this report.');
  const kpis: ReportKpi[] = [];
  const charts: ReportSummaryChart[] = [];
  const findings: ReportSummaryFinding[] = [];
  const recommendations: ReportSummaryFinding[] = [];
  const overview: string[] = [];
  const limitations: string[] = [];
  for (const section of version.sections) {
    if (section.kind === 'metric-table') {
      section.rows.forEach((row, index) => {
        const value = row[1];
        // Preserve missing values and skip unsupported table shapes instead of coercing strings.
        if (typeof row[0] !== 'string' || !(value === null || typeof value === 'number')) return;
        kpis.push({ id: `${section.id}-${index}`, sectionId: section.id, label: row[0],
          value: value !== null && Number.isFinite(value) ? value : null, unit: section.unit,
          ...(typeof row[2] === 'string' ? { definition: row[2] } : {}) });
      });
    } else if (section.kind === 'chart') {
      charts.push({ ...section, labels: [...section.labels], values: section.values.map(value => value !== null && Number.isFinite(value) ? value : null) });
    } else if (section.kind === 'finding') {
      findings.push({ ...section, evidenceIds: [...section.evidenceIds] });
    } else if (section.kind === 'recommendation') {
      recommendations.push({ ...section, evidenceIds: [...section.evidenceIds] });
    } else if (section.kind === 'text' && overview.length === 0) {
      overview.push(...section.paragraphs);
    } else if (section.kind === 'limitations') {
      limitations.push(...section.paragraphs);
    }
  }
  return {
    reportId: record.id, versionId: version.id, sequence: version.sequence,
    title: record.title, type: record.type, status: detail.summary.status,
    scope: { projectIds: [...record.projectIds], marketIds: [...record.marketIds] },
    completedAt: version.completedAt, dataCutoff: version.source.dataThrough,
    source: { ...version.source }, policyVersion: version.policyVersion, contentRevision: version.contentRevision,
    overview, kpis, charts, findings, recommendations, limitations,
    evidence: detail.evidence.filter(item => version.evidenceIds.includes(item.id)).map(item => ({ ...item, projectIds: [...item.projectIds] })),
    artifacts: detail.artifacts.filter(item => item.versionId === version.id && version.artifactIds.includes(item.id)).map(item => ({ ...item })),
  };
}
