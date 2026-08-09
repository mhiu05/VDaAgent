import React, { useMemo, useState } from "react";
import { CheckCircle2, Server, UploadCloud } from "lucide-react";
import { ConnectorSourcePanel } from "./ConnectorSourcePanel.jsx";
import { DatabaseForm } from "./DatabaseForm.jsx";
import { DatabaseTables } from "./DatabaseTables.jsx";
import { FileUploadPanel } from "./FileUploadPanel.jsx";
import { sourceCards } from "../utils/options.js";

export { DatabaseForm, DatabaseTables };

export function DataSourcesView(props) {
  const {
    selectedSource,
    setSelectedSource,
    files,
    setFiles,
    dbValues,
    setDbValues,
    dbStatus,
    tables,
    selectedTable,
    setSelectedTable,
    selectedTables,
    setSelectedTables,
    dbInputMode,
    setDbInputMode,
    dbQuery,
    setDbQuery,
    previewSchema,
    listDbTables,
    previewSelectedDbTables,
    previewDbQuery,
  } = props;

  const [flowMode, setFlowMode] = useState("upload");
  const [fileFormat, setFileFormat] = useState("csv");
  const [fileBuckets, setFileBuckets] = useState({
    csv: Array.from(files || []),
    excel: [],
  });

  const serverConnectors = useMemo(
    () => sourceCards.filter((source) => source.category === "Databases"),
    [],
  );
  const selectedCard = serverConnectors.find((source) => source.id === selectedSource) || serverConnectors[0];

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

  function setFilesForFormat(format, fileArray) {
    const nextFiles = toFileList(fileArray);
    setFileBuckets((current) => ({ ...current, [format]: fileArray }));
    setFiles(nextFiles);
    return nextFiles;
  }

  function switchFileFormat(format) {
    setFileFormat(format);
    setFiles(toFileList(fileBuckets[format] || []));
  }

  function appendSelectedFiles(fileList) {
    const currentFiles = Array.from(files || []);
    const incomingFiles = Array.from(fileList || []);
    const merged = [...currentFiles];
    incomingFiles.forEach((file) => {
      const exists = merged.some((item) => (
        item.name === file.name
        && item.size === file.size
        && item.lastModified === file.lastModified
      ));
      if (!exists) merged.push(file);
    });
    setFilesForFormat(fileFormat, merged);
  }

  return (
    <section className="fabric-page">
      <div className="fabric-hero">
        <div>
          <p className="fabric-kicker">New connection</p>
          <h2>Choose a data source</h2>
          <p>Upload a local file or point the agent to a configured data source.</p>
        </div>
      </div>

      <div className="source-mode-grid">
        <button className={`source-mode-card ${flowMode === "upload" ? "selected" : ""}`} onClick={() => setFlowMode("upload")}>
          {flowMode === "upload" && <CheckCircle2 className="selected-check" size={18} />}
          <span><UploadCloud size={20} /></span>
          <strong>Upload file</strong>
          <small>Choose file format, browse from your machine, then preview or profile.</small>
        </button>
        <button
          className={`source-mode-card ${flowMode === "source" ? "selected" : ""}`}
          onClick={() => {
            setFlowMode("source");
            if (!serverConnectors.some((source) => source.id === selectedSource)) {
              chooseConnector(serverConnectors[0]);
            }
          }}
        >
          {flowMode === "source" && <CheckCircle2 className="selected-check" size={18} />}
          <span><Server size={20} /></span>
          <strong>Connect to data source</strong>
          <small>Select a connector, configure credentials, and test before connecting.</small>
        </button>
      </div>

      {flowMode === "upload" && (
        <FileUploadPanel
          files={files}
          fileFormat={fileFormat}
          switchFileFormat={switchFileFormat}
          appendSelectedFiles={appendSelectedFiles}
          setFilesForFormat={setFilesForFormat}
          previewSchema={previewSchema}
        />
      )}

      {flowMode === "source" && (
        <ConnectorSourcePanel
          serverConnectors={serverConnectors}
          selectedSource={selectedSource}
          selectedCard={selectedCard}
          chooseConnector={chooseConnector}
          dbValues={dbValues}
          setDbValues={setDbValues}
          dbStatus={dbStatus}
          dbInputMode={dbInputMode}
          setDbInputMode={setDbInputMode}
          dbQuery={dbQuery}
          setDbQuery={setDbQuery}
          tables={tables}
          selectedTable={selectedTable}
          setSelectedTable={setSelectedTable}
          selectedTables={selectedTables}
          setSelectedTables={setSelectedTables}
          listDbTables={listDbTables}
          previewSelectedDbTables={previewSelectedDbTables}
          previewDbQuery={previewDbQuery}
        />
      )}
    </section>
  );
}

function toFileList(fileArray) {
  if (typeof DataTransfer === "undefined") {
    return fileArray;
  }
  const transfer = new DataTransfer();
  fileArray.forEach((file) => transfer.items.add(file));
  return transfer.files;
}
