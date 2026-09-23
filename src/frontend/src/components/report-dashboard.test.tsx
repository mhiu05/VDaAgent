import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  DecisionIntelligenceResponse,
  ReportPayload,
  VisualEvidencePayload,
} from '@vda/contracts';
import { ReportDashboard } from './report-dashboard';
import { buildReportDashboardModel, resolveReportDashboardDetail } from './report-dashboard-model';
import {
  dashboardSelectionForDrilldown,
  toDashboardViewSelection,
  toWorkspaceDashboardSelection,
} from './workspace-dashboard-selection';

const ORG = '10000000-0000-4000-8000-000000000001';
const RUN = '20000000-0000-4000-8000-000000000001';
const CALCULATION = '50000000-0000-4000-8000-000000000001';
const CHART = '50000000-0000-4000-8000-000000000002';
const scope = { project_external_id: 'P-ALPHA', zone_external_id: 'Z-NORTH' };

const payload: ReportPayload = {
  title: 'Inventory report · Z-NORTH',
  summary: 'A published inventory summary.',
  claims: [
    {
      claim_id: 'claim:slow-moving',
      text: 'Slow-moving inventory needs review.',
      metric_key: 'slow_moving_rate',
      value: '25',
      evidence_artifact_id: CALCULATION,
      evidence_path: 'payload.metrics[0].value',
    },
  ],
  metrics: [
    {
      metric_id: 'metric:available_inventory',
      key: 'available_inventory',
      label: 'Available inventory',
      description: 'Published current inventory.',
      value: '4',
      unit: 'count',
      currency: null,
      status: 'available',
      abstention_reason: null,
    },
  ],
  units: [
    {
      unit_external_id: 'U-1',
      unit_code: 'U-1',
      project_external_id: 'P-ALPHA',
      zone_external_id: 'Z-NORTH',
      unit_type: '2BR',
      currency: 'VND',
      status: 'available',
      area_sqm: '80',
      list_price: '3000000000',
      price_per_sqm: '37500000',
      age_days: 120,
      slow_moving: true,
      snapshot_id: '40000000-0000-4000-8000-000000000001',
      import_id: '30000000-0000-4000-8000-000000000001',
    },
  ],
  calculation_artifact_id: CALCULATION,
  chart_artifact_id: CHART,
  comparison_artifact_id: '50000000-0000-4000-8000-000000000003',
  sections: [
    {
      key: 'data_quality_limitations',
      title: 'Data quality',
      artifact_refs: [CALCULATION],
      metric_keys: ['missing_inventory_age_rate'],
      status: 'limited',
      limitations: ['Aged inventory is partially unavailable.'],
    },
  ],
  limitations: ['Aged inventory is partially unavailable.'],
};

const visualEvidence: VisualEvidencePayload = {
  chart_rules_version: 'chart-rules-v0.2',
  charts: [
    {
      version: 'chart-spec-v1',
      rules_version: 'chart-rules-v0.2',
      chart_id: 'inventory_trend',
      intent: 'inventory_trend',
      chart_type: 'line',
      title: 'Available inventory trend',
      subtitle: null,
      purpose: 'Compare published inventory observations.',
      x_axis: { key: 'date', label: 'As-of', value_type: 'date' },
      y_axis: { label: 'Units', unit: 'count', min: 0, max: null },
      series: [
        {
          key: 'value',
          label: 'Available units',
          metric_key: 'available_inventory',
          unit: 'count',
          currency: null,
          value_format: 'integer',
          stack: null,
        },
      ],
      data: [
        { date: '2026-09-01', value: 6 },
        { date: '2026-09-20', value: 4 },
      ],
      provenance: {
        input_artifact_ids: [CALCULATION],
        metric_keys: ['available_inventory'],
        bindings: [
          {
            data_index: 0,
            data_key: 'value',
            artifact_id: CALCULATION,
            evidence_path: 'payload.values[0]',
            metric_key: 'available_inventory',
          },
          {
            data_index: 1,
            data_key: 'value',
            artifact_id: CALCULATION,
            evidence_path: 'payload.values[1]',
            metric_key: 'available_inventory',
          },
        ],
      },
      limitations: [],
      generated_by: 'deterministic',
    },
  ],
  unavailable: [
    {
      intent: 'price_distribution',
      reason: 'MISSING_REQUIRED_FIELD',
      message: 'Price distribution is unavailable.',
      metric_keys: ['median_price_per_area'],
      limitations: [],
    },
  ],
};

