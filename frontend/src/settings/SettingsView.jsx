import React from "react";
import { PanelTitle } from "../shared/components.jsx";

export function SettingsView({ apiBase, setApiBase }) {
  return (
    <section className="panel">
      <PanelTitle title="Settings" aside="Frontend API target" />
      <label>
        API base URL
        <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
      </label>
      <div className="inline-status">Passwords and connection strings are never persisted by this frontend.</div>
    </section>
  );
}
