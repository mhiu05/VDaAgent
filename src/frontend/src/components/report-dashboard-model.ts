import type {
  CalculatedUnit,
  ChartSpec,
  ChartUnavailable,
  DecisionIntelligenceResponse,
  DrillDown,
  Metric,
  MetricKey,
  ReportPayload,
  VisualEvidencePayload,
} from '@vda/contracts';
import { formatChartValue, formatMetricValue, formatSeriesValue } from '../lib/chart-format';

type Scope = { project_external_id: string; zone_external_id: string | null };

export type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  metricKey: MetricKey | null;
  available: boolean;
  evidenceArtifactId: string;
  limitations: string[];
};

export type DashboardVisual = {
  chart: ChartSpec;
  role: 'primary' | 'supporting';
};

export type DashboardPriority = {
  id: string;
  label: string;
  summary: string;
  tier: string | null;
  metricKey: MetricKey | null;
  evidenceArtifactId: string;
  drilldownId: string | null;
  limitations: string[];
  entity: { type: string; key: string; label: string } | null;
};

export type DashboardInsight = {
  id: string;
  label: string;
  summary: string;
  metricKey: MetricKey | null;
  evidenceArtifactId: string;
  limitations: string[];
};

export type DashboardQuality = {
  status: 'available' | 'limited' | 'unavailable' | null;
  limitations: string[];
  evidenceArtifactId: string | null;
};

export type DashboardAction = {
  id: string;
  label: string;
  drilldownId: string;
  evidenceArtifactId: string;
};

export type ReportDashboardModel = {
  mode: 'decision-intelligence' | 'legacy-brief' | 'legacy-report';
  header: {
    title: string;
    summary: string;
    dataAsOf: string;
    scope: Scope | null;
    completeness: 'complete' | 'partial' | 'insufficient' | null;
    decisionStatus: string | null;
  };
  kpis: DashboardKpi[];
  primaryVisuals: DashboardVisual[];
  secondaryVisuals: DashboardVisual[];
  unavailableVisuals: ChartUnavailable[];
  priorities: DashboardPriority[];
  insights: DashboardInsight[];
  quality: DashboardQuality;
  actions: DashboardAction[];
  charts: ChartSpec[];
  drilldowns: DrillDown[];
  units: CalculatedUnit[];
  sections: ReportPayload['sections'];
};

export type DashboardSelection =
  | { kind: 'kpi'; id: string }
  | { kind: 'chart'; id: string }
  | { kind: 'priority'; id: string }
  | { kind: 'insight'; id: string }
  | { kind: 'action'; id: string };

export type DashboardDetail = {
  title: string;
  summary: string;
  scope: Scope | null;
  value: string | null;
  chart: ChartSpec | null;
  units: CalculatedUnit[];
  totalUnits: number;
  evidenceArtifactId: string | null;
  limitations: string[];
  localFilterNote: string | null;
  requiresNewRun: boolean;
};

