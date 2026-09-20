'use client';

import { useState } from 'react';
import { ArrowUpRight, CircleHelp, FileCheck2, Layers3 } from 'lucide-react';
import type {
  Artifact,
  ArtifactOf,
  CalculatedUnit,
  ReportPayload,
  VisualEvidencePayload,
} from '@vda/contracts';
import { ChartRenderer, ChartUnavailableView } from './chart-renderer';
import { formatChartValue, formatMetricValue } from '../lib/chart-format';

const KPI_KEYS = new Set([
  'total_inventory',
  'available_inventory',
  'available_inventory_rate',
  'inventory_change_30d',
  'median_inventory_age_days',
  'slow_moving_rate',
  'median_price_per_area',
  'missing_inventory_age_rate',
]);

const decimal = (value: string | null) => {
  if (value === null) return '—';
  const [integer, fraction] = value.split('.');
  const grouped = new Intl.NumberFormat('vi-VN').format(BigInt(integer));
  return fraction ? `${grouped},${fraction}` : grouped;
};

export function UnitTable({
  units,
  onEvidence,
}: {
  units: CalculatedUnit[];
  onEvidence: () => void;
}) {
  const [filter, setFilter] = useState('');
  const filtered = units.filter((unit) =>
    `${unit.unit_code} ${unit.zone_external_id}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="card unit-section">
      <header className="section-heading">
        <div>
          <span className="eyebrow">CHI TIẾT TỒN KHO</span>
          <h2>Dữ liệu từng sản phẩm</h2>
        </div>
        <label className="search-label">
          <span className="sr-only">Tìm mã sản phẩm</span>
          <input
            placeholder="Tìm mã sản phẩm…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Phân khu</th>
              <th>Trạng thái</th>
              <th>Diện tích (m²)</th>
              <th>Giá niêm yết</th>
              <th>Tuổi tồn (ngày)</th>
              <th>Chậm luân chuyển</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((unit) => (
              <tr key={unit.unit_external_id}>
                <td>
                  <button className="text-button" onClick={onEvidence}>
                    {unit.unit_code}
                    <ArrowUpRight size={13} />
                  </button>
                </td>
                <td>{unit.zone_external_id}</td>
                <td>
                  <span className={`status status-${unit.status}`}>{unit.status}</span>
                </td>
                <td>{decimal(unit.area_sqm)}</td>
                <td>
                  {decimal(unit.list_price)} <small>{unit.currency}</small>
                </td>
                <td>{unit.age_days ?? '—'}</td>
                <td>
                  {unit.slow_moving === null ? 'Chưa xác định' : unit.slow_moving ? 'Có' : 'Không'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p className="empty-inline">Không có sản phẩm phù hợp.</p>}
      <footer className="table-footer">
        {filtered.length} sản phẩm · Dấu — là dữ liệu thiếu, không phải 0.
      </footer>
    </section>
  );
}

function VisualEvidenceGrid({ payload }: { payload: VisualEvidencePayload }) {
  const charts = payload.charts.filter((spec) => spec.chart_type !== 'kpi');
  return (
    <>
      {!!charts.length && (
        <div className="visual-evidence-grid">
          {charts.map((spec) => (
            <ChartRenderer key={spec.chart_id} spec={spec} />
          ))}
        </div>
      )}
      {!!payload.unavailable.length && (
        <div className="visual-evidence-grid">
          {payload.unavailable.map((state) => (
            <ChartUnavailableView key={`${state.intent}:${state.reason}`} state={state} />
          ))}
        </div>
      )}
    </>
  );
}

export function AnalysisResult({
  artifacts,
  onEvidence,
  onReport,
}: {
  artifacts: Artifact[];
  onEvidence: (id: string) => void;
  onReport?: () => void;
}) {
  const calculation = artifacts.find(
    (item): item is ArtifactOf<'calculation'> => item.kind === 'calculation',
  );
  const visualEvidence = artifacts.find(
    (item): item is ArtifactOf<'visual_evidence'> => item.kind === 'visual_evidence',
  );
  const insight = artifacts.find((item): item is ArtifactOf<'insight'> => item.kind === 'insight');
  const comparison = artifacts.find(
    (item): item is ArtifactOf<'comparison'> => item.kind === 'comparison',
  );
  if (!calculation) return null;
  return (
    <div className="result-stack">
      {visualEvidence ? (
        <>
          <div className="chart-kpi-grid">
            {visualEvidence.payload.charts
              .filter((spec) => spec.chart_type === 'kpi')
              .map((spec) => (
                <ChartRenderer key={spec.chart_id} spec={spec} />
              ))}
          </div>
          <button
            className="text-button chart-evidence"
            onClick={() => onEvidence(visualEvidence.artifact_id)}
          >
            Xem bằng chứng và nguồn gốc biểu đồ <ArrowUpRight size={14} />
          </button>
        </>
      ) : (
        <p className="empty-inline">Đang chờ bằng chứng biểu đồ.</p>
      )}

      <section className="card insight-card">
        <span className="eyebrow">
          <Layers3 size={14} /> NHẬN ĐỊNH CÓ BẰNG CHỨNG
        </span>
        <h2>Điểm đáng chú ý</h2>
        {insight ? (
          <>
            <p className="insight-summary">{insight.payload.summary}</p>
            <div className="claim-list">
              {insight.payload.claims.map((claim) => (
                <button
                  className="claim"
                  key={claim.claim_id}
                  onClick={() => onEvidence(claim.evidence_artifact_id)}
                >
                  <FileCheck2 size={17} />
                  <span>{claim.text}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">Đang tạo nhận định từ kết quả đã kiểm tra.</p>
        )}
        {onReport && (
          <button className="secondary full-width" onClick={onReport}>
            Mở báo cáo <ArrowUpRight size={16} />
          </button>
        )}
      </section>

      {visualEvidence && <VisualEvidenceGrid payload={visualEvidence.payload} />}

      <UnitTable
        units={calculation.payload.units}
        onEvidence={() => onEvidence(calculation.artifact_id)}
      />

      {comparison && (
        <section className="card">
          <header className="section-heading">
            <div>
              <span className="eyebrow">COHORT EXPLICIT</span>
              <h2>So sánh nhóm tương đồng</h2>
            </div>
            <button className="text-button" onClick={() => onEvidence(comparison.artifact_id)}>
              Xem cohort và bằng chứng <ArrowUpRight size={14} />
            </button>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Số peers hợp lệ</th>
                  <th>Trung vị giá / m²</th>
                  <th>Chênh lệch (%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {comparison.payload.items.map((item) => (
                  <tr key={item.unit_external_id}>
                    <td>{item.unit_external_id}</td>
                    <td>{item.peer_count}</td>
                    <td>
                      {formatChartValue(
                        item.median_price_per_sqm === null
                          ? null
                          : Number(item.median_price_per_sqm),
                        'currency_per_area',
                        item.currency,
                      )}
                    </td>
                    <td>
                      {formatChartValue(
                        item.price_gap_pct === null ? null : Number(item.price_gap_pct),
                        'percent',
                      )}
                    </td>
                    <td>{item.abstention_reason ?? 'Đủ cohort'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-footer">
            Không mở rộng cohort khi thiếu peers. So sánh không chứng minh quan hệ nhân quả.
          </p>
        </section>
      )}

      <div className="notice">
        <CircleHelp size={18} />
        <div>
          <strong>Assumption / MVP provisional</strong>
          {calculation.limitations.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
          <p>
            Ngày dữ liệu: {calculation.data_as_of} · {calculation.semantic_version}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReportBody({
  payload,
  dataAsOf,
  visualEvidence,
  onEvidence,
}: {
  payload: ReportPayload;
  dataAsOf: string;
  visualEvidence?: VisualEvidencePayload;
  onEvidence: (id: string) => void;
}) {
  return (
    <article className="report-body">
      <span className="eyebrow">BÁO CÁO TỒN KHO · {dataAsOf}</span>
      <h1>{payload.title}</h1>
      <p className="report-summary">{payload.summary}</p>
      <span className="badge">Assumption / MVP provisional</span>
      <div className="claim-list">
        {payload.sections.map((section) => (
          <button
            className="claim"
            key={section.key}
            onClick={() => section.artifact_refs[0] && onEvidence(section.artifact_refs[0])}
          >
            <FileCheck2 size={18} />
            <span>
              {section.title} · {section.status}
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {visualEvidence ? (
        <div className="chart-kpi-grid report-metrics">
          {visualEvidence.charts
            .filter((spec) => spec.chart_type === 'kpi')
            .map((spec) => (
              <ChartRenderer key={spec.chart_id} spec={spec} />
            ))}
        </div>
      ) : (
        <div className="metrics-grid report-metrics">
          {payload.metrics
            .filter((metric) => KPI_KEYS.has(metric.key))
            .map((metric) => (
              <button
                key={metric.key}
                className="metric-card"
                onClick={() => onEvidence(payload.calculation_artifact_id)}
              >
                <span className="metric-label">
                  {metric.label}
                  <ArrowUpRight size={14} />
                </span>
                <strong>{formatMetricValue(metric)}</strong>
              </button>
            ))}
        </div>
      )}
      {visualEvidence && (
        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">VISUAL EVIDENCE</span>
              <h2>Biểu đồ đã lưu và kiểm tra</h2>
            </div>
            <button className="text-button" onClick={() => onEvidence(payload.chart_artifact_id)}>
              Xem nguồn gốc <ArrowUpRight size={14} />
            </button>
          </div>
          <VisualEvidenceGrid payload={visualEvidence} />
        </section>
      )}
      <h2>Nhận định và bằng chứng</h2>
      <div className="claim-list">
        {payload.claims.map((claim) => (
          <button
            className="claim"
            key={claim.claim_id}
            onClick={() => onEvidence(claim.evidence_artifact_id)}
          >
            <FileCheck2 size={18} />
            <span>{claim.text}</span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      <UnitTable
        units={payload.units}
        onEvidence={() => onEvidence(payload.calculation_artifact_id)}
      />
      <h2>Giới hạn sử dụng</h2>
      <ul>
        {payload.limitations.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      <p className="muted">
        Các giá trị được đọc từ artifact báo cáo đã lưu. Bản xuất sử dụng cùng dữ liệu đã được kiểm
        tra.
      </p>
    </article>
  );
}
