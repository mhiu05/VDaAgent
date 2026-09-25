import type { Artifact, ArtifactValidation, RunTask } from '@vda/contracts';
import { ChartRenderer, ChartUnavailableView } from '../../../components/visualization/chart-renderer';
import { formatMetricValue } from '../../../lib/chart-format';
import { validatedPreviews } from '../models/artifact-preview';
import styles from './inline-run-output.module.css';

type EvidenceOpen = (artifactId: string, path: string | null) => void;
const value = (item: string | number | null) => item === null ? '—' : String(item);

export function InlineRunOutput({ orgId, runId, tasks, artifacts, validations, onEvidence }: {
  orgId: string;
  runId: string;
  tasks: RunTask[];
  artifacts: Artifact[];
  validations: ArtifactValidation[];
  onEvidence: EvidenceOpen;
}) {
  const previews = validatedPreviews(orgId, runId, tasks, artifacts, validations);
  const chartIds = new Set<string>();
  if (!previews.length) return null;
  return <section className={styles.output} aria-label="Kết quả đã xác thực của lượt chạy" data-run-id={runId}>
    <h2>Kết quả lượt chạy</h2>
    {previews.map((artifact) => {
      const evidence = (path: string | null = null) => onEvidence(artifact.artifact_id, path);
      if (artifact.kind === 'data_analysis_pack') return <article key={artifact.artifact_id} className={styles.block} data-stage-output="data">
        <header><h3>Dữ liệu đã phân tích</h3><button type="button" onClick={() => evidence()}>Xem bằng chứng</button></header>
        <p>{artifact.payload.dataset.row_count.toLocaleString('vi-VN')} dòng trong lượt phân tích</p>
        <dl className={styles.metrics}>{artifact.payload.metrics.slice(0, 4).map((metric, index) => <div key={metric.metric_id}>
          <dt>{metric.label}</dt><dd>{formatMetricValue(metric)}</dd>
          {metric.value === null && <small>{metric.abstention_reason ?? 'Không khả dụng'}</small>}
          {artifact.payload.evidence_refs.find((ref) => ref.path === `payload.metrics[${index}].value`) &&
            <button type="button" onClick={() => {
              const ref = artifact.payload.evidence_refs.find((item) => item.path === `payload.metrics[${index}].value`)!;
              onEvidence(ref.artifact_id, ref.path);
            }}>Bằng chứng</button>}
        </div>)}</dl>
        {artifact.payload.quality_limitations.length > 0 && <ul>{artifact.payload.quality_limitations.slice(0, 3).map((text) => <li key={text}>{text}</li>)}</ul>}
      </article>;
      if (artifact.kind === 'comparison_pack') return <article key={artifact.artifact_id} className={styles.block} data-stage-output="comparison">
        <header><h3>So sánh kỳ</h3><button type="button" onClick={() => evidence()}>Xem bằng chứng</button></header>
        <div className={styles.comparisons}>{artifact.payload.period_comparisons.slice(0, 3).map((item, index) => <dl key={`${item.metric_key}:${item.period_days}:${index}`}>
          <dt>{item.metric_key.replaceAll('_', ' ')} · {item.period_days} ngày</dt>
          <dd>Ngày yêu cầu hiện tại: {item.current_as_of}</dd>
          <dd>Snapshot hiện tại: {item.current_snapshot_date ?? 'Không khả dụng'}</dd>
          <dd>Ngày mốc so sánh: {item.comparison_target_date}</dd>
          <dd>Snapshot mốc: {item.comparison_snapshot_date ?? 'Không khả dụng'}</dd>
          <dd>Hiện tại: {value(item.current_value)} {item.current_currency ?? ''}</dd>
          <dd>Mốc so sánh: {value(item.comparison_value)} {item.comparison_currency ?? ''}</dd>
          <dd>Chênh lệch tuyệt đối: {value(item.absolute_delta)}</dd>
          <dd>Thay đổi tương đối: {item.relative_delta_pct === null ? '—' : `${item.relative_delta_pct}%`}</dd>
          {item.percentage_point_delta !== null && <dd>Chênh lệch điểm phần trăm: {item.percentage_point_delta} điểm %</dd>}
          {(item.relative_delta_abstention_reason || item.abstention_reason) && <dd>{item.relative_delta_abstention_reason ?? item.abstention_reason}</dd>}
          <dd><button type="button" onClick={() => evidence(`payload.period_comparisons[${index}]`)}>Bằng chứng kỳ so sánh</button></dd>
        </dl>)}</div>
      </article>;
      if (artifact.kind === 'analysis_pack') return <article key={artifact.artifact_id} className={styles.block} data-stage-output="analyst">
        <header><h3>Phân tích có bằng chứng</h3><button type="button" onClick={() => evidence()}>Xem hiện vật</button></header>
        <ol>{artifact.payload.findings.slice(0, 3).map((finding) => <li key={finding.finding_id}>
          <p>{finding.statement}</p><small>Mức hỗ trợ: {finding.support_level}</small>
          {finding.limitations.map((text) => <small key={text}>{text}</small>)}
          {finding.evidence_refs[0] && <button type="button" onClick={() => onEvidence(finding.evidence_refs[0]!.artifact_id, finding.evidence_refs[0]!.path)}>Bằng chứng</button>}
        </li>)}</ol>
      </article>;
      if (artifact.kind === 'insight_pack') return <article key={artifact.artifact_id} className={styles.block} data-stage-output="insight">
        <header><h3>Nhận định</h3><button type="button" onClick={() => evidence()}>Xem hiện vật</button></header>
        <p>{artifact.payload.summary}</p>
        <ol>{artifact.payload.claims.slice(0, 3).map((claim) => <li key={claim.claim_id}>
          {claim.text} <button type="button" onClick={() => onEvidence(claim.evidence_artifact_id, claim.evidence_path)}>Bằng chứng</button>
        </li>)}</ol>
      </article>;
      if (artifact.kind === 'chart_pack' || artifact.kind === 'visual_evidence') {
        const charts = artifact.payload.charts.filter((chart) => !chartIds.has(chart.chart_id)).slice(0, 2);
        for (const chart of charts) chartIds.add(chart.chart_id);
        if (!charts.length && !artifact.payload.unavailable.length) return null;
        return <article key={artifact.artifact_id} className={styles.block} data-stage-output="chart">
          <header><h3>Biểu đồ</h3><button type="button" onClick={() => evidence()}>Xem bằng chứng</button></header>
          <div className={styles.charts}>{charts.map((chart) => <ChartRenderer key={chart.chart_id} spec={chart} />)}</div>
          {artifact.payload.unavailable.slice(0, 2).map((state) => <ChartUnavailableView key={`${state.intent}:${state.reason}`} state={state} />)}
        </article>;
      }
      return null;
    })}
  </section>;
}
