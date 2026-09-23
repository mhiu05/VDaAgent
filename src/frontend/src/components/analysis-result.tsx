'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, CircleHelp, FileCheck2, Layers3 } from 'lucide-react';
import type {
  Artifact,
  ArtifactOf,
  CalculatedUnit,
  DecisionBrief,
  DecisionBriefResponse,
  DecisionIntelligenceResponse,
  DecisionSignal,
  ReportPayload,
  VisualEvidencePayload,
} from '@vda/contracts';
import { ChartRenderer, ChartUnavailableView } from './chart-renderer';
import { formatChartValue } from '../lib/chart-format';
import { DecisionIntelligenceView } from './decision-intelligence';
import { ReportDashboard } from './report-dashboard';

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

export type BriefLoadState = 'idle' | 'loading' | 'available' | 'unavailable';

function SignalGroup({
  title,
  empty,
  signals,
  onEvidence,
  onInspectSignal,
  onAnalyzeSegment,
  canInspect,
}: {
  title: string;
  empty: string;
  signals: DecisionSignal[];
  onEvidence: (id: string) => void;
  onInspectSignal?: (signalId: string) => void;
  onAnalyzeSegment?: (signalId: string) => void;
  canInspect?: boolean;
}) {
  return (
    <section className="brief-section">
      <h3>{title}</h3>
      {signals.length ? (
        <div className="brief-signal-list">
          {signals.map((signal) => (
            <article
              className={`brief-signal brief-signal-${signal.status}`}
              key={signal.signal_id}
            >
              <span>
                <strong>{signal.label}</strong>
                <small>{signal.summary}</small>
                {signal.limitations.map((limitation) => (
                  <small className="brief-limitation" key={limitation}>
                    {limitation}
                  </small>
                ))}
                <span className="brief-signal-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => signal.evidence[0] && onEvidence(signal.evidence[0].artifact_id)}
                  >
                    Evidence <ArrowUpRight size={13} />
                  </button>
                  {onInspectSignal && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={!canInspect}
                      onClick={() => onInspectSignal(signal.signal_id)}
                    >
                      Inspect
                    </button>
                  )}
                  {onAnalyzeSegment && signal.dimension === 'zone' && signal.segment_key && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={!canInspect}
                      onClick={() => onAnalyzeSegment(signal.signal_id)}
                    >
                      Analyze this zone
                    </button>
                  )}
                </span>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}

export function DecisionBriefView({
  brief,
  onEvidence,
  onLoadDetails,
  onInspectSignal,
  onAnalyzeSegment,
  canInspect,
}: {
  brief: DecisionBrief;
  onEvidence: (id: string) => void;
  onLoadDetails?: () => void;
  onInspectSignal?: (signalId: string) => void;
  onAnalyzeSegment?: (signalId: string) => void;
  canInspect?: boolean;
}) {
  return (
    <section className="card decision-brief" aria-labelledby="decision-brief-title">
      <header className="section-heading">
        <div>
          <span className="eyebrow">DECISION BRIEF · {brief.version}</span>
          <h2 id="decision-brief-title">Decision briefing</h2>
        </div>
        <span className="badge">Validated</span>
      </header>
      <dl className="brief-scope">
        <div>
          <dt>Scope</dt>
          <dd>
            {brief.scope.project_external_id} / {brief.scope.zone_external_id ?? 'Project'}
          </dd>
        </div>
        <div>
          <dt>Requested date</dt>
          <dd>{brief.requested_data_as_of}</dd>
        </div>
        <div>
          <dt>Effective snapshot</dt>
          <dd>{brief.effective_snapshot_date ?? 'Unavailable'}</dd>
        </div>
      </dl>
      <div className="brief-flow" aria-label="Decision sequence">
        <SignalGroup
          title="Current state"
          empty="Current state is unavailable."
          signals={brief.current_state}
          onEvidence={onEvidence}
          onInspectSignal={onInspectSignal}
          onAnalyzeSegment={onAnalyzeSegment}
          canInspect={canInspect}
        />
        <ArrowRight className="brief-arrow" aria-hidden="true" />
        <SignalGroup
          title="Material change"
          empty="No existing materiality rule was crossed."
          signals={brief.material_changes}
          onEvidence={onEvidence}
          onInspectSignal={onInspectSignal}
          onAnalyzeSegment={onAnalyzeSegment}
          canInspect={canInspect}
        />
        <ArrowRight className="brief-arrow" aria-hidden="true" />
        <SignalGroup
          title="Where to look"
          empty="No supported segment concentration is available."
          signals={brief.where_to_look}
          onEvidence={onEvidence}
          onInspectSignal={onInspectSignal}
          onAnalyzeSegment={onAnalyzeSegment}
          canInspect={canInspect}
        />
        <ArrowRight className="brief-arrow" aria-hidden="true" />
        <SignalGroup
          title="Data quality"
          empty="Data-quality metrics are unavailable."
          signals={brief.data_quality}
          onEvidence={onEvidence}
          onInspectSignal={onInspectSignal}
          onAnalyzeSegment={onAnalyzeSegment}
          canInspect={canInspect}
        />
      </div>
      <section className="brief-actions">
        <h3>Supported next actions</h3>
        <div className="button-row">
          {brief.next_actions.map((action) => (
            <button
              className="secondary"
              key={action.action_id}
              onClick={() =>
                action.kind === 'review_inventory_units' && onLoadDetails
                  ? onLoadDetails()
                  : onEvidence(action.artifact_id)
              }
            >
              {action.label} <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

export function AnalysisResult({
  artifacts,
  decision = null,
  brief = null,
  briefStatus = 'idle',
  detailsLoading = false,
  onEvidence,
  onLoadDetails,
  onInspectSignal,
  onAnalyzeSegment,
  canInspect = false,
  onReport,
}: {
  artifacts: Artifact[];
  decision?: DecisionIntelligenceResponse | null;
  brief?: DecisionBriefResponse | null;
  briefStatus?: BriefLoadState;
  detailsLoading?: boolean;
  onEvidence: (id: string) => void;
  onLoadDetails?: () => void;
  onInspectSignal?: (runId: string, signalId: string) => void;
  onAnalyzeSegment?: (runId: string, signalId: string) => void;
  canInspect?: boolean;
  onReport?: () => void;
}) {
  const decisionPack = decision?.status === 'available' ? decision.decision_intelligence : null;
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
  if (!calculation) {
    if (briefStatus === 'loading')
      return (
        <section className="card decision-brief-state" role="status">
          Loading the validated decision briefing…
        </section>
      );
    if (decisionPack)
      return <DecisionIntelligenceView pack={decisionPack} onEvidence={onEvidence} onLoadDetails={onLoadDetails} />;
    if (brief)
      return (
        <div className="result-stack">
          <DecisionBriefView
            brief={brief.decision_brief}
            onEvidence={onEvidence}
            onLoadDetails={onLoadDetails}
            onInspectSignal={(signalId) => onInspectSignal?.(brief.run_id, signalId)}
            onAnalyzeSegment={(signalId) => onAnalyzeSegment?.(brief.run_id, signalId)}
            canInspect={canInspect}
          />
          <section className="card decision-details-prompt">
            <h2>Charts, units and detailed artifacts</h2>
            <p className="muted">Load the full validated artifact bundle only when needed.</p>
            <button className="secondary" disabled={detailsLoading} onClick={onLoadDetails}>
              {detailsLoading ? 'Loading details…' : 'Load detailed results'}
            </button>
          </section>
        </div>
      );
    if (briefStatus === 'unavailable')
      return (
        <section className="card decision-brief-state">
          This run has no Decision Briefing. Loading the historical result view…
        </section>
      );
    return null;
  }
  const detailed = (
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
  if (!brief && !decisionPack)
    return (
      <div className="result-stack">
        {briefStatus === 'unavailable' && (
          <div className="notice">
            <CircleHelp size={18} />
            <p>This historical run has no Decision Briefing; the existing result view is shown.</p>
          </div>
        )}
        {detailed}
      </div>
    );
  return (
    <div className="result-stack">
      {decisionPack ? (
        <DecisionIntelligenceView pack={decisionPack} onEvidence={onEvidence} onLoadDetails={onLoadDetails} />
      ) : brief ? (
        <DecisionBriefView
          brief={brief.decision_brief}
          onEvidence={onEvidence}
          onInspectSignal={(signalId) => onInspectSignal?.(brief.run_id, signalId)}
          onAnalyzeSegment={(signalId) => onAnalyzeSegment?.(brief.run_id, signalId)}
          canInspect={canInspect}
        />
      ) : null}
      <details className="card decision-details" open>
        <summary>Charts, units and detailed artifacts</summary>
        {detailed}
      </details>
    </div>
  );
}

export function ReportBody({
  payload,
  dataAsOf,
  decision,
  visualEvidence,
  onEvidence,
}: {
  payload: ReportPayload;
  dataAsOf: string;
  decision?: DecisionIntelligenceResponse | null;
  visualEvidence?: VisualEvidencePayload;
  onEvidence: (id: string) => void;
}) {
  return (
    <ReportDashboard
      payload={payload}
      dataAsOf={dataAsOf}
      decision={decision}
      visualEvidence={visualEvidence}
      onEvidence={onEvidence}
    />
  );
}