const decision = {
  status: 'available',
  run_id: RUN,
  org_id: ORG,
  report_artifact_id: '50000000-0000-4000-8000-000000000004',
  decision_intelligence_artifact_id: '50000000-0000-4000-8000-000000000005',
  validations: [],
  decision_intelligence: {
    scope,
    handoff: { completeness: 'partial' },
    decision_brief: {
      headline: 'Slow-moving inventory is deteriorating.',
      status: 'deteriorating',
      kpi_cards: [
        {
          kpi_id: 'kpi:available_inventory',
          label: 'Available inventory',
          value: '4',
          unit: 'count',
          currency: null,
          status: 'available',
          metric_key: 'available_inventory',
          metric_ref: { artifact_id: CALCULATION },
          limitations: [],
        },
      ],
      business_implications: [],
      data_quality_summary: {
        status: 'limited',
        limitations: ['Aged inventory is partially unavailable.'],
        evidence_refs: [{ artifact_id: CALCULATION }],
      },
    },
    visual_story: {
      ordered_visuals: [{ chart_id: 'inventory_trend', role: 'primary' }],
    },
    priority_entities: [
      {
        priority_entity_id: 'priority:unit:u-1',
        entity: { type: 'unit', key: 'U-1', label: 'U-1' },
        tier: 'high',
        reason_codes: ['slow_moving'],
        metric_refs: [{ metric_key: 'slow_moving_rate' }],
        evidence_refs: [{ artifact_id: CALCULATION }],
        drilldown_ids: ['drilldown:inspect:u-1'],
        limitations: [],
      },
    ],
    action_candidates: [],
    drilldowns: [
      {
        kind: 'inspect_entities',
        drilldown_id: 'drilldown:inspect:u-1',
        label: 'Inspect U-1',
        context: { scope },
        entity_refs: [{ type: 'unit', key: 'U-1', label: 'U-1' }],
        filters: [{ dimension: 'status', value: 'available' }],
      },
    ],
  },
} as unknown as DecisionIntelligenceResponse;

describe('ReportDashboard', () => {
  it('renders a dashboard overview from decision intelligence and validated charts', () => {
    const html = renderToStaticMarkup(
      createElement(ReportDashboard, {
        payload,
        dataAsOf: '2026-09-20',
        decision,
        visualEvidence,
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('DASHBOARD SUMMARY');
    expect(html).toContain('data-dashboard-kpi="kpi:available_inventory"');
    expect(html).toContain('Inspect first');
    expect(html).toContain('Price distribution is unavailable.');
  });

  it('resolves a priority selection to the matching canonical unit detail', () => {
    const model = buildReportDashboardModel({
      payload,
      dataAsOf: '2026-09-20',
      decision,
      visualEvidence,
    });
    const detail = resolveReportDashboardDetail(model, {
      kind: 'priority',
      id: 'priority:unit:u-1',
    });
    expect(detail?.title).toBe('Inspect U-1');
    expect(detail?.units.map((unit) => unit.unit_external_id)).toEqual(['U-1']);
    expect(detail?.evidenceArtifactId).toBe(CALCULATION);
    expect(detail?.localFilterNote).toContain('local presentation filter');
  });

  it('accepts a controlled exact priority selection from workspace state', () => {
    const html = renderToStaticMarkup(
      createElement(ReportDashboard, {
        payload,
        dataAsOf: '2026-09-20',
        decision,
        visualEvidence,
        selection: { kind: 'priority', id: 'priority:unit:u-1' },
        onSelectionChange: () => undefined,
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('DRILL-DOWN DETAIL');
    expect(html).toContain('Inspect U-1');
  });

  it('resolves an active workspace drill-down through the published dashboard model', () => {
    const html = renderToStaticMarkup(
      createElement(ReportDashboard, {
        payload,
        dataAsOf: '2026-09-20',
        decision,
        visualEvidence,
        selection: null,
        activeDrilldownId: 'drilldown:inspect:u-1',
        onSelectionChange: () => undefined,
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('DRILL-DOWN DETAIL');
    expect(html).toContain('Inspect U-1');
  });

  it('maps dashboard selections explicitly without casting contract shapes', () => {
    const view = { kind: 'priority', id: 'priority:unit:u-1' } as const;
    expect(toWorkspaceDashboardSelection(view)).toEqual({
      kind: 'priority',
      priority_entity_id: 'priority:unit:u-1',
    });
    expect(
      toDashboardViewSelection({
        kind: 'chart',
        chart_id: 'inventory_trend',
      }),
    ).toEqual({ kind: 'chart', id: 'inventory_trend' });

    const model = buildReportDashboardModel({
      payload,
      dataAsOf: '2026-09-20',
      decision,
      visualEvidence,
    });
    expect(dashboardSelectionForDrilldown(model, 'drilldown:inspect:u-1')).toEqual(view);
  });

  it('keeps an unavailable legacy metric unavailable instead of turning it into zero', () => {
    const legacyPayload: ReportPayload = {
      ...payload,
      metrics: [{ ...payload.metrics[0]!, value: null, status: 'unavailable' }],
    };
    const model = buildReportDashboardModel({ payload: legacyPayload, dataAsOf: '2026-09-20' });
    expect(model.mode).toBe('legacy-report');
    expect(model.kpis[0]?.value).toBe('Unavailable');
    expect(model.kpis[0]?.available).toBe(false);
  });
});
