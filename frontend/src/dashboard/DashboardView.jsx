import React from "react";
import { Metric, PanelTitle } from "../shared/components.jsx";

export function DashboardView({ result, history }) {
  return (
    <section>
      <div className="section-header">
        <div>
          <h2>Dashboard</h2>
          <p>Overview of the latest profiling run, data quality status, and recent jobs.</p>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="Rows" value={result?.dataset_summary?.row_count ?? "-"} />
        <Metric label="Columns" value={result?.dataset_summary?.column_count ?? "-"} />
        <Metric label="Jobs" value={history.length} />
        <Metric label="Warnings" value={result?.quality_summary?.warning_count ?? "-"} />
      </div>
      <section className="panel">
        <PanelTitle title="Recent profiling jobs" aside={result?.source?.name || "No dataset profiled"} />
        {history.length ? <RecentJobs history={history} /> : <div className="empty-state">Open Data Workspace to choose a source and start profiling.</div>}
      </section>
    </section>
  );
}

function RecentJobs({ history }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Source</th><th>Rows</th><th>Columns</th><th>Generated</th></tr>
        </thead>
        <tbody>
          {history.slice(0, 5).map((job) => (
            <tr key={job.id}>
              <td>{job.sourceName}</td>
              <td>{job.rowCount}</td>
              <td>{job.columnCount}</td>
              <td>{new Date(job.generatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
