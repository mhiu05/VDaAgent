import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, FileText, FlaskConical, Search, UploadCloud } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { Metric, PanelTitle } from "../shared/components.jsx";
import { DatabaseForm, DatabaseTables } from "../data-sources/DataSourcesView.jsx";
import { sourceCards, statisticalTests } from "../utils/options.js";
import { formatNumber } from "../utils/formatters.js";

export function StatisticalTestsView({
  testSourceMode,
  setTestSourceMode,
  selectedTest,
  setSelectedTest,
  testForm,
  setTestForm,
  testFile,
  setTestFile,
  selectedSource,
  setSelectedSource,
  dbValues,
  setDbValues,
  tables,
  selectedTable,
  setSelectedTable,
  selectedTables,
  setSelectedTables,
  dbStatus,
  listDbTables,
  schema,
  schemaPreviews,
  selectedSchemaIndex,
  loadColumns,
  testResult,
  runStatisticalTest,
}) {
  const selectedTestConfig = statisticalTests.find((test) => test.id === selectedTest);
  const activeColumns = useMemo(
    () => schemaPreviews?.[selectedSchemaIndex]?.columns?.length ? schemaPreviews[selectedSchemaIndex].columns : schema || [],
    [schema, schemaPreviews, selectedSchemaIndex],
  );
  const defaultDatabaseConnector = sourceCards.find((source) => source.category === "Databases" && source.backendType);

  function activateDatabaseSource() {
    setTestSourceMode("database");
    const currentSource = sourceCards.find((source) => source.id === selectedSource);
    if (currentSource?.category === "Databases") return;
    if (!defaultDatabaseConnector) return;
    setSelectedSource(defaultDatabaseConnector.id);
    setDbValues((current) => ({
      ...current,
      connectorId: defaultDatabaseConnector.id,
      type: defaultDatabaseConnector.backendType,
      port: defaultDatabaseConnector.defaultPort || "1433",
      driver: defaultDatabaseConnector.defaultDriver ?? "ODBC Driver 18 for SQL Server",
    }));
  }

  return (
    <section>
      <div className="section-header">
        <div>
          <h2>Statistical tests</h2>
          <p>Run analyst tests and review p-values with chart-ready output.</p>
        </div>
      </div>
      <div className="test-grid">
        {statisticalTests.map((test) => (
          <button className={`test-card ${selectedTest === test.id ? "selected" : ""}`} key={test.id} onClick={() => setSelectedTest(test.id)}>
            <FlaskConical size={18} />
            <strong>{test.title}</strong>
            <span>{test.description}</span>
          </button>
        ))}
      </div>
      <section className="panel statistical-source-panel">
        <PanelTitle title="Choose analysis source" aside="Same source model as profiling" />
        <div className="source-mode-grid test-source-mode-grid">
          <button className={`source-mode-card ${testSourceMode === "file" ? "selected" : ""}`} onClick={() => setTestSourceMode("file")}>
            <span><FileText size={20} /></span>
            <strong>Upload file</strong>
            <small>Use a local CSV file for the selected statistical test.</small>
            {testSourceMode === "file" && <CheckCircle2 className="selected-check" size={18} />}
          </button>
          <button className={`source-mode-card ${testSourceMode === "database" ? "selected" : ""}`} onClick={activateDatabaseSource}>
            <span><Database size={20} /></span>
            <strong>Use data source</strong>
            <small>Use tables from the connector configured in Data Workspace.</small>
            {testSourceMode === "database" && <CheckCircle2 className="selected-check" size={18} />}
          </button>
        </div>
        {testSourceMode === "file" ? (
          <TestFileSource testFile={testFile} setTestFile={setTestFile} />
        ) : (
          <DatabaseTestSource
            selectedSource={selectedSource}
            setSelectedSource={setSelectedSource}
            dbValues={dbValues}
            setDbValues={setDbValues}
            tables={tables}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            selectedTables={selectedTables}
            setSelectedTables={setSelectedTables}
            dbStatus={dbStatus}
            listDbTables={listDbTables}
          />
        )}
      </section>
      <div className="two-column">
        <section className="panel">
          <PanelTitle title="Column mapping" aside={selectedTestConfig?.title || "Single test"} />
          <ColumnMapping
            selectedTestConfig={selectedTestConfig}
            columns={activeColumns}
            testForm={testForm}
            setTestForm={setTestForm}
            loadColumns={loadColumns}
          />
          <button className="primary-button" onClick={runStatisticalTest}>Run test</button>
        </section>
        <section className="panel">
          <PanelTitle title="Test result" aside="Statistic + interpretation" />
          <StatisticalResult result={testResult} />
        </section>
      </div>
    </section>
  );
}

