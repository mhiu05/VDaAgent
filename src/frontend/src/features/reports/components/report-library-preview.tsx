'use client';

import { useEffect, useState } from 'react';
import type { ArtifactOf, ReportRecord } from '@vda/contracts';
import { ArrowRight, CircleAlert, FileText } from 'lucide-react';
import { ChartRenderer } from '../../../components/visualization/chart-renderer';
import { getRunArtifacts } from '../../analysis/api/run-data';
import { formatMetricValue } from '../../../lib/chart-format';
import {
  localizeLegacyLimitation,
  localizeLegacyMetricStatement,
  localizedMetricLabel,
} from '../../../lib/format/analysis-copy';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { dateTime } from '../../../lib/format/date-time';
import { getReportDetail } from '../api/reports';

type Preview = {
  artifact: ArtifactOf<'report'>;
  chart: ReturnType<typeof chartFromArtifacts>;
};

function chartFromArtifacts(artifacts: Awaited<ReturnType<typeof getRunArtifacts>>['artifacts'], chartArtifactId: string) {
  const visual = artifacts.find(
    (item): item is ArtifactOf<'visual_evidence'> =>
      item.artifact_id === chartArtifactId && item.kind === 'visual_evidence',
  );
  return visual?.payload.charts.find((chart) => chart.chart_type !== 'kpi') ?? null;
}

export function ReportLibraryPreview({
  orgId,
  report,
  onOpen,
}: {
  orgId: string;
  report: ReportRecord;
  onOpen: (id: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setUnavailable(false);
    void (async () => {
      try {
        const detail = await getReportDetail(orgId, report.report_id);
        if (detail.artifact.kind !== 'report') throw new Error('Report artifact is unavailable.');
        const artifacts = await getRunArtifacts(orgId, detail.report.run_id);
        if (!current) return;
        setPreview({
          artifact: detail.artifact,
          chart: chartFromArtifacts(artifacts.artifacts, detail.artifact.payload.chart_artifact_id),
        });
      } catch {
        if (current) setUnavailable(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [orgId, report.report_id]);

  const payload = preview?.artifact.payload;
  const brief = payload?.decision_brief;
  const metrics = payload?.metrics.slice(0, 4) ?? [];
  const metricLabels = new Map<string, string>(
    payload?.metrics.map((metric) => [metric.key, localizedMetricLabel(metric.key, metric.label)]) ?? [],
  );
  const metricUnits = new Map<string, string>(payload?.metrics.map((metric) => [metric.key, metric.unit]) ?? []);

  return (
    <section className="report-library-preview" aria-labelledby="latest-report-preview-title">
      <header className="report-library-preview-heading">
        <div>
          <span className="eyebrow">BẢN XEM TRƯỚC DASHBOARD · BÁO CÁO MỚI NHẤT</span>
          <h3 id="latest-report-preview-title">
            {payload?.title ?? `Báo cáo tồn kho · ${dateTime(report.created_at)}`}
          </h3>
          {brief && (
            <p>
              {brief.scope.project_external_id} / {brief.scope.zone_external_id ?? 'Toàn dự án'}
              {' · Ngày dữ liệu '}{brief.requested_data_as_of}
            </p>
          )}
        </div>
        <button className="secondary" type="button" onClick={() => onOpen(report.report_id)}>
          <FileText size={15} /> Mở báo cáo <ArrowRight size={14} />
        </button>
      </header>
      {!preview && !unavailable && (
        <p className="muted" role="status">Đang tải phần xem trước…</p>
      )}
      {unavailable && (
        <p className="report-preview-unavailable" role="status">
          <CircleAlert size={16} /> Chưa tải được phần xem trước. Bạn vẫn có thể mở báo cáo để xem nội dung đã lưu.
        </p>
      )}
      {payload && (
        <>
          <p className="report-preview-summary">{payload.summary}</p>
          {metrics.length > 0 ? (
            <dl className="report-preview-kpis">
              {metrics.map((metric) => (
                <div key={metric.metric_id}>
                  <dt>{localizedMetricLabel(metric.key, metric.label)}</dt>
                  <dd>{formatMetricValue(metric)}</dd>
                  {metric.value === null && metric.abstention_reason && (
                    <small>{workflowStatusLabel(metric.abstention_reason)}</small>
                  )}
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Báo cáo chưa có chỉ số để xem trước.</p>
          )}
          {preview.chart && <ChartRenderer spec={preview.chart} />}
          {!!payload.claims.length && (
          <section
            className="report-preview-findings"
            aria-label="Nhận định trong báo cáo mới nhất"
          >
              <strong>Nhận định có bằng chứng</strong>
              <ul>
                {payload.claims.slice(0, 2).map((claim) => (
                  <li key={claim.claim_id}>
                    {localizeLegacyMetricStatement(
                      claim.text,
                      claim.metric_key,
                      metricLabels,
                      metricUnits,
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!payload.limitations.length && (
            <p className="report-preview-limitations">
              Giới hạn dữ liệu: {payload.limitations.slice(0, 2).map(localizeLegacyLimitation).join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
