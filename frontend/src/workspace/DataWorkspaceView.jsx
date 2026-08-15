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
  autoConfigureDbFromDocs,
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
  customRequirements,
  setCustomRequirements,
  knowledgeDocs,
  uploadKnowledgeDocs,
  profilingPlan,
  generateProfilingPlan,
  confirmProfilingPlan,
  userRules,
  columns,
  runSectionsProfile,
  loading,
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
  const pageTitle = currentStep === "source" ? "Add Data Source" : currentStep === "config" ? "Data Profiling Plan" : "Dataset Explorer";
  const pageDescription = currentStep === "source"
    ? "Connect local files or database sources while keeping the current profiling workflow."
    : currentStep === "config"
      ? "Configure profiling strategy, sections, requirements, and execution plan."
      : "Inspect schema, choose columns, and preview rows before profiling.";

  return (
    <section className="workspace-page">
      <div className="section-header">
        <div>
          <h2>{pageTitle}</h2>
          <p>{pageDescription}</p>
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
            autoConfigureDbFromDocs={autoConfigureDbFromDocs}
            previewSelectedDbTables={previewSelectedDbTables}
            profileSelectedDbTable={profileSelectedDbTable}
            previewDbQuery={previewDbQuery}
            profileDbQuery={profileDbQuery}
            loading={loading}
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
            customRequirements={customRequirements}
            setCustomRequirements={setCustomRequirements}
            knowledgeDocs={knowledgeDocs}
            uploadKnowledgeDocs={uploadKnowledgeDocs}
            profilingPlan={profilingPlan}
            generateProfilingPlan={generateProfilingPlan}
            confirmProfilingPlan={confirmProfilingPlan}
            userRules={userRules}
            columns={columns}
            schema={schema}
            schemaPreviews={schemaPreviews}
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
