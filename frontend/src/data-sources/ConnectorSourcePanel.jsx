import React, { useMemo, useState } from "react";
import { CheckCircle2, Database, Search } from "lucide-react";
import { DatabaseForm } from "./DatabaseForm.jsx";
import { DatabaseTables } from "./DatabaseTables.jsx";

export function ConnectorSourcePanel({
  serverConnectors,
  selectedSource,
  selectedCard,
  chooseConnector,
  dbValues,
  setDbValues,
  dbStatus,
  dbInputMode,
  setDbInputMode,
  dbQuery,
  setDbQuery,
  tables,
  selectedTable,
  setSelectedTable,
  selectedTables,
  setSelectedTables,
  listDbTables,
  previewSelectedDbTables,
  previewDbQuery,
}) {
  const [searchText, setSearchText] = useState("");
  const visibleSources = useMemo(() => serverConnectors.filter((source) => {
    const haystack = `${source.title} ${source.provider} ${source.description}`.toLowerCase();
    return haystack.includes(searchText.toLowerCase());
  }), [searchText, serverConnectors]);

  return (
    <>
      <div className="connector-shell">
        <ConnectorGallery
          sources={visibleSources}
          selectedSource={selectedSource}
          searchText={searchText}
          setSearchText={setSearchText}
          chooseConnector={chooseConnector}
        />
        <ConnectorDetail
          selectedCard={selectedCard}
          dbValues={dbValues}
          setDbValues={setDbValues}
          dbStatus={dbStatus}
          dbInputMode={dbInputMode}
          setDbInputMode={setDbInputMode}
          dbQuery={dbQuery}
          setDbQuery={setDbQuery}
          tables={tables}
          listDbTables={listDbTables}
          previewDbQuery={previewDbQuery}
        />
      </div>

      {dbInputMode === "table" && tables.length > 0 && (
        <section className="panel database-object-panel">
          <DatabaseTables
            tables={tables}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            selectedTables={selectedTables}
            setSelectedTables={setSelectedTables}
          />
          <div className="button-row align-right">
            <button className="primary-button" disabled={!selectedCard.backendType} onClick={previewSelectedDbTables}>
              Preview selected table(s)
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function ConnectorGallery({ sources, selectedSource, searchText, setSearchText, chooseConnector }) {
  return (
    <section className="connector-gallery panel">
      <div className="connector-toolbar">
        <label className="connector-search">
          <Search size={16} />
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search server connectors" />
        </label>
        <span className="connector-count">{sources.length} connectors</span>
      </div>
      <div className="connector-grid">
        {sources.map((source) => {
          const Icon = source.icon;
          return (
            <button
              className={`connector-card ${selectedSource === source.id ? "selected" : ""}`}
              key={source.id}
              onClick={() => chooseConnector(source)}
              title={`${source.title}: ${source.description}`}
            >
              {selectedSource === source.id && <CheckCircle2 className="selected-check" size={18} />}
              <span className="connector-logo"><Icon size={20} /><b>{source.monogram}</b></span>
              <span className="connector-copy">
                <strong>{source.title}</strong>
                <small>{source.provider}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConnectorDetail({
  selectedCard,
  dbValues,
  setDbValues,
  dbStatus,
  dbInputMode,
  setDbInputMode,
  dbQuery,
  setDbQuery,
  tables,
  listDbTables,
  previewDbQuery,
}) {
  return (
    <aside className="connector-detail panel">
      <span className="connector-logo large">
        {React.createElement(selectedCard.icon, { size: 28 })}
        <b>{selectedCard.monogram}</b>
      </span>
      <p className="fabric-kicker">Configure connector</p>
      <h3>{selectedCard.title}</h3>
      <p>{selectedCard.description}</p>
      <div className="connector-meta">
        <span><CheckCircle2 size={15} /> {selectedCard.status}</span>
        <span><Database size={15} /> Test configuration before connecting</span>
      </div>
      <DatabaseForm values={dbValues} setValues={setDbValues} connector={selectedCard} />
      <p className="helper-text">Connection fields are saved in this browser for the MVP workflow.</p>
      <div className="source-submode-tabs" role="tablist" aria-label="Database input mode">
        <button
          className={dbInputMode === "table" ? "selected" : ""}
          type="button"
          onClick={() => setDbInputMode("table")}
        >
          Table
        </button>
        <button
          className={dbInputMode === "query" ? "selected" : ""}
          type="button"
          onClick={() => setDbInputMode("query")}
        >
          SQL query
        </button>
      </div>
      {dbInputMode === "table" && (
        <div className="button-row">
          <button className="primary-button" disabled={!selectedCard.backendType} onClick={listDbTables}>Connect and list tables</button>
        </div>
      )}
      {!selectedCard.backendType && (
        <div className="inline-status status-info">
          This connector is in the catalog, but needs a backend adapter and driver before profiling.
        </div>
      )}
      <div className={`inline-status ${connectionStatusTone(dbStatus)}`}>{dbStatus}</div>
      {dbInputMode === "table" ? (
        <p className="helper-text">
          {tables.length ? "Tables are loaded below. Select one or more tables, then preview before configuring profiling." : "Connect first to load schemas and tables."}
        </p>
      ) : (
        <QueryPanel
          dbQuery={dbQuery}
          setDbQuery={setDbQuery}
          previewDbQuery={previewDbQuery}
        />
      )}
    </aside>
  );
}

function QueryPanel({ dbQuery, setDbQuery, previewDbQuery }) {
  return (
    <div className="query-panel">
      <label>SQL query
        <textarea
          className="query-editor"
          value={dbQuery}
          onChange={(event) => setDbQuery(event.target.value)}
          placeholder="SELECT * FROM dbo.Customers"
          rows={8}
        />
      </label>
      <p className="helper-text">Only read-only SELECT queries are allowed. Preview loads the first 50 rows before profiling.</p>
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={previewDbQuery}>Preview query</button>
      </div>
    </div>
  );
}

function connectionStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("failed")) return "status-error";
  if (normalized.includes("ok")) return "status-success";
  if (normalized.includes("testing")) return "status-info";
  return "";
}
