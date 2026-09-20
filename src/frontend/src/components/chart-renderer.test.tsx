import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CHART_RULES_VERSION,
  CHART_SPEC_VERSION,
  ChartSpecSchema,
  type ChartSpec,
} from '@vda/contracts';
import { ChartRenderer, ChartUnavailableView } from './chart-renderer';
import { formatChartValue } from '../lib/chart-format';

const ARTIFACT = '50000000-0000-4000-8000-000000000002';

it('formats percent and percentage-point units distinctly', () => {
  expect(formatChartValue(12.5, 'percent')).toBe('12,5%');
  expect(formatChartValue(12.5, 'percentage_points')).toBe('12,5 pp');
});

function spec(chartType: ChartSpec['chart_type']): ChartSpec {
  const isKpi = chartType === 'kpi';
  const isLine = chartType === 'line';
  const isScatter = chartType === 'scatter';
  const data = isKpi
    ? [{ label: 'Current', value: 4 }]
    : isLine
      ? [
          { label: '2026-09-19', value: 3 },
          { label: '2026-09-20', value: 4 },
        ]
      : isScatter
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
    chart_id: `renderer_${chartType}`,
    intent: isKpi ? 'inventory_kpi' : isLine ? 'inventory_trend' : 'aging_distribution',
    chart_type: chartType,
    title: `${chartType} evidence`,
    subtitle: null,
    purpose: 'Renderer contract smoke test.',
    x_axis: isKpi
      ? null
      : {
          key: 'label',
          label: 'Label',
          value_type: isLine ? 'date' : isScatter ? 'number' : 'category',
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
      input_artifact_ids: [ARTIFACT],
      metric_keys: ['available_inventory'],
      bindings: data.flatMap((_, index) => [
        {
          data_index: index,
          data_key: 'value',
          artifact_id: ARTIFACT,
          evidence_path: `payload.values[${index}]`,
          metric_key: 'available_inventory',
        },
        ...(isScatter
          ? [
              {
                data_index: index,
                data_key: 'label',
                artifact_id: ARTIFACT,
                evidence_path: `payload.labels[${index}]`,
                metric_key: 'available_inventory' as const,
              },
            ]
          : []),
      ]),
    },
    limitations: [],
    generated_by: 'deterministic',
  });
}

describe('ChartRenderer', () => {
  it.each(['kpi', 'bar', 'line', 'pie', 'donut', 'scatter'] as const)(
    'renders the %s family from a validated ChartSpec',
    (chartType) => {
      const html = renderToStaticMarkup(createElement(ChartRenderer, { spec: spec(chartType) }));
      expect(html).toContain(`data-chart-id="renderer_${chartType}"`);
      expect(html).toContain(`${chartType} evidence`);
      expect(html).toContain(CHART_RULES_VERSION);
    },
  );

  it('renders an explicit unavailable state instead of a zero chart', () => {
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
    expect(html).toContain('INSUFFICIENT_HISTORY');
  });
});
