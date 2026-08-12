import React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactLabel } from "../utils/chartData.js";

export function TopValuesChart({ column, height = 220 }) {
  if (!column?.top_values?.length) return <div className="chart-empty small">No categorical top values available.</div>;
  const data = column.top_values.map((item) => ({
    name: String(item.value),
    shortName: compactLabel(String(item.value), 16),
    count: item.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 14, right: 28, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#f3f2f1" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="shortName" width={112} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<TopValuesTooltip />} cursor={{ fill: "rgba(15, 118, 110, 0.08)" }} />
        <Bar dataKey="count" fill="#0F766E" radius={[4, 4, 4, 4]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopValuesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{payload[0].payload.name}</span>
      <strong>Count: {payload[0].value}</strong>
    </div>
  );
}
