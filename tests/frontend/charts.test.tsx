import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CHART_RULES_VERSION,
  CHART_SPEC_VERSION,
  ChartSpecSchema,
  type ChartSpec,
} from '@vda/contracts';
import {
  ChartRenderer,
  ChartUnavailableView,
} from '../../src/frontend/components/visualization/chart-renderer';
import { formatChartValue } from '../../src/frontend/lib/chart-format';

const artifactId = '50000000-0000-4000-8000-000000000002';

function chart(chart_type: ChartSpec['chart_type']): ChartSpec {
  const line = chart_type === 'line';
  const scatter = chart_type === 'scatter';
  const kpi = chart_type === 'kpi';
  const data = kpi
    ? [{ label: 'Current', value: 4 }]
    : line
      ? [
          { label: '2026-09-19', value: 3 },
          { label: '2026-09-20', value: 4 },
        ]
      : scatter
        ? [
            { label: 1, value: 3 },
            { label: 2, value: 4 },
          ]
        : [
            { label: 'A', value: 3 },
            { label: 'B', value: 4 },
          ];
  return ChartSpecSchema.parse({
    version: CHART_SPEC_VERSION,
    rules_version: CHART_RULES_VERSION,
    chart_id: `renderer_${chart_type}`,
    intent: kpi ? 'inventory_kpi' : line ? 'inventory_trend' : 'aging_distribution',
    chart_type,
    title: `${chart_type} evidence`,
    subtitle: null,
    purpose: 'Renderer contract test.',
    x_axis: kpi
      ? null
      : {
          key: 'label',
          label: 'Label',
          value_type: line ? 'date' : scatter ? 'number' : 'category',
        },
    y_axis: { label: 'Units', unit: 'count', min: 0, max: null },
    series: [
      {
        key: 'value',
        label: 'Units',
        metric_key: 'available_inventory',
        unit: 'count',
        currency: null,
        value_format: 'integer',
        stack: null,
      },
    ],
    data,
    provenance: {
      input_artifact_ids: [artifactId],
      metric_keys: ['available_inventory'],
      bindings: data.flatMap((_, index) => [
        {
          data_index: index,
          data_key: 'value',
          artifact_id: artifactId,
          evidence_path: `payload.values[${index}]`,
          metric_key: 'available_inventory',
        },
        ...(scatter
          ? [
              {
                data_index: index,
                data_key: 'label',
                artifact_id: artifactId,
                evidence_path: `payload.labels[${index}]`,
                metric_key: 'available_inventory',
              },
            ]
          : []),
      ]),
    },
    limitations: [],
    generated_by: 'deterministic',
  });
}

describe('validated chart rendering', () => {
  it('separates relative percent from percentage points', () => {
    expect(formatChartValue(12.5, 'percent')).toBe('12,5%');
    expect(formatChartValue(12.5, 'percentage_points')).toBe('12,5 pp');
  });

  it.each(['kpi', 'bar', 'line', 'pie', 'donut', 'scatter'] as const)(
    'renders %s only from a schema-valid spec with provenance',
    (chartType) => {
      const html = renderToStaticMarkup(createElement(ChartRenderer, { spec: chart(chartType) }));
      expect(html).toContain(`data-chart-id="renderer_${chartType}"`);
      expect(html).toContain(chartType === 'kpi' ? 'Số căn còn hàng' : `${chartType} evidence`);
      expect(html).toContain(CHART_RULES_VERSION);
    },
  );

  it('renders an explicit unavailable state instead of a fabricated zero', () => {
    const html = renderToStaticMarkup(
      createElement(ChartUnavailableView, {
        state: {
          intent: 'inventory_trend',
          reason: 'INSUFFICIENT_HISTORY',
          message: 'At least two observations are required.',
          metric_keys: ['available_inventory'],
          limitations: [],
        },
      }),
    );
    expect(html).toContain('At least two observations are required.');
    expect(html).toContain('Thiếu dữ liệu lịch sử');
  });
});
