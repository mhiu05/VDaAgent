'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  Database,
  FileCheck2,
  ListFilter,
  Sparkles,
} from 'lucide-react';
import type {
  DecisionIntelligenceResponse,
  ReportPayload,
  VisualEvidencePayload,
} from '@vda/contracts';
import {
  ChartRenderer,
  ChartUnavailableView,
} from '../../../components/visualization/chart-renderer';
import {
  buildReportDashboardModel,
  resolveReportDashboardDetail,
  type DashboardSelection,
} from './report-dashboard-model';
import { dashboardSelectionForDrilldown } from './selection';
import { inventoryStatusLabel, workflowStatusLabel } from '../../../lib/format/status-label';

function ScopeLabel({
  scope,
}: {
  scope: { project_external_id: string; zone_external_id: string | null } | null;
}) {
  if (!scope) return <>Báo cáo đã phát hành</>;
  return (
    <>
      {scope.project_external_id} / {scope.zone_external_id ?? 'Toàn dự án'}
    </>
  );
}

function DetailTable({
  units,
  total,
}: {
  units: ReturnType<typeof buildReportDashboardModel>['units'];
  total: number;
}) {
  if (!units.length) return null;
  const visible = units.slice(0, 20);
  return (
    <section className="dashboard-detail-table">
      <header className="dashboard-section-heading">
        <div>
          <span className="eyebrow">CHI TIẾT ĐÃ CÔNG BỐ</span>
          <h3>Sản phẩm liên quan</h3>
        </div>
        <span className="badge">{total} mục</span>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Phân khu</th>
              <th>Trạng thái</th>
              <th>Tuổi tồn (ngày)</th>
              <th>Chậm luân chuyển</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((unit) => (
              <tr key={unit.unit_external_id}>
                <td>{unit.unit_code}</td>
                <td>{unit.zone_external_id}</td>
                <td>
                  <span className={`status status-${unit.status}`}>
                    {inventoryStatusLabel(unit.status)}
                  </span>
                </td>
                <td>{unit.age_days ?? 'Chưa có dữ liệu'}</td>
                <td>
                  {unit.slow_moving === null ? 'Chưa có dữ liệu' : unit.slow_moving ? 'Có' : 'Không'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > visible.length && (
        <p className="muted">Đang hiển thị {visible.length} trong số {total} mục.</p>
      )}
    </section>
  );
}

function DashboardDetail({
  model,
  selection,
  onBack,
  onEvidence,
  onAskGrok,
}: {
  model: ReturnType<typeof buildReportDashboardModel>;
  selection: DashboardSelection;
  onBack: () => void;
  onEvidence: (artifactId: string) => void;
  onAskGrok?: () => void;
}) {
  const detail = resolveReportDashboardDetail(model, selection);
  if (!detail)
    return (
      <section className="report-drilldown" role="status">
        <p>Chi tiết đã yêu cầu hiện không khả dụng.</p>
        <div className="button-row">
          <button className="secondary" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> Về tổng quan
          </button>
          {onAskGrok && (
            <button className="secondary" type="button" onClick={onAskGrok}>
              <Sparkles size={15} /> Hỏi Grok về nội dung này
            </button>
          )}
        </div>
      </section>
    );
  return (
    <section className="report-drilldown" aria-labelledby="report-drilldown-title">
      <nav className="drilldown-breadcrumbs" aria-label="Đường dẫn chi tiết báo cáo">
        <button className="text-button" type="button" onClick={onBack}>
          Tổng quan báo cáo
        </button>
        <ChevronRight size={15} aria-hidden="true" />
        <span>{detail.title}</span>
      </nav>
      <header className="drilldown-header">
        <div>
          <span className="eyebrow">CHI TIẾT PHÂN TÍCH</span>
          <h2 id="report-drilldown-title">{detail.title}</h2>
          <p>{detail.summary}</p>
        </div>
        <button className="secondary" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Về tổng quan
        </button>
      </header>
      <dl className="dashboard-meta drilldown-meta">
        <div>
          <dt>Phạm vi</dt>
          <dd>
            <ScopeLabel scope={detail.scope} />
          </dd>
        </div>
        <div>
          <dt>Ngày dữ liệu</dt>
          <dd>{model.header.dataAsOf}</dd>
        </div>
        {detail.value && (
          <div>
            <dt>Giá trị đang xem</dt>
            <dd>{detail.value}</dd>
          </div>
        )}
      </dl>
      {detail.chart && (
        <section className="drilldown-chart">
          <ChartRenderer spec={detail.chart} />
        </section>
      )}
      {detail.requiresNewRun && (
        <div className="dashboard-callout" role="status">
          <ListFilter size={18} />
          <p>
            Yêu cầu này thay đổi phạm vi phân tích. Chạy phân tích mới để áp dụng thay đổi thay vì
            dùng bộ lọc cục bộ trên tổng quan.
          </p>
        </div>
      )}
      {detail.localFilterNote && (
        <div className="dashboard-callout">
          <ListFilter size={18} />
          <p>{detail.localFilterNote}</p>
        </div>
      )}
      <DetailTable units={detail.units} total={detail.totalUnits} />
      {!!detail.limitations.length && (
        <section className="dashboard-limitations">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">GIỚI HẠN</span>
              <h3>Đọc chi tiết cùng bối cảnh</h3>
            </div>
          </header>
          <ul>
            {detail.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
      {detail.evidenceArtifactId && (
        <button
          className="secondary dashboard-evidence-button"
          type="button"
          onClick={() => onEvidence(detail.evidenceArtifactId!)}
        >
          <Database size={15} /> Xem bằng chứng <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
}

export function ReportDashboard({
  payload,
  dataAsOf,
  decision,
  visualEvidence,
  selection: controlledSelection,
  activeDrilldownId,
  onSelectionChange,
  onEvidence,
  onAskGrok,
}: {
  payload: ReportPayload;
  dataAsOf: string;
  decision?: DecisionIntelligenceResponse | null;
  visualEvidence?: VisualEvidencePayload;
  selection?: DashboardSelection | null;
  activeDrilldownId?: string | null;
  onSelectionChange?: (selection: DashboardSelection | null) => void;
  onEvidence: (artifactId: string) => void;
  onAskGrok?: () => void;
}) {
  const model = useMemo(
    () => buildReportDashboardModel({ payload, dataAsOf, decision, visualEvidence }),
    [payload, dataAsOf, decision, visualEvidence],
  );
  const [localSelection, setLocalSelection] = useState<DashboardSelection | null>(null);
  const selection = controlledSelection === undefined ? localSelection : controlledSelection;
  const drilldownSelection = activeDrilldownId
    ? dashboardSelectionForDrilldown(model, activeDrilldownId)
    : null;
  const displayedSelection = selection ?? drilldownSelection;
  function updateSelection(next: DashboardSelection | null) {
    if (controlledSelection === undefined) setLocalSelection(next);
    onSelectionChange?.(next);
  }
  if (displayedSelection)
    return (
      <article className="report-dashboard" data-dashboard-mode={model.mode}>
        <DashboardDetail
          model={model}
          selection={displayedSelection}
          onBack={() => updateSelection(null)}
          onEvidence={onEvidence}
          onAskGrok={onAskGrok}
        />
      </article>
    );
  return (
    <article className="report-dashboard" data-dashboard-mode={model.mode}>
      {activeDrilldownId && !drilldownSelection && (
        <div className="dashboard-empty" role="status">
          Mục phân tích chi tiết này hiện không có trong báo cáo.
        </div>
      )}
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">BÁO CÁO ĐÃ PHÁT HÀNH · TỔNG QUAN</span>
          <h1>{model.header.title}</h1>
          <p>{model.header.summary}</p>
        </div>
        <div className="dashboard-statuses">
            {model.header.decisionStatus && <span className="badge">{workflowStatusLabel(model.header.decisionStatus)}</span>}
          {model.header.completeness && (
              <span className="badge">Bàn giao: {workflowStatusLabel(model.header.completeness)}</span>
          )}
          {onAskGrok && (
            <button className="secondary" type="button" onClick={onAskGrok}>
              <Sparkles size={15} /> Hỏi Grok
            </button>
          )}
        </div>
      </header>
      <dl className="dashboard-meta">
        <div>
          <dt>Phạm vi</dt>
          <dd>
            <ScopeLabel scope={model.header.scope} />
          </dd>
        </div>
        <div>
          <dt>Ngày dữ liệu</dt>
          <dd>{model.header.dataAsOf}</dd>
        </div>
        <div>
          <dt>Chế độ xem</dt>
          <dd>
            {model.mode === 'decision-intelligence' ? 'Hỗ trợ quyết định' : 'Báo cáo đã phát hành'}
          </dd>
        </div>
      </dl>

      <section className="dashboard-kpi-section" aria-labelledby="dashboard-kpis-title">
        <header className="dashboard-section-heading">
          <div>
            <span className="eyebrow">TỔNG QUAN ĐIỀU HÀNH</span>
            <h2 id="dashboard-kpis-title">Chỉ số hiện tại</h2>
          </div>
          <span className="dashboard-hint">
            Chọn một chỉ số để xem chi tiết và bằng chứng đi kèm.
          </span>
        </header>
        {model.kpis.length ? (
          <div className="dashboard-kpi-grid">
            {model.kpis.map((kpi) => (
              <button
                className={`dashboard-kpi ${kpi.available ? '' : 'dashboard-kpi-unavailable'}`}
                data-dashboard-kpi={kpi.id}
                key={kpi.id}
                type="button"
                onClick={() => updateSelection({ kind: 'kpi', id: kpi.id })}
              >
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
                <small>
                  {kpi.available ? 'Xem chi tiết' : 'Chưa có — xem giới hạn'}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty" role="status">
            Báo cáo này chưa có chỉ số được xác thực.
          </div>
        )}
      </section>

      <section className="dashboard-main-story" aria-labelledby="dashboard-story-title">
        <header className="dashboard-section-heading">
          <div>
            <span className="eyebrow">NHẬN ĐỊNH CHÍNH</span>
            <h2 id="dashboard-story-title">Điều gì cần chú ý?</h2>
          </div>
          <span className="dashboard-hint">
            Biểu đồ giữ nguyên đặc tả đã phát hành và nguồn gốc dữ liệu.
          </span>
        </header>
        {model.primaryVisuals.length ? (
          <div
            className={`dashboard-visual-grid dashboard-visual-grid-${model.primaryVisuals.length}`}
          >
            {model.primaryVisuals.map(({ chart }) => (
              <ChartRenderer
                key={chart.chart_id}
                spec={chart}
                onDrilldown={() => updateSelection({ kind: 'chart', id: chart.chart_id })}
              />
            ))}
          </div>
        ) : (
          <div className="dashboard-empty" role="status">
            Báo cáo này chưa có hình ảnh dữ liệu chính phù hợp.
          </div>
        )}
      </section>

      <div className="dashboard-lower-grid">
        <section className="dashboard-priority-panel" aria-labelledby="dashboard-priority-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">ƯU TIÊN / CẦN CHÚ Ý</span>
              <h2 id="dashboard-priority-title">
                {model.priorities.length ? 'Xem xét trước' : 'Nhận định có bằng chứng'}
              </h2>
            </div>
          </header>
          {model.priorities.length ? (
            <div className="dashboard-priority-list">
              {model.priorities.map((priority) => (
                <button
                  className="dashboard-priority-item"
                  key={priority.id}
                  type="button"
                  onClick={() => updateSelection({ kind: 'priority', id: priority.id })}
                >
                  <span className={`dashboard-tier dashboard-tier-${priority.tier}`}>
                    {priority.tier}
                  </span>
                  <span>
                    <strong>{priority.label}</strong>
                    <small>{priority.summary}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : model.insights.length ? (
            <div className="dashboard-priority-list">
              {model.insights.map((insight) => (
                <button
                  className="dashboard-priority-item"
                  key={insight.id}
                  type="button"
                  onClick={() => updateSelection({ kind: 'insight', id: insight.id })}
                >
                  <FileCheck2 size={16} />
                  <span>
                    <strong>{insight.label}</strong>
                    <small>{insight.summary}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              Báo cáo này chưa có đối tượng ưu tiên hoặc nhận định.
            </p>
          )}
        </section>

        <section className="dashboard-quality-panel" aria-labelledby="dashboard-quality-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">CHẤT LƯỢNG DỮ LIỆU</span>
              <h2 id="dashboard-quality-title">Luôn hiển thị giới hạn dữ liệu</h2>
            </div>
            {model.quality.status && (
              <span className={`badge quality-${model.quality.status}`}>
                {workflowStatusLabel(model.quality.status)}
              </span>
            )}
          </header>
          {model.quality.limitations.length ? (
            <ul>
              {model.quality.limitations.slice(0, 4).map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Báo cáo này không có giới hạn chất lượng dữ liệu riêng.
            </p>
          )}
          {model.quality.evidenceArtifactId && (
            <button
              className="text-button"
              type="button"
              onClick={() => onEvidence(model.quality.evidenceArtifactId!)}
            >
              Xem bằng chứng chất lượng <ArrowUpRight size={14} />
            </button>
          )}
        </section>
      </div>

      {(model.secondaryVisuals.length || model.unavailableVisuals.length) && (
        <section className="dashboard-secondary" aria-labelledby="dashboard-secondary-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">BỐI CẢNH BỔ TRỢ</span>
              <h2 id="dashboard-secondary-title">So sánh trước khi xem sâu hơn</h2>
            </div>
          </header>
          <div className="dashboard-secondary-grid">
            {model.secondaryVisuals.map(({ chart }) => (
              <ChartRenderer
                key={chart.chart_id}
                spec={chart}
                onDrilldown={() => updateSelection({ kind: 'chart', id: chart.chart_id })}
              />
            ))}
            {model.unavailableVisuals.map((state) => (
              <ChartUnavailableView key={`${state.intent}:${state.reason}`} state={state} />
            ))}
          </div>
        </section>
      )}

      {!!model.actions.length && (
        <section className="dashboard-actions" aria-labelledby="dashboard-actions-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">BƯỚC TIẾP THEO CÓ CĂN CỨ</span>
              <h2 id="dashboard-actions-title">Tiếp tục từ các mục phân tích</h2>
            </div>
          </header>
          <div className="button-row">
            {model.actions.map((action) => (
              <button
                className="secondary"
                key={action.id}
                type="button"
                onClick={() => updateSelection({ kind: 'action', id: action.id })}
              >
                <Sparkles size={14} /> {action.label} <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
      {model.mode !== 'decision-intelligence' && (
        <div className="dashboard-callout">
          <CircleAlert size={18} />
          <p>
            Báo cáo lịch sử này chưa có gói hỗ trợ quyết định. Tổng quan đang dùng các hiện vật báo
            cáo đã phát hành tương thích hiện có.
          </p>
        </div>
      )}
    </article>
  );
}
