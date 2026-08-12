import React from "react";
import { PanelTitle } from "../shared/components.jsx";

export function SettingsView({ apiBase, setApiBase }) {
  return (
    <section className="settings-page">
      <div className="section-header compact-page-header">
        <div>
          <h2>Settings</h2>
          <p>Configure frontend runtime options for the profiling workspace.</p>
        </div>
      </div>
      <section className="panel">
        <PanelTitle title="API connection" aside="Frontend API target" />
        <label>
          API base URL
          <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
        </label>
        <div className="inline-status status-info">Connection fields are stored locally for the MVP workflow. Treat browser storage as development-only.</div>
      </section>
    </section>
  );
}
