import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildCorrelationMatrix, buildTopCorrelationPairs, compactLabel, correlationColor, matrixKey } from "../utils/chartData.js";

export function CorrelationsPanel({ correlations, method, viewMode, setViewMode }) {
  const pairData = useMemo(() => buildTopCorrelationPairs(correlations), [correlations]);
  const matrix = useMemo(() => buildCorrelationMatrix(correlations), [correlations]);

  return (
    <section className="panel report-chart-panel correlations-panel">
      <div className="report-card-title split">
        <div>
          <h3>Correlations</h3>
          <span>{method || "pearson"} method</span>
        </div>
        {correlations?.length ? (
          <div className="chart-mode-toggle" aria-label="Correlation chart mode">
            <button className={viewMode === "matrix" ? "active" : ""} type="button" onClick={() => setViewMode("matrix")}>Matrix</button>
            <button className={viewMode === "pairs" ? "active" : ""} type="button" onClick={() => setViewMode("pairs")}>Top pairs</button>
          </div>
        ) : null}
      </div>
      {!correlations?.length ? <div className="chart-empty">No correlations returned by the backend.</div> : null}
      {correlations?.length && viewMode === "matrix" ? <MatrixHeatmap matrix={matrix} method={method} /> : null}
      {correlations?.length && viewMode === "pairs" ? <TopPairsChart data={pairData} method={method} /> : null}
    </section>
  );
}

function MatrixHeatmap({ matrix, method }) {
  if (matrix.columns.length < 3) {
    return <div className="chart-empty">Matrix needs at least three eligible numeric columns. Use Top pairs for this profile.</div>;
  }
  return (
    <div className="correlation-matrix-wrap">
      <div
        className="correlation-matrix"
        style={{ "--matrix-size": matrix.columns.length }}
        role="table"
        aria-label="Correlation matrix"
      >
        <span className="matrix-corner" />
        {matrix.columns.map((column) => (
          <span className="matrix-axis x-axis" key={`x-${column}`} title={column}>{compactLabel(column, 12)}</span>
        ))}
        {matrix.columns.map((row) => (
          <React.Fragment key={row}>
            <span className="matrix-axis y-axis" title={row}>{compactLabel(row, 14)}</span>
            {matrix.columns.map((column) => {
              const value = row === column ? 1 : matrix.lookup.get(matrixKey(row, column));
              const displayValue = value === undefined ? null : Number(value);
              const tooltip = `${row} vs ${column}: ${displayValue === null ? "N/A" : displayValue.toFixed(3)} (${method || "pearson"})`;
              return (
                <span
                  className={`matrix-cell ${displayValue === null ? "empty" : ""}`}
                  key={`${row}-${column}`}
                  style={{ background: correlationColor(displayValue) }}
                  title={tooltip}
                >
                  {displayValue === null ? "" : displayValue.toFixed(2)}
                </span>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function TopPairsChart({ data, method }) {
  if (!data.length) return <div className="chart-empty">No correlation pairs available.</div>;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 44, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#f3f2f1" horizontal={false} />
        <ReferenceLine x={0} stroke="#8a8886" strokeWidth={1.5} />
        <XAxis type="number" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="shortName" width={156} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<PairTooltip method={method} />} cursor={{ fill: "rgba(0, 120, 212, 0.06)" }} />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} barSize={18}>
          {data.map((entry) => <Cell key={entry.name} fill={entry.value >= 0 ? "#0F766E" : "#DC2626"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PairTooltip({ active, payload, method }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <span>{point.name}</span>
      <strong>{method || "pearson"}: {point.value}</strong>
      {point.strength ? <span>Strength: {point.strength}</span> : null}
    </div>
  );
}
