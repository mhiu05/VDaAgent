import { describe, expect, it } from 'vitest';
import { createReportFixtures, demoClock, demoUser } from '../../../mocks/reports/fixtures';
import { createReportPresentationFixtures, type ReportPresentationScenario } from '../../../mocks/reports/presentation-fixtures';
import { createReportsRepository } from '../../../mocks/reports/repository';
import { createReportsScenario } from '../../../mocks/reports/scenarios';
import { validateReports } from '../../../mocks/reports/validate';
import { decodeReportVersion } from '../adapters/decode-version';
import { deriveReportVersionSummary } from '../model/version-summary';

const options = { principal: demoUser, clock: demoClock };
describe('version summary contract', () => {
  it('derives all report types exclusively from the selected persisted version', async () => {
    const repo = createReportsRepository(createReportFixtures(), options);
    for (const id of ['R001', 'R004', 'R007']) {
      const detail = await repo.readDetail(id, `${id}-v1`);
      const summary = deriveReportVersionSummary(detail)!;
      expect(summary.versionId).toBe(`${id}-v1`);
      expect(summary.source).toEqual(detail.version!.source);
      expect(summary.dataCutoff).toBe(detail.version!.source.dataThrough);
      expect(summary.kpis[0].value).toBe(id === 'R004' ? 24 : 60);
      expect(summary.charts[0].chartType).toBe(id === 'R004' ? 'line' : undefined);
      expect(summary.findings).toHaveLength(1);
      expect(summary.recommendations).toHaveLength(1);
      expect(summary.artifacts.every(item => item.versionId === `${id}-v1`)).toBe(true);
      if (id === 'R001') expect(detail.summary.latestVersion!.id).toBe('R001-v2');
      expect(decodeReportVersion(detail.version, { reportId: id, versionId: `${id}-v1` })).toEqual({ ...detail.version, source: {
        ...detail.version!.source, dataThrough: new Date(detail.version!.source.dataThrough).toISOString(), updatedAt: new Date(detail.version!.source.updatedAt).toISOString() } });
    }
  });
  it.each<ReportPresentationScenario>(['report-no-chart', 'report-no-kpi', 'report-multiple-charts', 'report-partial'])('keeps %s deterministic and consistent with document and artifact', async scenario => {
    const seed = createReportPresentationFixtures(scenario);
    expect(seed).toEqual(createReportPresentationFixtures(scenario));
    expect(validateReports(seed, ['P-A', 'P-B', 'P-C'], ['source-inventory', 'source-transactions'])).toEqual([]);
    const detail = await createReportsRepository(seed, options).readDetail('R001', 'R001-v2');
    const before = structuredClone(detail);
    const summary = deriveReportVersionSummary(detail)!;
    expect(detail).toEqual(before);
    expect(decodeReportVersion(detail.version, { reportId: 'R001', versionId: 'R001-v2' })).toEqual({ ...detail.version, source: {
      ...detail.version!.source, dataThrough: new Date(detail.version!.source.dataThrough).toISOString(), updatedAt: new Date(detail.version!.source.updatedAt).toISOString() } });
    if (scenario === 'report-no-chart') expect(summary.charts).toHaveLength(0);
    if (scenario === 'report-no-kpi') expect(summary.kpis).toHaveLength(0);
    if (scenario === 'report-multiple-charts') expect(summary.charts).toHaveLength(2);
    if (scenario === 'report-partial') {
      expect(summary.source.completeness).toBe('partial');
      expect(summary.charts[0].values.at(-1)).toBeNull();
      expect(summary.kpis.at(-1)!.value).toBeNull();
      expect(summary.overview.join(' ')).toContain('60 căn khả dụng, 56 căn có ngày mở bán hợp lệ và 20 căn');
      expect(summary.findings[0].text).toContain('20/56');
      expect(summary.evidence[0].limitation).toContain('chưa cung cấp số căn chưa rõ tuổi');
    }
    const html = seed.artifacts.find(item => item.versionId === summary.versionId && item.mediaType === 'text/html')!;
    for (const chart of summary.charts) expect(html.content).toContain(chart.id);
    const document = new DOMParser().parseFromString(html.content, 'text/html');
    const metricRows = document.querySelectorAll('#metrics tbody tr');
    expect(metricRows.length).toBe(scenario === 'report-no-kpi' ? 0 : 4);
    if (scenario === 'report-partial') expect(metricRows[3].querySelectorAll('td')[1].textContent).toBe('Chưa đủ dữ liệu');
    const csv = seed.artifacts.find(item => item.versionId === summary.versionId && item.mediaType === 'text/csv')!;
    expect(csv.content).toContain('Ton kha dung,60\r\nDu ngay mo ban,56\r\nTuoi tu 180 ngay,20');
    expect(seed.versions.find(item => item.id === 'R001-v1')).toEqual(createReportFixtures().versions.find(item => item.id === 'R001-v1'));
  });
  it('preserves an older saved snapshot after generation fails and never invents a draft snapshot', async () => {
    const repo = createReportsRepository(createReportsScenario('S08'), options);
    const saved = await repo.readDetail('R001');
    expect(saved.summary.latestAttempt!.state).toBe('failed');
    expect(deriveReportVersionSummary(saved)!.versionId).toBe('R001-v2');
    expect(deriveReportVersionSummary(await repo.readDetail('R017'))).toBeNull();
    await expect(repo.readDetail('R001', 'R002-v1')).rejects.toMatchObject({ code: 'notFound' });
  });
  it('does not expose other version artifacts or evidence and does not mutate snapshots', async () => {
    const detail = await createReportsRepository(createReportFixtures(), options).readDetail('R001', 'R001-v1');
    const latest = await createReportsRepository(createReportFixtures(), options).readDetail('R001', 'R001-v2');
    detail.artifacts.push(...latest.artifacts); detail.evidence.push(...latest.evidence);
    const summary = deriveReportVersionSummary(detail)!;
    expect(summary.artifacts).toHaveLength(2); expect(summary.evidence).toHaveLength(1);
    (summary.charts[0].values as (number | null)[])[0] = 999;
    expect(detail.version!.sections.find(item => item.kind === 'chart')!.values[0]).toBe(24);
    detail.version!.reportId = 'another-report';
    expect(() => deriveReportVersionSummary(detail)).toThrow(/does not belong/);
  });
});
