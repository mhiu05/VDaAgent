import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Fingerprint, Sigma } from "lucide-react";
import { buildQualityCharts, formatPercentValue } from "../utils/reportMetrics.js";
import { compactLabel } from "../utils/chartData.js";

export function QualityOverview({ columns, findings }) {
  const charts = useMemo(() => buildQualityCharts(columns, findings), [columns, findings]);
  return (
    <section className="quality-grid">
      <div className="panel report-chart-panel">
        <ChartTitle title="Column types" subtitle="Inferred schema mix" />
        {charts.columnTypes.length ? <TypeDistribution data={charts.columnTypes} /> : <ChartEmpty message="No column types returned." />}
      </div>
      <div className="panel report-chart-panel">
        <ChartTitle title="Missing values" subtitle="Highest null ratios" />
        {charts.missingColumns.length ? <MissingChart data={charts.missingColumns} /> : <ChartEmpty message="No missing values detected." />}
      </div>
      <div className="panel report-chart-panel">
        <ChartTitle title="Findings" subtitle="Grouped by severity" />
        <SeverityBars data={charts.severityCounts} />
      </div>
      <div className="panel report-chart-panel signal-panel">
        <ChartTitle title="Signals to review" subtitle="From returned profiling metadata" />
        <SignalList
          items={[
            { label: "Possible PII", value: charts.piiColumns.length, icon: Fingerprint, tone: "warn" },
            { label: "Outlier columns", value: charts.outlierColumns.length, icon: AlertTriangle, tone: "warn" },
            { label: "High cardinality", value: charts.highCardinality.length, icon: Sigma, tone: "info" },
            { label: "Low cardinality", value: charts.lowCardinality.length, icon: Sigma, tone: "good" },
          ]}
        />
      </div>
    </section>
  );
}

function ChartTitle({ title, subtitle }) {
  return (
    <div className="report-card-title">
      <h3>{title}</h3>
      <span>{subtitle}</span>
    </div>
  );
}

function TypeDistribution({ data }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#f3f2f1" vertical={false} />
        <XAxis dataKey="name" tickFormatter={(value) => compactLabel(value, 10)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis width={28} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<SimpleTooltip label="Columns" />} cursor={{ fill: "rgba(0, 120, 212, 0.06)" }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#0078d4" maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MissingChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 42, left: 12, bottom: 0 }}>
        <CartesianGrid stroke="#f3f2f1" horizontal={false} />
        <XAxis type="number" domain={[0, 1]} tickFormatter={(value) => `${value * 100}%`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tickFormatter={(value) => compactLabel(value, 16)} width={104} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<PercentTooltip />} cursor={{ fill: "rgba(245, 158, 11, 0.07)" }} />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} fill="#f59e0b" barSize={15} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SeverityBars({ data }) {
  const colors = { critical: "#c4314b", warning: "#f59e0b", info: "#0078d4" };
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#f3f2f1" vertical={false} />
        <XAxis dataKey="severity" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis width={28} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<SimpleTooltip label="Findings" />} cursor={{ fill: "rgba(0, 120, 212, 0.06)" }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={54}>
          {data.map((entry) => <Cell key={entry.severity} fill={colors[entry.severity]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SignalList({ items }) {
  return (
    <div className="signal-list">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={`signal-row ${item.tone}`} key={item.label}>
            <span><Icon size={15} /> {item.label}</span>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function SimpleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{payload[0].payload.name || payload[0].payload.severity}</span>
      <strong>{label}: {payload[0].value}</strong>
    </div>
  );
}

function PercentTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{payload[0].payload.name}</span>
      <strong>Missing: {formatPercentValue(payload[0].value)}</strong>
    </div>
  );
}

function ChartEmpty({ message }) {
  return <div className="chart-empty small">{message}</div>;
}