function ColumnMapping({ selectedTestConfig, columns, testForm, setTestForm, loadColumns }) {
  const fields = selectedTestConfig?.fields || [];
  const numericColumns = useMemo(() => columns.filter(isNumericColumn), [columns]);
  const categoricalColumns = useMemo(() => columns.filter((column) => !isNumericColumn(column)), [columns]);
  const hasColumns = columns.length > 0;

  useEffect(() => {
    if (!hasColumns) return;
    setTestForm((current) => {
      const next = { ...current };
      fields.forEach((field, index) => {
        const options = optionsForField(field, numericColumns, categoricalColumns, columns);
        if (!options.length) return;
        if (!options.some((column) => column.name === next[field])) {
          next[field] = options[Math.min(index, options.length - 1)].name;
        }
      });
      return next;
    });
  }, [hasColumns, fields.join("|"), numericColumns, categoricalColumns, columns, setTestForm]);

  return (
    <div className="column-mapping">
      <div className="column-mapping-header">
        <div>
          <strong>{hasColumns ? `${columns.length} columns loaded` : "No columns loaded"}</strong>
          <span>{hasColumns ? "Choose columns from the selected source." : "Load columns from the selected file or table before running the test."}</span>
        </div>
        <button className="secondary-button" type="button" onClick={loadColumns}>Load columns</button>
      </div>

      {hasColumns && (
        <div className="form-grid">
          {fields.map((field) => (
            <ColumnSelect
              key={field}
              label={fieldLabel(field)}
              value={testForm[field] || ""}
              options={optionsForField(field, numericColumns, categoricalColumns, columns)}
              onChange={(value) => setTestForm({ ...testForm, [field]: value })}
            />
          ))}
          <details className="advanced-test-options">
            <summary>Advanced</summary>
            <label>
              Alpha
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={testForm.alpha}
                onChange={(event) => setTestForm({ ...testForm, alpha: event.target.value })}
              />
            </label>
          </details>
        </div>
      )}
    </div>
  );
}

function ColumnSelect({ label, value, options, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select column</option>
        {options.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name} ({column.data_type})
          </option>
        ))}
      </select>
    </label>
  );
}

function TestFileSource({ testFile, setTestFile }) {
  return (
    <div className="test-source-config">
      <label className={`test-file-dropzone ${testFile ? "has-file" : ""}`}>
        <input type="file" accept=".csv" onChange={(event) => setTestFile(event.target.files?.[0] || null)} />
        <span><UploadCloud size={28} /></span>
        <strong>{testFile ? testFile.name : "Browse CSV file from your machine"}</strong>
        <small>{testFile ? `${Math.round(testFile.size / 1024)} KB selected` : "CSV is used only for this statistical test run."}</small>
      </label>
    </div>
  );
}

