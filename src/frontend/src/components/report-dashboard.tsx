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
import { ChartRenderer, ChartUnavailableView } from './chart-renderer';
import {
  buildReportDashboardModel,
  resolveReportDashboardDetail,
  type DashboardSelection,
} from './report-dashboard-model';
import { dashboardSelectionForDrilldown } from './workspace-dashboard-selection';

function ScopeLabel({
  scope,
}: {
  scope: { project_external_id: string; zone_external_id: string | null } | null;
}) {
  if (!scope) return <>Published report</>;
  return (
    <>
      {scope.project_external_id} / {scope.zone_external_id ?? 'Project'}
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
          <span className="eyebrow">PUBLISHED DETAIL</span>
          <h3>Supporting units</h3>
        </div>
        <span className="badge">{total} matched</span>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Age</th>
              <th>Slow-moving</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((unit) => (
              <tr key={unit.unit_external_id}>
                <td>{unit.unit_code}</td>
                <td>{unit.zone_external_id}</td>
                <td>
                  <span className={`status status-${unit.status}`}>{unit.status}</span>
                </td>
                <td>{unit.age_days ?? 'Unavailable'}</td>
                <td>
                  {unit.slow_moving === null ? 'Unavailable' : unit.slow_moving ? 'Yes' : 'No'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > visible.length && (
        <p className="muted">Showing the first {visible.length} published matches.</p>
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
        <p>The requested published detail is unavailable.</p>
        <div className="button-row">
          <button className="secondary" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> Back to dashboard
          </button>
          {onAskGrok && (
            <button className="secondary" type="button" onClick={onAskGrok}>
              <Sparkles size={15} /> Ask Grok about this
            </button>
          )}
        </div>
      </section>
    );
  return (
    <section className="report-drilldown" aria-labelledby="report-drilldown-title">
      <nav className="drilldown-breadcrumbs" aria-label="Report drill-down breadcrumb">
        <button className="text-button" type="button" onClick={onBack}>
          Report dashboard
        </button>
        <ChevronRight size={15} aria-hidden="true" />
        <span>{detail.title}</span>
      </nav>
      <header className="drilldown-header">
        <div>
          <span className="eyebrow">DRILL-DOWN DETAIL</span>
          <h2 id="report-drilldown-title">{detail.title}</h2>
          <p>{detail.summary}</p>
        </div>
        <button className="secondary" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Back to dashboard
        </button>
      </header>
      <dl className="dashboard-meta drilldown-meta">
        <div>
          <dt>Scope</dt>
          <dd>
            <ScopeLabel scope={detail.scope} />
          </dd>
        </div>
        <div>
          <dt>Data as of</dt>
          <dd>{model.header.dataAsOf}</dd>
        </div>
        {detail.value && (
          <div>
            <dt>Focused value</dt>
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
            This request changes canonical scope. Run a new analysis instead of treating it as a
            local dashboard filter.
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
              <span className="eyebrow">LIMITATIONS</span>
              <h3>Use this detail with context</h3>
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
          <Database size={15} /> View evidence <ArrowUpRight size={14} />
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
          The requested published drill-down is unavailable in this dashboard.
        </div>
      )}
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">PUBLISHED REPORT · DASHBOARD SUMMARY</span>
          <h1>{model.header.title}</h1>
          <p>{model.header.summary}</p>
        </div>
        <div className="dashboard-statuses">
          {model.header.decisionStatus && (
            <span className="badge">{model.header.decisionStatus.replaceAll('_', ' ')}</span>
          )}
          {model.header.completeness && (
            <span className="badge">handoff: {model.header.completeness}</span>
          )}
          {onAskGrok && (
            <button className="secondary" type="button" onClick={onAskGrok}>
              <Sparkles size={15} /> Ask Grok
            </button>
          )}
        </div>
      </header>
      <dl className="dashboard-meta">
        <div>
          <dt>Scope</dt>
          <dd>
            <ScopeLabel scope={model.header.scope} />
          </dd>
        </div>
        <div>
          <dt>Data as of</dt>
          <dd>{model.header.dataAsOf}</dd>
        </div>
        <div>
          <dt>View</dt>
          <dd>
            {model.mode === 'decision-intelligence' ? 'Decision intelligence' : 'Published report'}
          </dd>
        </div>
      </dl>

      <section className="dashboard-kpi-section" aria-labelledby="dashboard-kpis-title">
        <header className="dashboard-section-heading">
          <div>
            <span className="eyebrow">EXECUTIVE SCAN</span>
            <h2 id="dashboard-kpis-title">Current KPIs</h2>
          </div>
          <span className="dashboard-hint">
            Select a card to inspect its evidence-backed detail.
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
                  {kpi.available ? 'Inspect detail' : 'Unavailable — inspect limitations'}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty" role="status">
            No validated KPI is available in this published report.
          </div>
        )}
      </section>

      <section className="dashboard-main-story" aria-labelledby="dashboard-story-title">
        <header className="dashboard-section-heading">
          <div>
            <span className="eyebrow">MAIN STORY</span>
            <h2 id="dashboard-story-title">What deserves attention?</h2>
          </div>
          <span className="dashboard-hint">
            Charts retain the published ChartSpec and provenance.
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
            No supported primary visual is available for this report.
          </div>
        )}
      </section>

      <div className="dashboard-lower-grid">
        <section className="dashboard-priority-panel" aria-labelledby="dashboard-priority-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">PRIORITY / ATTENTION</span>
              <h2 id="dashboard-priority-title">
                {model.priorities.length ? 'Inspect first' : 'Evidence-backed insights'}
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
              No priority entity or insight is available in this published report.
            </p>
          )}
        </section>

        <section className="dashboard-quality-panel" aria-labelledby="dashboard-quality-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">DATA QUALITY</span>
              <h2 id="dashboard-quality-title">Limitations stay visible</h2>
            </div>
            {model.quality.status && (
              <span className={`badge quality-${model.quality.status}`}>
                {model.quality.status}
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
              No separate data-quality limitation is attached to this published report.
            </p>
          )}
          {model.quality.evidenceArtifactId && (
            <button
              className="text-button"
              type="button"
              onClick={() => onEvidence(model.quality.evidenceArtifactId!)}
            >
              Inspect quality evidence <ArrowUpRight size={14} />
            </button>
          )}
        </section>
      </div>

      {(model.secondaryVisuals.length || model.unavailableVisuals.length) && (
        <section className="dashboard-secondary" aria-labelledby="dashboard-secondary-title">
          <header className="dashboard-section-heading">
            <div>
              <span className="eyebrow">SUPPORTING CONTEXT</span>
              <h2 id="dashboard-secondary-title">Compare before going deeper</h2>
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
              <span className="eyebrow">SUPPORTED NEXT STEPS</span>
              <h2 id="dashboard-actions-title">Continue from canonical drill-downs</h2>
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
            This historical report has no Decision Intelligence Pack. The dashboard is using the
            compatible published report artifacts that are available.
          </p>
        </div>
      )}
    </article>
  );
}
