'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec, ChartUnavailable } from '@vda/contracts';
import { localizeLegacyChartText, localizeLegacyLimitation, localizedMetricDescription, localizedMetricLabel } from '../../lib/format/analysis-copy';
import { formatSeriesValue } from '../../lib/chart-format';
import { workflowStatusLabel } from '../../lib/format/status-label';

const COLORS = [
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-4)',
  'var(--chart-series-5)',
  'var(--chart-series-6)',
];
const SYMBOLS = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross'] as const;
const LINE_PATTERNS = ['', '6 3', '2 3', '9 3 2 3', '1 2', '7 2 1 2'];
const BAR_PATTERN_PATHS = [
  'M-2 6 6-2M2 10 10 2',
  'M0 3h6M0 7h6',
  'M3 0v6M7 0v6',
  'M-2 6 6-2M2 10 10 2M-2 2 2 6M6 6 10 10',
  'M1 1h1v1H1zM5 5h1v1H5z',
  'M-2 6 6-2M2 10 10 2M0 3h6M0 7h6',
];

function SeriesPatterns({ spec }: { spec: ChartSpec }) {
  return (
    <defs>
      {spec.series.map((series, index) => (
        <pattern
          key={series.key}
          id={`chart-${spec.chart_id}-series-${index}`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill={COLORS[index % COLORS.length]} />
          <path
            d={BAR_PATTERN_PATHS[index % BAR_PATTERN_PATHS.length]}
            stroke="var(--color-ink)"
            strokeOpacity="0.3"
            strokeWidth="1"
          />
        </pattern>
      ))}
    </defs>
  );
}

function CategoryPatterns({ spec }: { spec: ChartSpec }) {
  return (
    <defs>
      {spec.data.map((_, index) => (
        <pattern
          key={index}
          id={`chart-${spec.chart_id}-category-${index}`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill={COLORS[index % COLORS.length]} />
          <path
            d={BAR_PATTERN_PATHS[index % BAR_PATTERN_PATHS.length]}
            stroke="var(--color-ink)"
            strokeOpacity="0.3"
            strokeWidth="1"
          />
        </pattern>
      ))}
    </defs>
  );
}

const tooltipStyle = {
  backgroundColor: 'var(--chart-tooltip)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-ui)',
  boxShadow: 'var(--shadow-raised)',
};

const legendStyle = {
  color: 'var(--color-ink-soft)',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-xs)',
};

function tooltipFormatter(spec: ChartSpec) {
  return (value: unknown, name: unknown): [string, string] => {
    const item = spec.series.find(
      (series) => series.key === String(name) || series.label === String(name),
    );
    const raw = Array.isArray(value) ? value[0] : value;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    return [
      item && Number.isFinite(numeric) ? formatSeriesValue(numeric, item) : String(raw),
      item?.label ?? String(name),
    ];
  };
}

function Axes({ spec }: { spec: ChartSpec }) {
  const item = spec.series[0];
  return (
    <>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey={spec.x_axis!.key}
        type={spec.x_axis!.value_type === 'number' ? 'number' : 'category'}
        tick={{ fontSize: 12, fill: 'var(--chart-axis)' }}
        axisLine={false}
        tickLine={false}
        interval={0}
      />
      <YAxis
        type="number"
        domain={[spec.y_axis?.min ?? 'auto', spec.y_axis?.max ?? 'auto']}
        allowDecimals={spec.series.some((series) => series.value_format !== 'integer')}
        tickFormatter={(value: number) => formatSeriesValue(value, item)}
        tick={{ fontSize: 12, fill: 'var(--chart-axis)' }}
        axisLine={false}
        tickLine={false}
        width={72}
      />
      <Tooltip formatter={tooltipFormatter(spec)} contentStyle={tooltipStyle} itemStyle={legendStyle} />
      {spec.series.length > 1 && <Legend wrapperStyle={legendStyle} />}
    </>
  );
}

function KpiView({ spec }: { spec: ChartSpec }) {
  const value = spec.data[0][spec.series[0].key];
  return (
    <div className="kpi-visual">
      <strong>{formatSeriesValue(typeof value === 'number' ? value : null, spec.series[0])}</strong>
      <span>{spec.series[0].label}</span>
    </div>
  );
}

function displayChartData(spec: ChartSpec) {
  if (spec.chart_id !== 'aging_distribution') return spec.data;
  return spec.data.map((item) => item.bucket === 'unknown' ? { ...item, bucket: 'Chưa xác định' } : item);
}

function BarView({ spec }: { spec: ChartSpec }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={displayChartData(spec)} accessibilityLayer>
        <SeriesPatterns spec={spec} />
        <Axes spec={spec} />
        {spec.series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            stackId={item.stack ?? undefined}
            fill={`url(#chart-${spec.chart_id}-series-${index})`}
            legendType={SYMBOLS[index % SYMBOLS.length]}
            radius={[5, 5, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineView({ spec }: { spec: ChartSpec }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={spec.data} accessibilityLayer>
        <Axes spec={spec} />
        {spec.series.map((item, index) => (
          <Line
            key={item.key}
            dataKey={item.key}
            name={item.label}
            stroke={COLORS[index % COLORS.length]}
            strokeDasharray={LINE_PATTERNS[index % LINE_PATTERNS.length] || undefined}
            strokeWidth={3}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieView({ spec }: { spec: ChartSpec }) {
  const item = spec.series[0];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart accessibilityLayer>
        <CategoryPatterns spec={spec} />
        <Pie
          data={spec.data}
          dataKey={item.key}
          nameKey={spec.x_axis!.key}
          innerRadius={spec.chart_type === 'donut' ? '48%' : 0}
          outerRadius="78%"
          paddingAngle={2}
        >
          {spec.data.map((_, index) => (
            <Cell
              key={index}
              fill={`url(#chart-${spec.chart_id}-category-${index})`}
              stroke="var(--color-surface)"
              strokeWidth={1}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: unknown, name: unknown) => {
            const raw = Array.isArray(value) ? value[0] : value;
            const numeric = typeof raw === 'number' ? raw : Number(raw);
            return [
              Number.isFinite(numeric) ? formatSeriesValue(numeric, item) : String(raw),
              String(name),
            ];
          }}
          contentStyle={tooltipStyle}
          itemStyle={legendStyle}
        />
        <Legend wrapperStyle={legendStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ScatterView({ spec }: { spec: ChartSpec }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart accessibilityLayer>
        <Axes spec={spec} />
        {spec.series.map((item, index) => (
          <Scatter
            key={item.key}
            name={item.label}
            data={spec.data}
            dataKey={item.key}
            fill={COLORS[index % COLORS.length]}
            shape={SYMBOLS[index % SYMBOLS.length]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ChartUnavailableView({ state }: { state: ChartUnavailable }) {
  const intentLabels: Record<string, string> = {
    inventory_kpi: 'Chỉ số tồn kho',
    inventory_trend: 'Xu hướng tồn kho',
    aging_distribution: 'Phân bố tuổi tồn kho',
    slow_moving_by_segment: 'Sản phẩm chậm luân chuyển theo phân khu',
    inventory_composition: 'Cơ cấu tồn kho',
    price_distribution: 'Phân bố giá',
    peer_comparison: 'So sánh nhóm tương đồng',
    numeric_relationship: 'Mối quan hệ giữa các chỉ số',
  };
  return (
    <section className="chart-unavailable" role="status">
      <strong>{intentLabels[state.intent] ?? 'Biểu đồ phân tích'}</strong>
      <span>{localizeLegacyChartText(state.message)}</span>
      <span>{workflowStatusLabel(state.reason)}</span>
    </section>
  );
}

export function ChartRenderer({
  spec,
  onDrilldown,
}: {
  spec: ChartSpec;
  onDrilldown?: () => void;
}) {
  const displaySpec: ChartSpec = {
    ...spec,
    title: spec.chart_type === 'kpi'
      ? localizedMetricLabel(spec.series[0]?.metric_key ?? '', spec.title)
      : localizeLegacyChartText(spec.title),
    subtitle: spec.subtitle ? localizeLegacyChartText(spec.subtitle) : null,
    purpose: spec.chart_type === 'kpi' && spec.series[0]?.metric_key
      ? localizedMetricDescription(spec.series[0].metric_key, spec.purpose)
      : localizeLegacyChartText(spec.purpose),
    x_axis: spec.x_axis
      ? { ...spec.x_axis, label: spec.x_axis.label ? localizeLegacyChartText(spec.x_axis.label) : null }
      : spec.x_axis,
    y_axis: spec.y_axis
      ? {
          ...spec.y_axis,
          label: spec.intent !== 'peer_comparison' && spec.series[0]?.metric_key
            ? localizedMetricLabel(spec.series[0].metric_key, spec.y_axis.label ?? undefined)
            : spec.y_axis.label ? localizeLegacyChartText(spec.y_axis.label) : null,
        }
      : spec.y_axis,
    series: spec.series.map((series) => ({
      ...series,
      label: spec.intent === 'peer_comparison'
        ? localizeLegacyChartText(series.label)
        : localizedMetricLabel(series.metric_key ?? '', series.label),
    })),
  };
  const content = (
    <>
      <header className="chart-spec-heading">
        <div>
          <h3>{displaySpec.title}</h3>
          {displaySpec.subtitle && <p>{displaySpec.subtitle}</p>}
        </div>
        <span className="badge">{spec.rules_version}</span>
      </header>
      {spec.chart_type === 'kpi' ? (
        <KpiView spec={displaySpec} />
      ) : (
        <div className="chart-container">
          {spec.chart_type === 'bar' && <BarView spec={displaySpec} />}
          {spec.chart_type === 'line' && <LineView spec={displaySpec} />}
          {(spec.chart_type === 'pie' || spec.chart_type === 'donut') && <PieView spec={displaySpec} />}
          {spec.chart_type === 'scatter' && <ScatterView spec={displaySpec} />}
        </div>
      )}
      <p className="chart-purpose">{displaySpec.purpose}</p>
      {!!spec.limitations.length && (
        <ul className="chart-limitations">
          {spec.limitations.map((item) => (
            <li key={item}>{localizeLegacyLimitation(item)}</li>
          ))}
        </ul>
      )}
    </>
  );
  if (onDrilldown)
    return (
      <button
        className={`chart-spec chart-${spec.chart_type} chart-spec-interactive`}
        data-chart-id={spec.chart_id}
        type="button"
        onClick={onDrilldown}
        aria-label={`Xem chi tiết biểu đồ: ${displaySpec.title}`}
      >
        {content}
      </button>
    );
  return (
    <section className={`chart-spec chart-${spec.chart_type}`} data-chart-id={spec.chart_id}>
      {content}
    </section>
  );
}