function DatabaseTestSource({
  selectedSource,
  setSelectedSource,
  dbValues,
  setDbValues,
  tables,
  selectedTable,
  setSelectedTable,
  selectedTables,
  setSelectedTables,
  dbStatus,
  listDbTables,
}) {
  const [searchText, setSearchText] = useState("");
  const databaseConnectors = sourceCards.filter((source) => source.category === "Databases");
  const selectedConnector = databaseConnectors.find((source) => source.id === selectedSource) || databaseConnectors[0];
  const visibleConnectors = useMemo(() => databaseConnectors.filter((source) => {
    const haystack = `${source.title} ${source.provider} ${source.description}`.toLowerCase();
    return haystack.includes(searchText.toLowerCase());
  }), [databaseConnectors, searchText]);
  const hasTables = tables.length > 0;

  function chooseConnector(source) {
    setSelectedSource(source.id);
    setDbValues((current) => ({
      ...current,
      connectorId: source.id,
      ...(source.backendType ? {
        type: source.backendType,
        port: source.defaultPort || (source.backendType === "postgresql" ? "5432" : "1433"),
        driver: source.defaultDriver ?? (source.backendType === "postgresql" ? "" : "ODBC Driver 18 for SQL Server"),
      } : {}),
    }));
  }

  return (
    <div className="database-test-source test-source-config inline-db-source">
      <div className="inline-db-grid">
        <section className="inline-connector-list">
          <label className="connector-search">
            <Search size={16} />
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search connectors" />
          </label>
          <div className="inline-connector-cards">
            {visibleConnectors.map((source) => {
              const Icon = source.icon;
              return (
                <button
                  className={`connector-card compact ${selectedSource === source.id ? "selected" : ""}`}
                  key={source.id}
                  type="button"
                  onClick={() => chooseConnector(source)}
                  title={source.description}
                >
                  {selectedSource === source.id && <CheckCircle2 className="selected-check" size={16} />}
                  <span className="connector-logo"><Icon size={18} /><b>{source.monogram}</b></span>
                  <span className="connector-copy">
                    <strong>{source.title}</strong>
                    <small>{source.provider}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="inline-db-config">
          <div className="test-source-summary">
            <span><Database size={18} /></span>
            <div>
              <strong>{selectedConnector.title}</strong>
              <small>{selectedConnector.description}</small>
            </div>
          </div>
          <DatabaseForm values={dbValues} setValues={setDbValues} connector={selectedConnector} />
          {!selectedConnector.backendType && (
            <div className="inline-status status-info">This connector needs a backend adapter before tests can run.</div>
          )}
          <div className="button-row">
            <button className="primary-button" type="button" disabled={!selectedConnector.backendType} onClick={listDbTables}>
              Connect and list tables
            </button>
          </div>
          <div className="inline-status">{dbStatus}</div>
        </section>
      </div>

      <div className="inline-db-table-section">
        <div className="test-source-summary compact">
          <span><Database size={18} /></span>
          <div>
            <strong>{hasTables ? `${tables.length} database tables available` : "No connected table list yet"}</strong>
            <small>{hasTables ? "Select one table for this statistical test." : "Fill connector details, then connect and list tables above."}</small>
          </div>
        </div>
        {hasTables ? (
          <DatabaseTables
            tables={tables}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            selectedTables={selectedTables?.length ? selectedTables.slice(0, 1) : selectedTable?.table_name ? [selectedTable] : []}
            setSelectedTables={(next) => {
              const selected = Array.isArray(next) ? next[next.length - 1] : null;
              setSelectedTables(selected ? [selected] : []);
              setSelectedTable(selected || { schema_name: "", table_name: "" });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function fieldLabel(field) {
  const labels = {
    x_column: "X column",
    y_column: "Y column",
    value_column: "Value column",
    group_column: "Group column",
  };
  return labels[field] || field;
}

function optionsForField(field, numericColumns, categoricalColumns, allColumns) {
  if (field === "value_column") return numericColumns.length ? numericColumns : allColumns;
  if (field === "group_column") return categoricalColumns.length ? categoricalColumns : allColumns;
  if (field === "x_column" || field === "y_column") {
    if (numericColumns.length >= 2) return numericColumns;
    return allColumns;
  }
  return allColumns;
}

function isNumericColumn(column) {
  const type = String(column?.data_type || "").toUpperCase();
  return [
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "DOUBLE",
    "FLOAT",
    "REAL",
    "DECIMAL",
    "NUMERIC",
    "NUMBER",
  ].some((numericType) => type.includes(numericType));
}

function StatisticalResult({ result }) {
  if (!result) return <div className="empty-state">No statistical test result yet.</div>;
  const chartData = [{ x: 0, y: 0 }, { x: 1, y: Math.abs(result.statistic || 0) }];
  return (
    <div className="stat-result">
      <div className="stat-grid">
        <Metric label="Statistic" value={formatNumber(result.statistic)} />
        <Metric label="p-value" value={formatNumber(result.p_value)} />
        <Metric label="Sample size" value={result.sample_size} />
        <Metric label="Significant" value={result.significant ? "Yes" : "No"} />
      </div>
      <p>{result.interpretation}</p>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" hide />
          <YAxis type="number" dataKey="y" />
          <Tooltip />
          <Scatter data={chartData} fill="#2563eb" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
