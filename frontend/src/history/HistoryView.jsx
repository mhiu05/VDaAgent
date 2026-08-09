import React from "react";
import { PanelTitle } from "../shared/components.jsx";

export function HistoryView({ history }) {
  return (
    <section className="panel">
      <PanelTitle title="Profiling history" aside={`${history.length} jobs`} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Rows</th>
              <th>Columns</th>
              <th>Generated at</th>
            </tr>
          </thead>
          <tbody>
            {history.length ? history.map((job) => (
              <tr key={job.id}>
                <td>{job.sourceName}</td>
                <td>{job.rowCount}</td>
                <td>{job.columnCount}</td>
                <td>{job.generatedAt}</td>
              </tr>
            )) : (
              <tr><td colSpan="4" className="empty-cell">No profiling jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
