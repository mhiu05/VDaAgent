import React from "react";
import { BarChart3 } from "lucide-react";

export function ReportEmptyState() {
  return (
    <section className="report-page">
      <div className="report-empty-state large">
        <BarChart3 size={34} />
        <h2>No profiling report loaded</h2>
        <p>Run profiling from Data Workspace to generate a report from CSV, Excel, or a connected database table.</p>
      </div>
    </section>
  );
}
