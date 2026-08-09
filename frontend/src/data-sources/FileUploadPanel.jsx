import React from "react";
import { CheckCircle2, FileSpreadsheet, FileText, FolderOpen, UploadCloud, X } from "lucide-react";
import { PanelTitle } from "../shared/components.jsx";
import { formatBytes } from "../utils/formatters.js";

const FILE_FORMATS = [
  { id: "csv", label: "CSV", hint: "Single or multiple CSV files" },
  { id: "excel", label: "Excel", hint: "Workbook with one or many sheets" },
];

export function FileUploadPanel({
  files,
  fileFormat,
  switchFileFormat,
  appendSelectedFiles,
  setFilesForFormat,
  previewSchema,
}) {
  const isCsv = fileFormat === "csv";

  return (
    <section className="panel upload-flow-panel">
      <PanelTitle title="Upload file" aside="Step 1: format, Step 2: browse, Step 3: profile" />
      <div className="upload-format-grid">
        {FILE_FORMATS.map((format) => (
          <button
            key={format.id}
            className={`format-card ${fileFormat === format.id ? "selected" : ""}`}
            onClick={() => switchFileFormat(format.id)}
          >
            {fileFormat === format.id && <CheckCircle2 className="selected-check" size={18} />}
            <FolderOpen size={18} />
            <strong>{format.label}</strong>
            <small>{format.hint}</small>
          </button>
        ))}
      </div>
      <label className="dropzone">
        <span className="dropzone-file-icon">
          {isCsv ? <FileText size={30} /> : <FileSpreadsheet size={30} />}
          <b>{isCsv ? "CSV" : "XLSX"}</b>
        </span>
        <UploadCloud size={28} />
        <strong>Browse {isCsv ? "CSV" : "Excel"} files from your machine</strong>
        <span>{isCsv ? "Select one or many CSV files." : "Select one or many Excel workbooks."}</span>
        <input
          type="file"
          accept={isCsv ? ".csv" : ".xlsx"}
          multiple
          onChange={(event) => {
            appendSelectedFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <FileList files={files} onFilesChange={(nextFiles) => setFilesForFormat(fileFormat, nextFiles)} />
      <div className="button-row align-right">
        <button className="primary-button" onClick={() => previewSchema()}>Preview schema</button>
      </div>
    </section>
  );
}

function FileList({ files, onFilesChange }) {
  const selected = Array.from(files || []);
  if (!selected.length) {
    return (
      <div className="file-list-empty">
        <FileText size={18} />
        <span>
          <strong>No files selected yet</strong>
          <small>Browse files above to add sources.</small>
        </span>
      </div>
    );
  }

  function removeFile(indexToRemove) {
    const remaining = selected.filter((_, index) => index !== indexToRemove);
    onFilesChange(remaining);
  }

  return (
    <div className="file-list">
      {selected.map((file, index) => (
        <div className="file-row" key={`${file.name}-${file.size}`}>
          <span className="file-name-with-icon">
            {file.name.toLowerCase().endsWith(".xlsx") ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
            {file.name}
          </span>
          <span>{formatBytes(file.size)}</span>
          <button className="file-remove-button" type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
