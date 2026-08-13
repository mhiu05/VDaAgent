import React, { useEffect, useState } from "react";
import { CheckCircle2, PlugZap } from "lucide-react";
import { PanelTitle } from "../shared/components.jsx";

export function SettingsView({ apiBase, setApiBase, userWorkspace, updateUserWorkspace, userRules = [] }) {
  const [displayName, setDisplayName] = useState(userWorkspace?.display_name || "Analyst");
  const [role, setRole] = useState(userWorkspace?.role || "data_analyst");

  useEffect(() => {
    setDisplayName(userWorkspace?.display_name || "Analyst");
    setRole(userWorkspace?.role || "data_analyst");
  }, [userWorkspace]);

  return (
    <section className="settings-page">
      <div className="section-header compact-page-header">
        <div>
          <h2>Settings</h2>
          <p>Configure frontend runtime options for the profiling workspace.</p>
        </div>
      </div>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          <button className="active" type="button">General</button>
          <button type="button">Profiling Rules</button>
          <button type="button">Integrations</button>
          <button type="button">Audit Access</button>
        </nav>
        <div className="settings-content">
          <section className="panel">
            <PanelTitle title="General Configuration" aside="Frontend API target" />
            <label>
              API base URL
              <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
            </label>
            <div className="inline-status status-info">Connection fields are stored locally for the MVP workflow. Treat browser storage as development-only.</div>
          </section>

          <section className="panel settings-tool-panel">
            <PanelTitle title="External tools" aside="MCP connectors" />
            <div className="settings-tool-row">
              <span className="settings-tool-icon"><PlugZap size={18} /></span>
              <div>
                <strong>Google Stitch MCP</strong>
                <p>Configured in the Codex global MCP config. Restart Codex to expose Stitch tools in a new session.</p>
              </div>
              <span className="settings-tool-status"><CheckCircle2 size={15} /> Configured</span>
            </div>
          </section>

          <section className="panel settings-grid-panel">
            <PanelTitle title="User workspace" aside={userWorkspace?.user_id || "browser user"} />
            <div className="form-grid">
              <label>
                Display name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label>
                Role
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="data_analyst">Data Analyst</option>
                  <option value="data_steward">Data Steward</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => updateUserWorkspace?.({ display_name: displayName, role })}>
                Save workspace
              </button>
            </div>
          </section>

          <section className="panel">
            <PanelTitle title="Confirmed rules" aside={`${userRules.length} rule(s)`} />
            {userRules.length ? (
              <div className="settings-rule-list">
                {userRules.map((rule) => (
                  <article key={rule.id}>
                    <strong>{rule.rule_type}</strong>
                    <p>{rule.description}</p>
                    <small>{[rule.source_name, rule.column].filter(Boolean).join(" / ") || "Global rule"}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">Confirmed HITL and profiling plan decisions will appear here as reusable metadata.</div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
