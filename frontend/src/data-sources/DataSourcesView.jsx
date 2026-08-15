import React, { useEffect, useMemo, useState } from "react";
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
    autoConfigureDbFromDocs,
    previewSelectedDbTables,
    previewDbQuery,
    loading,
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

  useEffect(() => {
    if (flowMode !== "source" || !selectedCard?.backendType) return;
    const defaultPort = selectedCard.defaultPort || defaultPortForEngine(selectedCard.backendType);
    const defaultDriver = selectedCard.defaultDriver ?? defaultDriverForEngine(selectedCard.backendType);
    const needsDefaults = dbValues.connectorId !== selectedCard.id
      || !dbValues.type
      || !dbValues.port
      || (selectedCard.backendType === "sql_server" && !dbValues.driver);
    if (!needsDefaults) return;

    setDbValues((current) => ({
      ...current,
      type: selectedCard.backendType,
      port: current.port || defaultPort,
      driver: current.driver || defaultDriver,
      connectorId: selectedCard.id,
    }));
  }, [dbValues.connectorId, dbValues.driver, dbValues.port, dbValues.type, flowMode, selectedCard, setDbValues]);

  function chooseConnector(source) {
    setSelectedSource(source.id);
    setDbValues(() => ({
      type: source.backendType || "",
      host: "",
      port: source.defaultPort || defaultPortForEngine(source.backendType),
      database: "",
      username: "",
      password: "",
      authType: "username_password",
      driver: source.defaultDriver ?? defaultDriverForEngine(source.backendType),
      connectorId: source.id,
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
            const currentConnector = serverConnectors.find((source) => source.id === selectedSource) || serverConnectors[0];
            if (!serverConnectors.some((source) => source.id === selectedSource) || !dbValues.type || !dbValues.port || (currentConnector.backendType === "sql_server" && !dbValues.driver)) {
              chooseConnector(currentConnector);
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
          loading={loading}
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
          autoConfigureDbFromDocs={autoConfigureDbFromDocs}
          previewSelectedDbTables={previewSelectedDbTables}
          previewDbQuery={previewDbQuery}
          loading={loading}
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

function defaultPortForEngine(engine) {
  if (engine === "sql_server") return "1433";
  if (engine === "postgresql") return "5432";
  if (engine === "mysql") return "3306";
  return "";
}

function defaultDriverForEngine(engine) {
  if (engine === "sql_server") return "ODBC Driver 18 for SQL Server";
  return "";
}
