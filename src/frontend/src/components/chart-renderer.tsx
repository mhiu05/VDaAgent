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
import { formatSeriesValue } from '../lib/chart-format';

const COLORS = ['#197c69', '#3b8fbe', '#d97706', '#7c3aed', '#be4858', '#54706d'];

function tooltipFormatter(spec: ChartSpec) {
  return (value: unknown, name: unknown): [string, string] => {
    const item = spec.series.find((series) => series.key === String(name));
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
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e6eceb" />
      <XAxis
        dataKey={spec.x_axis!.key}
        type={spec.x_axis!.value_type === 'number' ? 'number' : 'category'}
        tick={{ fontSize: 11, fill: '#697c7a' }}
        axisLine={false}
        tickLine={false}
        interval={0}
      />
      <YAxis
        type="number"
        domain={[spec.y_axis?.min ?? 'auto', spec.y_axis?.max ?? 'auto']}
        allowDecimals={spec.series.some((series) => series.value_format !== 'integer')}
        tickFormatter={(value: number) => formatSeriesValue(value, item)}
        tick={{ fontSize: 11, fill: '#697c7a' }}
        axisLine={false}
        tickLine={false}
        width={72}
      />
      <Tooltip formatter={tooltipFormatter(spec)} />
      {spec.series.length > 1 && <Legend />}
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
        <Axes spec={spec} />
        {spec.series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.key}
            stackId={item.stack ?? undefined}
            fill={COLORS[index % COLORS.length]}
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
            name={item.key}
            stroke={COLORS[index % COLORS.length]}
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
        <Pie
          data={spec.data}
          dataKey={item.key}
          nameKey={spec.x_axis!.key}
          innerRadius={spec.chart_type === 'donut' ? '48%' : 0}
          outerRadius="78%"
          paddingAngle={2}
        >
          {spec.data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={tooltipFormatter(spec)} />
        <Legend />
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
            name={item.key}
            data={spec.data}
            dataKey={item.key}
            fill={COLORS[index % COLORS.length]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ChartUnavailableView({ state }: { state: ChartUnavailable }) {
  return (
    <section className="chart-unavailable" role="status">
      <strong>{state.intent.replaceAll('_', ' ')}</strong>
      <span>{state.message}</span>
      <code>{state.reason}</code>
    </section>
  );
}

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  return (
    <section className={`chart-spec chart-${spec.chart_type}`} data-chart-id={spec.chart_id}>
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
    </section>
  );
}
