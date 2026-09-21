import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactOf,
  CalculationPayload,
  DecisionBriefResponse,
  DecisionSignal,
} from '@vda/contracts';
import { AnalysisResult } from './analysis-result';

const ORG = '10000000-0000-4000-8000-000000000001';
const RUN = '20000000-0000-4000-8000-000000000001';
const CALCULATION = '50000000-0000-4000-8000-000000000001';
const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };
const currentSignal: DecisionSignal = {
  signal_id: 'current_state:available_inventory',
  rule_id: 'mvp-inventory-v0.2:current_state:available_inventory',
  kind: 'current_state',
  label: 'Available inventory',
  summary: 'Available inventory: 1.',
  metric_key: 'available_inventory',
  dimension: null,
  segment_key: null,
  current_value: 1,
  comparison_value: null,
  delta: null,
  support_value: null,
  denominator_value: null,
  unit: 'count',
  delta_unit: null,
  currency: null,
  status: 'available',
  abstention_reason: null,
  limitations: [],
  evidence: [{ role: 'current', artifact_id: CALCULATION, path: 'payload.metrics[0].value' }],
};
const calculation: CalculationPayload = {
  metrics: [],
  units: [
    {
      unit_external_id: 'U-1',
      unit_code: 'U-1',
      project_external_id: 'P-ALPHA',
      zone_external_id: 'Z-NORTH',
      unit_type: 'apartment',
      currency: 'VND',
      status: 'available',
      area_sqm: '100',
      list_price: '3000000000',
      price_per_sqm: '30000000.000000',
      age_days: 110,
      slow_moving: true,
      snapshot_id: '40000000-0000-4000-8000-000000000001',
      import_id: '30000000-0000-4000-8000-000000000001',
    },
  ],
  slow_moving_threshold_days: 90,
  current_snapshot_date: '2026-09-19',
  quality_limitations: [],
  age_buckets: [],
  breakdowns: [],
  period_comparisons: [],
  segment_comparisons: [],
  notable_changes: [],
  insight_candidates: [],
};
const snapshot = {
  snapshot_id: '40000000-0000-4000-8000-000000000001',
  import_id: '30000000-0000-4000-8000-000000000001',
};
const response: DecisionBriefResponse = {
  run_id: RUN,
  org_id: ORG,
  scope,
  requested_data_as_of: '2026-09-20',
  effective_snapshot_date: '2026-09-19',
  decision_brief: {
    version: 'decision-brief-v1',
    scope,
    requested_data_as_of: '2026-09-20',
    effective_snapshot_date: '2026-09-19',
    current_state: [currentSignal],
    material_changes: [],
    where_to_look: [],
    data_quality: [],
    next_actions: [
      {
        action_id: 'review_inventory_units',
        kind: 'review_inventory_units',
        label: 'Review inventory units',
        target_signal_id: null,
        artifact_id: CALCULATION,
      },
    ],
    limitations: [],
  },
  report_artifact_id: '50000000-0000-4000-8000-000000000002',
  calculation_artifact_id: CALCULATION,
  evidence_artifact_ids: [CALCULATION],
  validations: [
    {
      artifact_id: CALCULATION,
      org_id: ORG,
      run_id: RUN,
      validated_at: '2026-09-20T00:00:00.000Z',
      validator_version: 'mvp-validator-v1',
      valid: true,
      checks: ['schema'],
    },
  ],
};

describe('AnalysisResult decision briefing states', () => {
  it('renders a loading state before the slim briefing is available', () => {
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        artifacts: [],
        briefStatus: 'loading',
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('Loading the validated decision briefing');
  });

  it('renders the completed brief before loading detailed artifacts', () => {
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        artifacts: [],
        brief: response,
        briefStatus: 'available',
        onEvidence: () => undefined,
        onLoadDetails: () => undefined,
      }),
    );
    expect(html).toContain('Decision briefing');
    expect(html).toContain('Current state');
    expect(html).toContain('Material change');
    expect(html).toContain('Where to look');
    expect(html).toContain('Data quality');
    expect(html).toContain('2026-09-20');
    expect(html).toContain('2026-09-19');
    expect(html).toContain('Load detailed results');
  });

  it('renders canonical signal actions without embedding signal values in chat state', () => {
    const zoneSignal: DecisionSignal = {
      ...currentSignal,
      signal_id: 'segment_concentration:available_inventory',
      kind: 'segment_concentration',
      dimension: 'zone',
      segment_key: 'Z-NORTH',
    };
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        artifacts: [],
        brief: {
          ...response,
          decision_brief: { ...response.decision_brief, where_to_look: [zoneSignal] },
        },
        briefStatus: 'available',
        canInspect: true,
        onEvidence: () => undefined,
        onInspectSignal: () => undefined,
        onAnalyzeSegment: () => undefined,
      }),
    );
    expect(html).toContain('Inspect');
    expect(html).toContain('Analyze this zone');
  });

  it('shows an explicit unavailable state while historical details load', () => {
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        artifacts: [],
        briefStatus: 'unavailable',
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('has no Decision Briefing');
  });

  it('falls back to the existing result hierarchy for an old run', () => {
    const artifact: ArtifactOf<'calculation'> = {
      artifact_id: CALCULATION,
      org_id: ORG,
      run_id: RUN,
      task_id: '60000000-0000-4000-8000-000000000001',
      kind: 'calculation',
      schema_version: '1.1',
      created_at: '2026-09-20T00:00:00.000Z',
      semantic_version: 'mvp-inventory-v0.2',
      provisional: true,
      data_as_of: '2026-09-20',
      input_refs: [],
      snapshot_refs: [snapshot.snapshot_id],
      source_refs: [snapshot.import_id],
      limitations: [],
      content_hash: 'a'.repeat(64),
      payload: calculation,
    };
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        artifacts: [artifact],
        briefStatus: 'unavailable',
        onEvidence: () => undefined,
      }),
    );
    expect(html).toContain('historical run has no Decision Briefing');
    expect(html).toContain('U-1');
  });
});
