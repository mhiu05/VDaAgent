import React from "react";
import { DataSourcesView } from "../data-sources/DataSourcesView.jsx";
import { DatasetsView } from "../datasets/DatasetsView.jsx";
import { ProfilingView } from "../profiling/ProfilingView.jsx";

export function DataWorkspaceView({
  workspaceStep,
  setWorkspaceStep,
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
  dbProfileProgress,
  previewSchema,
  runFullProfile,
  testConnection,
  listDbTables,
  previewSelectedDbTables,
  profileSelectedDbTable,
  previewDbQuery,
  profileDbQuery,
  schema,
  schemaPreviews,
  selectedSchemaIndex,
  setSelectedSchemaIndex,
  previewLimit,
  setPreviewLimit,
  refreshSelectedPreviewRows,
  selectedColumnsBySource,
  setSelectedColumnsBySource,
  selectedSections,
  setSelectedSections,
  columns,
  runSectionsProfile,
}) {
  const hasSchemaPreview = Boolean(schemaPreviews?.length || schema?.length);
  const currentStep = hasSchemaPreview ? workspaceStep : "source";
  const stepOrder = ["source", "dataset", "config"];
  const currentStepIndex = stepOrder.indexOf(currentStep);
  const steps = [
    { id: "source", number: 1, label: "Source", enabled: true },
    { id: "dataset", number: 2, label: "Dataset", enabled: hasSchemaPreview },
    { id: "config", number: 3, label: "Configuration", enabled: hasSchemaPreview },
  ];

  return (
    <section className="workspace-page">
      <div className="section-header">
        <div>
          <h2>Data Workspace</h2>
          <p>Choose a source, explore the dataset, select columns, then run profiling.</p>
        </div>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Data workspace steps">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <button
              className={`${currentStep === step.id ? "active" : ""} ${index < currentStepIndex ? "complete" : ""}`}
              disabled={!step.enabled}
              onClick={() => setWorkspaceStep(step.id)}
              role="tab"
              aria-selected={currentStep === step.id}
            >
              <span>{step.number}</span>
              <strong>{step.label}</strong>
              {!step.enabled && <small>Locked</small>}
            </button>
            {index < steps.length - 1 && (
              <i className={`workspace-step-line ${index < currentStepIndex ? "complete" : ""}`} aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="workspace-step-content" key={currentStep}>
        {currentStep === "source" && (
          <DataSourcesView
            selectedSource={selectedSource}
            setSelectedSource={setSelectedSource}
            files={files}
            setFiles={setFiles}
            dbValues={dbValues}
            setDbValues={setDbValues}
            dbStatus={dbStatus}
            tables={tables}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            selectedTables={selectedTables}
            setSelectedTables={setSelectedTables}
            dbInputMode={dbInputMode}
            setDbInputMode={setDbInputMode}
            dbQuery={dbQuery}
            setDbQuery={setDbQuery}
            dbProfileProgress={dbProfileProgress}
            selectedSections={selectedSections}
            setSelectedSections={setSelectedSections}
            previewSchema={previewSchema}
            testConnection={testConnection}
            listDbTables={listDbTables}
            previewSelectedDbTables={previewSelectedDbTables}
            profileSelectedDbTable={profileSelectedDbTable}
            previewDbQuery={previewDbQuery}
            profileDbQuery={profileDbQuery}
          />
        )}
        {currentStep === "dataset" && (
          <DatasetsView
            files={files}
            tables={tables}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            schema={schema}
            schemaPreviews={schemaPreviews}
            selectedSchemaIndex={selectedSchemaIndex}
            setSelectedSchemaIndex={setSelectedSchemaIndex}
            previewLimit={previewLimit}
            setPreviewLimit={setPreviewLimit}
            refreshSelectedPreviewRows={refreshSelectedPreviewRows}
            selectedColumnsBySource={selectedColumnsBySource}
            setSelectedColumnsBySource={setSelectedColumnsBySource}
            previewSchema={previewSchema}
            onContinueToConfiguration={() => setWorkspaceStep("config")}
          />
        )}
        {currentStep === "config" && (
          <ProfilingView
            files={files}
            selectedTables={selectedTables}
            selectedSections={selectedSections}
            setSelectedSections={setSelectedSections}
            columns={columns}
            schema={schema}
            dbProfileProgress={dbProfileProgress}
            runFullProfile={runFullProfile}
            profileSelectedDbTable={profileSelectedDbTable}
            profileDbQuery={profileDbQuery}
            dbInputMode={dbInputMode}
            dbQuery={dbQuery}
          />
        )}
      </div>
    </section>
  );
}
