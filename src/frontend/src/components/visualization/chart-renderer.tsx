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
import { formatSeriesValue } from '../../lib/chart-format';

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

function BarView({ spec }: { spec: ChartSpec }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={spec.data} accessibilityLayer>
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
      <strong>{intentLabels[state.intent] ?? state.intent.replaceAll('_', ' ')}</strong>
      <span>{state.message}</span>
      <code>{state.reason}</code>
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
  const content = (
    <>
      <header className="chart-spec-heading">
        <div>
          <h3>{spec.title}</h3>
          {spec.subtitle && <p>{spec.subtitle}</p>}
        </div>
        <span className="badge">{spec.rules_version}</span>
      </header>
      {spec.chart_type === 'kpi' ? (
        <KpiView spec={spec} />
      ) : (
        <div className="chart-container">
          {spec.chart_type === 'bar' && <BarView spec={spec} />}
          {spec.chart_type === 'line' && <LineView spec={spec} />}
          {(spec.chart_type === 'pie' || spec.chart_type === 'donut') && <PieView spec={spec} />}
          {spec.chart_type === 'scatter' && <ScatterView spec={spec} />}
        </div>
      )}
      <p className="chart-purpose">{spec.purpose}</p>
      {!!spec.limitations.length && (
        <ul className="chart-limitations">
          {spec.limitations.map((item) => (
            <li key={item}>{item}</li>
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
        aria-label={`Xem chi tiết biểu đồ: ${spec.title}`}
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
