import React, { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Search } from "lucide-react";
import { EmptyTable, PanelTitle } from "../shared/components.jsx";

export function DatasetsView({
  files,
  tables,
  schema,
  schemaPreviews,
  selectedSchemaIndex,
  setSelectedSchemaIndex,
  previewLimit,
  setPreviewLimit,
  refreshSelectedPreviewRows,
  selectedColumnsBySource,
  setSelectedColumnsBySource,
  previewSchema,
  onContinueToConfiguration,
}) {
  const [columnSearch, setColumnSearch] = useState("");
  const selectedPreview = schemaPreviews[selectedSchemaIndex] || null;
  const activeSchema = useMemo(
    () => derivePreviewSchema(selectedPreview, schema),
    [selectedPreview, schema],
  );
  const hasDatabaseTables = tables.length > 0;
  const visibleColumns = useMemo(() => activeSchema.filter((column) => (
    `${column.name} ${column.data_type}`.toLowerCase().includes(columnSearch.toLowerCase())
  )), [activeSchema, columnSearch]);
  const previewRows = selectedPreview?.rows || [];
  const selectedColumnNames = selectedColumnsBySource[selectedPreview?.name] || activeSchema.map((column) => column.name);
  const activeSelected = new Set(selectedColumnNames);
  const previewColumns = activeSchema.filter((column) => activeSelected.has(column.name));

  function toggleColumn(columnName) {
    const next = new Set(activeSelected);
    if (next.has(columnName)) next.delete(columnName);
    else next.add(columnName);
    setSelectedColumnsBySource((current) => ({
      ...current,
      [selectedPreview?.name || "default"]: Array.from(next),
    }));
  }

  function selectFile(file) {
    const index = schemaPreviews.findIndex((preview) => (
      preview.name === file.name || preview.name.startsWith(`${file.name}:`)
    ));
    if (index >= 0) setSelectedSchemaIndex(index);
  }

  function changePreviewLimit(value) {
    const nextLimit = Number(value);
    setPreviewLimit(nextLimit);
    refreshSelectedPreviewRows(nextLimit);
  }

  return (
    <section>
      <div className="section-header">
        <div>
          <h2>Dataset Explorer</h2>
          <p>{hasDatabaseTables ? "Choose schema, table, and columns before profiling." : "Choose file, sheet, and columns before profiling."}</p>
        </div>
      </div>

      {!hasDatabaseTables && Array.from(files || []).length > 0 && (
        <div className="explorer-overview single">
          <section className="panel">
            <PanelTitle title="Selected files" aside={`${Array.from(files || []).length} files`} />
            <div className="file-list">
              {Array.from(files || []).map((file) => (
                <button
                  className={`file-row file-row-button ${selectedPreview?.name === file.name || selectedPreview?.name?.startsWith(`${file.name}:`) ? "selected" : ""}`}
                  key={`${file.name}-${file.size}`}
                  type="button"
                  onClick={() => selectFile(file)}
                  title={`Select ${file.name} for schema and preview.`}
                >
                  <span className="file-name-with-icon">
                    {file.name.toLowerCase().endsWith(".xlsx") ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
                    {file.name}
                  </span>
                  <span>{Math.round(file.size / 1024)} KB</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <section className="panel">
        <PanelTitle
          title="Explore dataset"
          aside={`${activeSelected.size} of ${activeSchema.length} columns selected`}
        />
        {!schemaPreviews.length && (
          <div className="dataset-empty-state">
            <FileText size={34} />
            <strong>No schema preview loaded</strong>
            <span>Preview selected files first to inspect datatypes, row counts, columns, and sample rows.</span>
          </div>
        )}
        {schemaPreviews.length > 0 && (
          <div className="dataset-schema-selector">
            <label>
              File / sheet
              <select value={selectedSchemaIndex} onChange={(event) => setSelectedSchemaIndex(Number(event.target.value))} title="Choose which file, sheet, or profiled source to inspect.">
                {schemaPreviews.map((preview, index) => (
                  <option key={`${preview.name}-${index}`} value={index}>
                    {preview.name} - {preview.type}
                  </option>
                ))}
              </select>
            </label>
            {selectedPreview && (
              <div className="dataset-schema-summary">
                <strong>{selectedPreview.name}</strong>
                <span>{selectedPreview.rowCount ?? previewRows.length ?? "-"} rows</span>
                <span>{selectedPreview.columnCount ?? activeSchema.length} columns</span>
              </div>
            )}
          </div>
        )}

        {schemaPreviews.length > 0 && <div className="dataset-explorer-grid">
          <div>
            <div className="toolbar">
              <label className="inline-field"><Search size={16} /> <input value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} placeholder="Search/filter column" /></label>
            </div>
            {activeSchema.length ? (
              <div className="table-wrap explorer-column-table">
                <table>
                  <thead><tr><th>Profile</th><th>Column</th><th>Datatype</th></tr></thead>
                  <tbody>
                    {visibleColumns.map((column) => (
                      <tr key={column.name}>
                        <td><input type="checkbox" checked={activeSelected.has(column.name)} onChange={() => toggleColumn(column.name)} title={`Include ${column.name} in profiling/report filtering.`} /></td>
                        <td><span className="column-name" title={`Column: ${column.name}`}>{column.name}</span></td>
                        <td><span className="type-pill" title={`Inferred data type: ${column.data_type}`}>{column.data_type}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyTable columns={3} message="Preview schema from Data Sources to load columns." />}
          </div>

          <div>
            <div className="preview-panel-title">
              <PanelTitle title="Data preview" />
              <label className="preview-limit-select">
                Rows
                <select value={previewLimit} onChange={(event) => changePreviewLimit(event.target.value)} title="Number of rows to show in the preview table.">
                  <option value={10}>10</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            {previewRows.length ? <PreviewRows rows={previewRows} columns={previewColumns} /> : <div className="empty-state preview-empty">Preview rows are available for CSV files after schema preview.</div>}
          </div>
        </div>}
        {schemaPreviews.length > 0 && (
          <div className="dataset-actions">
            <button className="primary-button" onClick={onContinueToConfiguration}>Continue to configuration</button>
          </div>
        )}
      </section>
    </section>
  );
}

function PreviewRows({ rows, columns }) {
  const columnNames = columns?.length ? columns.map((column) => column.name) : Object.keys(rows[0] || {});
  return (
    <div className="table-wrap preview-table-wrap">
      <table>
        <thead><tr>{columnNames.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{columnNames.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function derivePreviewSchema(preview, fallbackSchema) {
  if (preview?.columns?.length) return preview.columns;
  if (fallbackSchema?.length) return fallbackSchema;
  const firstRow = preview?.rows?.[0];
  if (!firstRow) return [];
  return Object.keys(firstRow).map((name) => ({
    name,
    data_type: inferPreviewType(firstRow[name]),
  }));
}

function inferPreviewType(value) {
  if (value === null || value === undefined) return "UNKNOWN";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "BIGINT" : "DOUBLE";
  return "VARCHAR";
}
