import React, { useState } from "react";
import { PanelTitle } from "../shared/components.jsx";
import { sectionOptions } from "../utils/options.js";

export function ProfilingView({
  files,
  selectedTables = [],
  selectedSections,
  setSelectedSections,
  schema,
  dbProfileProgress,
  runFullProfile,
  profileSelectedDbTable,
  profileDbQuery,
  dbInputMode,
  dbQuery,
  customRequirements,
  setCustomRequirements,
  knowledgeDocs = [],
  uploadKnowledgeDocs,
  profilingPlan,
  generateProfilingPlan,
  confirmProfilingPlan,
  userRules = [],
}) {
  const [samplingEnabled, setSamplingEnabled] = useState(false);
  const fileCount = Array.from(files || []).length;
  const dbTableCount = selectedTables.length;
  const isDatabaseRun = dbTableCount > 0;
  const isQueryRun = dbInputMode === "query" && Boolean(dbQuery?.trim());
  const sourceAside = isDatabaseRun
    ? `${dbTableCount} table(s)`
    : isQueryRun
      ? "SQL query"
    : fileCount
      ? `${fileCount} source(s)`
      : "No dataset selected";
  const runLabel = isDatabaseRun ? "Profile selected table(s)" : isQueryRun ? "Profile query" : "Run full profile";
  const runAction = isDatabaseRun ? profileSelectedDbTable : isQueryRun ? profileDbQuery : runFullProfile;

  return (
    <>
    <section className="profiling-config-grid">
      <section className="panel">
        <PanelTitle
          title="Profile output"
          aside={sourceAside}
        />
        {(isDatabaseRun || isQueryRun) && (
          <div className="selected-db-summary">
            <strong>{isQueryRun ? "Previewed SQL query" : "Selected database tables"}</strong>
            <div>
              {isQueryRun ? (
                <span>{dbQuery}</span>
              ) : (
                <>
                  {selectedTables.slice(0, 8).map((table) => (
                    <span key={`${table.schema_name}.${table.table_name}`}>
                      {table.schema_name}.{table.table_name}
                    </span>
                  ))}
                  {selectedTables.length > 8 && <span>+{selectedTables.length - 8} more</span>}
                </>
              )}
            </div>
          </div>
        )}
        <div className="section-chips">
          {sectionOptions.map((section) => (
            <label key={section} className="chip-check" title={sectionTooltip(section)}>
              <input
                type="checkbox"
                checked={selectedSections.includes(section)}
                onChange={(event) => {
                  setSelectedSections((current) => event.target.checked
                    ? [...current, section]
                    : current.filter((item) => item !== section));
                }}
              />
              {section}
            </label>
          ))}
        </div>
        <p className="helper-text">
          {isDatabaseRun
            ? "Selected sections control what appears in the database profiling report."
            : isQueryRun
              ? "Selected sections control what appears in the query profiling report."
            : "Selected columns in Dataset Explorer are used for preview and report filtering."}
        </p>
      </section>

      <section className="panel">
        <PanelTitle title="Run configuration" aside={`${schema?.length || 0} columns`} />
        <div className="compact-config-grid">
          {["Basic statistics", "Null analysis", "Distinct analysis", "Pattern detection"].map((label) => (
            <label className="check-row" key={label} title={runOptionTooltip(label)}><input type="checkbox" defaultChecked /> {label}</label>
          ))}
        </div>
        <label className="check-row sampling-toggle" title="Use a sample instead of the full dataset when supported. Useful for very large sources.">
          <input type="checkbox" checked={samplingEnabled} onChange={(event) => setSamplingEnabled(event.target.checked)} />
          Sampling
        </label>
        <div className={`sampling-fields ${samplingEnabled ? "" : "disabled"}`}>
          <label title="Maximum number of rows to sample when sampling is enabled.">Sample size <input type="number" defaultValue="10000" disabled={!samplingEnabled} /></label>
        </div>
        <label title="Percentage of null values at which a column should be treated as a warning.">Null warning threshold <input type="number" defaultValue="10" /></label>
        {dbProfileProgress && (
          <div className="db-profile-progress compact-progress" role="status" aria-live="polite">
            <div className="db-profile-progress-header">
              <strong>Profiling database tables</strong>
              <span>{dbProfileProgress.current}/{dbProfileProgress.total}</span>
            </div>
            <div className="progress-bar">
              <i style={{ width: `${dbProfileProgress.total ? Math.round((dbProfileProgress.current / dbProfileProgress.total) * 100) : 0}%` }} />
            </div>
            <p>Current table: <b>{dbProfileProgress.tableName}</b></p>
          </div>
        )}
        <div className="configuration-actions">
          <button className="primary-button" disabled={Boolean(dbProfileProgress)} onClick={runAction}>
            {dbProfileProgress ? "Profiling..." : runLabel}
          </button>
        </div>
      </section>
    </section>

    <section className="panel agent-plan-panel">
      <PanelTitle title="Agent-assisted profiling plan" aside={profilingPlan?.confirmed ? "Confirmed" : "Review before running"} />
      <div className="agent-plan-grid">
        <div className="agent-plan-inputs">
          <label>
            Custom report requirements
            <textarea
              value={customRequirements}
              onChange={(event) => setCustomRequirements(event.target.value)}
              placeholder="Example: flag email as PII, check duplicate customer_id, include null threshold warnings, compare revenue by region..."
              rows={5}
            />
          </label>
          <label className="agent-doc-upload compact-upload">
            Upload requirements / policy docs
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md,.json,.csv"
              onChange={(event) => {
                uploadKnowledgeDocs?.(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={generateProfilingPlan}>
              Generate plan
            </button>
            <button className="primary-button" type="button" onClick={() => confirmProfilingPlan?.()}>
              Confirm plan
            </button>
          </div>
        </div>
        <div className="agent-plan-output">
          {profilingPlan ? (
            <>
              <div className="plan-summary-row">
                <strong>{profilingPlan.items?.length || 0} plan items</strong>
                <span>{profilingPlan.selected_sections?.join(", ")}</span>
              </div>
              <div className="plan-item-list">
                {profilingPlan.items?.map((item) => (
                  <article key={item.id} className={item.requires_confirmation ? "needs-confirmation" : ""}>
                    <strong>{item.label}</strong>
                    <p>{item.reason}</p>
                    {item.requires_confirmation ? <small>Requires analyst confirmation</small> : null}
                  </article>
                ))}
              </div>
              {profilingPlan.clarification_questions?.length ? (
                <div className="plan-questions">
                  <strong>Questions to confirm</strong>
                  {profilingPlan.clarification_questions.map((question) => <span key={question}>{question}</span>)}
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state compact">
              Add custom requirements or upload docs, then generate a plan. The Agent will propose metrics and questions before profiling.
            </div>
          )}
          <div className="plan-context-strip">
            <span>{knowledgeDocs.length} docs</span>
            <span>{userRules.length} saved rules</span>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}

function sectionTooltip(section) {
  const descriptions = {
    schema: "Return source schema: column names and inferred data types.",
    columns: "Return column-level metrics such as nulls, distincts, ranges, samples, and top values.",
    correlations: "Return numeric column relationship pairs using Pearson correlation.",
    findings: "Return data quality observations such as possible PII, low cardinality, outliers, or ID-like columns.",
    quality_summary: "Return aggregated counts of info, warning, and critical findings.",
  };
  return descriptions[section] || section;
}

function runOptionTooltip(label) {
  const descriptions = {
    "Basic statistics": "Compute numeric statistics such as min, max, average, standard deviation, median, and quartiles when applicable.",
    "Null analysis": "Compute null count and null ratio per column.",
    "Distinct analysis": "Compute distinct count and distinct ratio per column.",
    "Pattern detection": "Detect regex-like patterns and possible PII signals from sampled values.",
  };
  return descriptions[label] || label;
}
