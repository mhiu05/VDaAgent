import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactOf,
  CalculationPayload,
  DecisionBriefResponse,
  DecisionSignal,
} from '@vda/contracts';
import { AnalysisResult } from '../../src/frontend/features/analysis/components/analysis-result';

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const calculationId = '50000000-0000-4000-8000-000000000001';
const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };
const signal: DecisionSignal = {
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
  evidence: [{ role: 'current', artifact_id: calculationId, path: 'payload.metrics[0].value' }],
};
const brief: DecisionBriefResponse = {
  run_id: runId,
  org_id: orgId,
  scope,
  requested_data_as_of: '2026-09-20',
  effective_snapshot_date: '2026-09-19',
  decision_brief: {
    version: 'decision-brief-v1',
    scope,
    requested_data_as_of: '2026-09-20',
    effective_snapshot_date: '2026-09-19',
    current_state: [signal],
    material_changes: [],
    where_to_look: [],
    data_quality: [],
    next_actions: [
      {
        action_id: 'review_inventory_units',
        kind: 'review_inventory_units',
        label: 'Review inventory units',
        target_signal_id: null,
        artifact_id: calculationId,
      },
    ],
    limitations: [],
  },
  report_artifact_id: '50000000-0000-4000-8000-000000000002',
  calculation_artifact_id: calculationId,
  evidence_artifact_ids: [calculationId],
  validations: [
    {
      artifact_id: calculationId,
      org_id: orgId,
      run_id: runId,
      validated_at: '2026-09-20T00:00:00Z',
      validator_version: 'mvp-validator-v1',
      valid: true,
      checks: ['schema'],
    },
  ],
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
const legacyCalculation: ArtifactOf<'calculation'> = {
  artifact_id: calculationId,
  org_id: orgId,
  run_id: runId,
  task_id: '60000000-0000-4000-8000-000000000001',
  kind: 'calculation',
  schema_version: '1.1',
  created_at: '2026-09-20T00:00:00Z',
  semantic_version: 'mvp-inventory-v0.2',
  provisional: true,
  data_as_of: '2026-09-20',
  input_refs: [],
  snapshot_refs: [calculation.units[0]!.snapshot_id],
  source_refs: [calculation.units[0]!.import_id],
  limitations: [],
  content_hash: 'a'.repeat(64),
  payload: calculation,
};
const render = (props: Partial<Parameters<typeof AnalysisResult>[0]> = {}) =>
  renderToStaticMarkup(<AnalysisResult artifacts={[]} onEvidence={() => undefined} {...props} />);

describe('analysis result states', () => {
  it('shows loading and missing-brief states explicitly', () => {
    expect(render({ briefStatus: 'loading' })).toContain('Đang tải tóm tắt quyết định');
    expect(render({ briefStatus: 'unavailable' })).toContain('chưa có tóm tắt quyết định');
  });

  it('renders a completed brief before detailed artifacts are loaded', () => {
    const html = render({ brief, briefStatus: 'available', onLoadDetails: () => undefined });
    for (const label of [
      'Tóm tắt quyết định',
      'Hiện trạng',
      'Thay đổi đáng kể',
      'Khu vực cần xem',
      'Chất lượng dữ liệu',
      'Tải kết quả chi tiết',
    ])
      expect(html).toContain(label);
    expect(html).toContain('2026-09-20');
    expect(html).toContain('2026-09-19');
  });

  it('offers signal actions using canonical references', () => {
    const zone: DecisionSignal = {
      ...signal,
      signal_id: 'segment_concentration:available_inventory',
      kind: 'segment_concentration',
      dimension: 'zone',
      segment_key: 'Z-NORTH',
    };
    const html = render({
      brief: { ...brief, decision_brief: { ...brief.decision_brief, where_to_look: [zone] } },
      briefStatus: 'available',
      canInspect: true,
      onInspectSignal: () => undefined,
      onAnalyzeSegment: () => undefined,
    });
    expect(html).toContain('Xem tín hiệu');
    expect(html).toContain('Phân tích khu vực này');
  });

  it('retains a historical calculation when the newer brief is unavailable', () => {
    const html = render({ artifacts: [legacyCalculation], briefStatus: 'unavailable' });
    expect(html).toContain('chưa có tóm tắt quyết định');
    expect(html).toContain('U-1');
  });
});