function numberValue(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function first<T>(items: readonly T[]): T | null {
  return items[0] ?? null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstEvidenceArtifactId(
  refs: ReadonlyArray<{ artifact_id: string }> | undefined,
  fallback: string | null = null,
): string | null {
  return refs?.[0]?.artifact_id ?? fallback;
}

function scopeFrom(
  payload: ReportPayload,
  decision: DecisionIntelligenceResponse | null | undefined,
): Scope | null {
  if (decision?.status === 'available') return decision.decision_intelligence.scope;
  if (decision?.status === 'legacy_report_brief') return decision.decision_brief.scope;
  return payload.decision_brief?.scope ?? null;
}

function decisionMode(
  decision: DecisionIntelligenceResponse | null | undefined,
): ReportDashboardModel['mode'] {
  if (decision?.status === 'available') return 'decision-intelligence';
  if (decision?.status === 'legacy_report_brief') return 'legacy-brief';
  return 'legacy-report';
}

function chartKpis(
  visualEvidence: VisualEvidencePayload | undefined,
  fallbackArtifactId: string,
): DashboardKpi[] {
  return (visualEvidence?.charts ?? [])
    .filter((chart) => chart.chart_type === 'kpi')
    .slice(0, 6)
    .map((chart) => {
      const series = chart.series[0]!;
      const raw = chart.data[0]?.[series.key];
      const value = typeof raw === 'number' ? raw : null;
      return {
        id: `chart:${chart.chart_id}`,
        label: chart.title,
        value: formatSeriesValue(value, series),
        metricKey: series.metric_key,
        available: value !== null,
        evidenceArtifactId: chart.provenance.bindings[0]?.artifact_id ?? fallbackArtifactId,
        limitations: chart.limitations,
      };
    });
}

function reportMetricKpis(metrics: Metric[], fallbackArtifactId: string): DashboardKpi[] {
  return metrics.slice(0, 6).map((metric) => ({
    id: `metric:${metric.key}`,
    label: metric.label,
    value: formatMetricValue(metric),
    metricKey: metric.key,
    available: metric.status === 'available' && metric.value !== null,
    evidenceArtifactId: fallbackArtifactId,
    limitations: [],
  }));
}

function orderedVisuals(
  visualEvidence: VisualEvidencePayload | undefined,
  decision: DecisionIntelligenceResponse | null | undefined,
): Pick<
  ReportDashboardModel,
  'primaryVisuals' | 'secondaryVisuals' | 'unavailableVisuals' | 'charts'
> {
  const charts = (visualEvidence?.charts ?? []).filter((chart) => chart.chart_type !== 'kpi');
  const byId = new Map(charts.map((chart) => [chart.chart_id, chart]));
  const selected =
    decision?.status === 'available'
      ? decision.decision_intelligence.visual_story.ordered_visuals.flatMap((visual) => {
          const chart = byId.get(visual.chart_id);
          return chart ? [{ chart, role: visual.role }] : [];
        })
      : [];
  const selectedIds = new Set(selected.map((visual) => visual.chart.chart_id));
  const remaining = charts.filter((chart) => !selectedIds.has(chart.chart_id));
  const primary = selected.filter((visual) => visual.role === 'primary');
  const supporting = selected.filter((visual) => visual.role === 'supporting');
  const requiredPrimary = Math.max(0, Math.min(2, charts.length) - primary.length);
  const promoted = remaining
    .slice(0, requiredPrimary)
    .map((chart) => ({ chart, role: 'primary' as const }));
  const remainingSupporting = remaining
    .slice(requiredPrimary)
    .map((chart) => ({ chart, role: 'supporting' as const }));
  return {
    charts,
    primaryVisuals: [...primary, ...promoted].slice(0, 2),
    secondaryVisuals: [...supporting, ...remainingSupporting].slice(0, 4),
    unavailableVisuals: visualEvidence?.unavailable ?? [],
  };
}

export function buildReportDashboardModel({
  payload,
  dataAsOf,
  decision,
  visualEvidence,
}: {
  payload: ReportPayload;
  dataAsOf: string;
  decision?: DecisionIntelligenceResponse | null;
  visualEvidence?: VisualEvidencePayload;
}): ReportDashboardModel {
  const pack = decision?.status === 'available' ? decision.decision_intelligence : null;
  const mode = decisionMode(decision);
  const scope = scopeFrom(payload, decision);
  const visualModel = orderedVisuals(visualEvidence, decision);
  const kpis = pack
    ? pack.decision_brief.kpi_cards.slice(0, 6).map((card) => ({
        id: card.kpi_id,
        label: card.label,
        value: formatChartValue(
          numberValue(card.value),
          card.unit === 'currency_per_sqm'
            ? 'currency_per_area'
            : card.unit === 'count'
              ? 'integer'
              : card.unit,
          card.currency,
        ),
        metricKey: card.metric_key,
        available: card.status === 'available' && card.value !== null,
        evidenceArtifactId: card.metric_ref.artifact_id,
        limitations: card.limitations,
      }))
    : chartKpis(visualEvidence, payload.calculation_artifact_id).length
      ? chartKpis(visualEvidence, payload.calculation_artifact_id)
      : reportMetricKpis(payload.metrics, payload.calculation_artifact_id);
  const priorities: DashboardPriority[] = pack
    ? pack.priority_entities.slice(0, 6).map((entity) => ({
        id: entity.priority_entity_id,
        label: entity.entity.label,
        summary: entity.reason_codes.join(' · '),
        tier: entity.tier,
        metricKey: entity.metric_refs[0]?.metric_key ?? null,
        evidenceArtifactId: entity.evidence_refs[0]!.artifact_id,
        drilldownId: entity.drilldown_ids[0] ?? null,
        limitations: entity.limitations,
        entity: entity.entity,
      }))
    : [];
  const insights: DashboardInsight[] = pack
    ? pack.decision_brief.business_implications.slice(0, 3).map((item) => ({
        id: item.implication_id,
        label: item.text,
        summary: `${item.support_level} support`,
        metricKey: null,
        evidenceArtifactId: item.evidence_refs[0]!.artifact_id,
        limitations: item.limitations,
      }))
    : payload.claims.slice(0, 3).map((claim) => ({
        id: claim.claim_id,
        label: claim.text,
        summary: claim.metric_key,
        metricKey: claim.metric_key,
        evidenceArtifactId: claim.evidence_artifact_id,
        limitations: [],
      }));
  const quality: DashboardQuality = pack
    ? {
        status: pack.decision_brief.data_quality_summary.status,
        limitations: pack.decision_brief.data_quality_summary.limitations,
        evidenceArtifactId: firstEvidenceArtifactId(
          pack.decision_brief.data_quality_summary.evidence_refs,
        ),
      }
    : {
        status: payload.limitations.length ? 'limited' : null,
        limitations: payload.limitations,
        evidenceArtifactId:
          first(
            payload.sections.find((section) => section.key === 'data_quality_limitations')
              ?.artifact_refs ?? [],
          ) ?? (payload.limitations.length ? payload.calculation_artifact_id : null),
      };
  const actions: DashboardAction[] = pack
    ? pack.action_candidates.slice(0, 4).map((action) => ({
        id: action.action_candidate_id,
        label: action.label,
        drilldownId: action.drilldown_id,
        evidenceArtifactId: action.evidence_refs[0]!.artifact_id,
      }))
    : [];
  return {
    mode,
    header: {
      title: payload.title,
      summary: pack?.decision_brief.headline ?? payload.summary,
      dataAsOf,
      scope,
      completeness: pack?.handoff.completeness ?? null,
      decisionStatus: pack?.decision_brief.status ?? null,
    },
    kpis,
    priorities,
    insights,
    quality,
    actions,
    drilldowns: pack?.drilldowns ?? [],
    units: payload.units,
    sections: payload.sections,
    ...visualModel,
  };
}

function chartForMetric(
  model: ReportDashboardModel,
  metricKey: MetricKey | null,
): ChartSpec | null {
  if (metricKey === null) return null;
  return (
    model.charts.find(
      (chart) =>
        chart.series.some((series) => series.metric_key === metricKey) ||
        chart.provenance.metric_keys.includes(metricKey),
    ) ?? null
  );
}

function filtersUnits(
  units: CalculatedUnit[],
  filters: ReadonlyArray<{ dimension: string; value: string }>,
  entity: DashboardPriority['entity'] = null,
): { units: CalculatedUnit[]; note: string | null } {
  const applied = filters.filter((filter) => filter.dimension !== 'bedrooms');
  const requiresUnavailableDimension = filters.some((filter) => filter.dimension === 'bedrooms');
  const filtered = units.filter((unit) => {
    if (entity?.type === 'unit' && unit.unit_external_id !== entity.key) return false;
    return applied.every((filter) => {
      if (filter.dimension === 'project') return unit.project_external_id === filter.value;
      if (filter.dimension === 'zone') return unit.zone_external_id === filter.value;
      if (filter.dimension === 'unit_type') return unit.unit_type === filter.value;
      if (filter.dimension === 'status') return unit.status === filter.value;
      return true;
    });
  });
  return {
    units: requiresUnavailableDimension ? [] : filtered,
    note: requiresUnavailableDimension
      ? 'This published unit detail does not expose the requested dimension, so no local filter is applied.'
      : applied.length || entity
        ? 'This is a local presentation filter over the already-published canonical unit detail; it does not run new analysis.'
        : null,
  };
}

function detailForDrilldown(
  model: ReportDashboardModel,
  drilldown: DrillDown,
  fallback: {
    evidenceArtifactId: string;
    metricKey: MetricKey | null;
    entity: DashboardPriority['entity'];
    limitations: string[];
  },
): DashboardDetail {
  const base = {
    title: drilldown.label,
    scope: drilldown.context.scope,
    value: null,
    chart: chartForMetric(model, fallback.metricKey),
    units: [] as CalculatedUnit[],
    totalUnits: 0,
    evidenceArtifactId: fallback.evidenceArtifactId,
    limitations: fallback.limitations,
    localFilterNote: null,
    requiresNewRun: false,
  };
  if (drilldown.kind === 'open_chart')
    return {
      ...base,
      summary: 'Focused view of the validated chart and its canonical provenance.',
      chart: model.charts.find((chart) => chart.chart_id === drilldown.chart_id) ?? base.chart,
      evidenceArtifactId: drilldown.chart_pack_artifact_id,
    };
  if (drilldown.kind === 'open_evidence')
    return {
      ...base,
      summary: 'Inspect the same-run canonical evidence and stated limitations.',
      evidenceArtifactId: drilldown.evidence_refs[0]?.artifact_id ?? base.evidenceArtifactId,
    };
  if (drilldown.kind === 'open_report_section') {
    const section = model.sections.find((candidate) => candidate.key === drilldown.section_key);
    return {
      ...base,
      summary: section
        ? `${section.title} is ${section.status}.`
        : 'The published report section is unavailable.',
      chart:
        model.charts.find((chart) =>
          section?.metric_keys.some((metricKey) =>
            chart.provenance.metric_keys.includes(metricKey),
          ),
        ) ?? base.chart,
      evidenceArtifactId: section?.artifact_refs[0] ?? base.evidenceArtifactId,
      limitations: unique([...base.limitations, ...(section?.limitations ?? [])]),
    };
  }
  if (drilldown.kind === 'inspect_entities') {
    const entities = drilldown.entity_refs;
    const entity = entities[0] ?? fallback.entity;
    const filtered = filtersUnits(model.units, drilldown.filters, entity ?? null);
    return {
      ...base,
      summary: 'Inspect the published entity detail and the evidence supporting its priority.',
      units: filtered.units,
      totalUnits: filtered.units.length,
      localFilterNote: filtered.note,
      chart: chartForMetric(model, fallback.metricKey),
    };
  }
  if (drilldown.kind === 'compare_segment') {
    const filtered = filtersUnits(model.units, [
      { dimension: drilldown.dimension, value: drilldown.segment_key },
    ]);
    return {
      ...base,
      summary: 'Compare this segment within the already-published run and scope.',
      units: filtered.units,
      totalUnits: filtered.units.length,
      localFilterNote: filtered.note,
    };
  }
  return {
    ...base,
    summary:
      'Changing to this scope requires a new canonical analysis; it is not a local dashboard filter.',
    scope: drilldown.target_scope,
    requiresNewRun: true,
  };
}

export function resolveReportDashboardDetail(
  model: ReportDashboardModel,
  selection: DashboardSelection,
): DashboardDetail | null {
  if (selection.kind === 'kpi') {
    const kpi = model.kpis.find((candidate) => candidate.id === selection.id);
    if (!kpi) return null;
    return {
      title: kpi.label,
      summary: 'This value is displayed from the published canonical report data.',
      scope: model.header.scope,
      value: kpi.value,
      chart: chartForMetric(model, kpi.metricKey),
      units: [],
      totalUnits: 0,
      evidenceArtifactId: kpi.evidenceArtifactId,
      limitations: kpi.limitations,
      localFilterNote: null,
      requiresNewRun: false,
    };
  }
  if (selection.kind === 'chart') {
    const chart = model.charts.find((candidate) => candidate.chart_id === selection.id);
    if (!chart) return null;
    return {
      title: chart.title,
      summary: chart.purpose,
      scope: model.header.scope,
      value: null,
      chart,
      units: [],
      totalUnits: 0,
      evidenceArtifactId: chart.provenance.bindings[0]?.artifact_id ?? null,
      limitations: chart.limitations,
      localFilterNote: null,
      requiresNewRun: false,
    };
  }
  if (selection.kind === 'insight') {
    const insight = model.insights.find((candidate) => candidate.id === selection.id);
    if (!insight) return null;
    return {
      title: 'Evidence-backed insight',
      summary: insight.label,
      scope: model.header.scope,
      value: null,
      chart: chartForMetric(model, insight.metricKey),
      units: [],
      totalUnits: 0,
      evidenceArtifactId: insight.evidenceArtifactId,
      limitations: insight.limitations,
      localFilterNote: null,
      requiresNewRun: false,
    };
  }
  const priority =
    selection.kind === 'priority'
      ? model.priorities.find((candidate) => candidate.id === selection.id)
      : null;
  const action =
    selection.kind === 'action'
      ? model.actions.find((candidate) => candidate.id === selection.id)
      : null;
  const drilldownId = priority?.drilldownId ?? action?.drilldownId;
  if (!drilldownId) return null;
  const drilldown = model.drilldowns.find((candidate) => candidate.drilldown_id === drilldownId);
  if (!drilldown) return null;
  return detailForDrilldown(model, drilldown, {
    evidenceArtifactId: priority?.evidenceArtifactId ?? action!.evidenceArtifactId,
    metricKey: priority?.metricKey ?? null,
    entity: priority?.entity ?? null,
    limitations: priority?.limitations ?? [],
  });
}
