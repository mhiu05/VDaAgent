import type { ReportBlock, ReportDataset } from '../../features/reports/model/types';
import { createReportFixtures, renderDemoHtml } from './fixtures';

export type ReportPresentationScenario = 'report-no-chart' | 'report-no-kpi' | 'report-multiple-charts' | 'report-partial';

/** Deterministic saved-document variants used by both the viewer and its downloads. */
export function createReportPresentationFixtures(scenario: ReportPresentationScenario): ReportDataset {
  const data = createReportFixtures();
  const version = data.versions.find(item => item.id === 'R001-v2')!;
  version.contentRevision = `demo-${version.id}-${scenario}`;
  if (scenario === 'report-no-chart') version.sections = version.sections.filter(item => item.kind !== 'chart');
  if (scenario === 'report-no-kpi') version.sections = version.sections.filter(item => item.kind !== 'metric-table');
  if (scenario === 'report-multiple-charts') {
    const chart = version.sections.find(item => item.kind === 'chart')!;
    const comparison = version.sections.find(item => item.kind === 'comparison');
    if (comparison && 'rows' in comparison) {
      const row = comparison.rows[0];
      const extra: ReportBlock = { id: 'snapshot-comparison-chart', kind: 'chart', chartType: 'bar',
        title: String(row[0]), question: comparison.title, unit: 'căn',
        labels: comparison.columns.slice(1), values: row.slice(1).map(value => typeof value === 'number' ? value : null),
        sourceId: chart.sourceId };
      version.sections = [...version.sections, extra];
    }
  }
  if (scenario === 'report-partial') {
    const limitation = 'Nguồn mô phỏng chưa cung cấp số căn chưa rõ tuổi. Giá trị thiếu được giữ là null, không được xem là 0.';
    version.source = { ...version.source, completeness: 'partial' };
    version.sections = version.sections.map(section => {
      if (section.kind === 'chart') return { ...section, values: section.values.map((value, i) => i === section.values.length - 1 ? null : value) };
      if (section.kind === 'metric-table') return { ...section, rows: section.rows.map((row, i) => i === section.rows.length - 1 ? [row[0], null, ...row.slice(2)] : row) };
      if (section.kind === 'limitations') return { ...section, paragraphs: [...section.paragraphs, limitation] };
      return section;
    });
    data.evidence = data.evidence.map(item => version.evidenceIds.includes(item.id) ? { ...item, limitation: `${item.limitation} ${limitation}` } : item);
  }
  data.artifacts = data.artifacts.map(artifact => artifact.versionId === version.id && artifact.mediaType === 'text/html'
    ? { ...artifact, content: renderDemoHtml(data.records.find(item => item.id === version.reportId)!, version, data.evidence.filter(item => version.evidenceIds.includes(item.id))) }
    : artifact);
  return data;
}
