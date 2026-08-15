import React, { useEffect, useMemo, useRef, useState } from "react";
import { LoginView } from "./auth/LoginView.jsx";
import { getSession, logout } from "./auth/session.js";
import { AgentWorkspaceView } from "./agent/AgentWorkspaceView.jsx";
import { DashboardView } from "./dashboard/DashboardView.jsx";
import { AgentPanel } from "./layout/AgentPanel.jsx";
import { HistoryView } from "./history/HistoryView.jsx";
import { Sidebar } from "./layout/Sidebar.jsx";
import { Topbar } from "./layout/Topbar.jsx";
import { StatisticalTestsView } from "./profiling/StatisticalTestsView.jsx";
import { ReviewCenterView } from "./review/ReviewCenterView.jsx";
import { ResultsView } from "./results/ResultsView.jsx";
import { SettingsView } from "./settings/SettingsView.jsx";
import { Toast } from "./shared/components.jsx";
import { DataWorkspaceView } from "./workspace/DataWorkspaceView.jsx";
import { useAsyncTask } from "./hooks/useAsyncTask.js";
import { useToast } from "./hooks/useToast.js";
import { createHistoryEntry } from "./store/appStore.js";
import { DEFAULT_API_BASE, databaseConnectionFromForm, fileForm, requestJson } from "./services/api.js";
import { sectionsToResult } from "./utils/formatters.js";
import { sourceCards, statisticalTests } from "./utils/options.js";

const VALID_VIEWS = new Set(["dashboard", "workspace", "reports", "agent", "review", "history", "tests", "settings"]);
const VALID_WORKSPACE_STEPS = new Set(["source", "dataset", "config"]);
const APP_STATE_SESSION_KEY = "profiling-agent.sessionState";
const CHAT_WELCOME_MESSAGE = {
  id: "welcome",
  role: "agent",
  text: "Ask me about the selected report.",
};
const DEFAULT_DB_VALUES = {
  type: "",
  host: "",
  port: "",
  database: "",
  username: "",
  password: "",
  authType: "username_password",
  driver: "",
  connectorId: "",
};

export default function App() {
  const initialRoute = getRouteFromLocation();
  const initialSessionState = getStoredSessionState();
  const [session, setSession] = useState(() => getSession());
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [activeView, setActiveViewState] = useState(initialRoute.view !== "dashboard" ? initialRoute.view : initialSessionState.activeView || initialRoute.view);
  const [workspaceStep, setWorkspaceStep] = useState(initialRoute.step !== "source" ? initialRoute.step : initialSessionState.workspaceStep || initialRoute.step);
  const [selectedSource, setSelectedSource] = useState(initialSessionState.selectedSource || "csv");
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(initialSessionState.result || null);
  const [resultSources, setResultSources] = useState(initialSessionState.resultSources || []);
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(initialSessionState.selectedProfileIndex || 0);
  const [sectionsResult, setSectionsResult] = useState(initialSessionState.sectionsResult || null);
  const [schemaPreviews, setSchemaPreviews] = useState(initialSessionState.schemaPreviews || []);
  const [selectedSchemaIndex, setSelectedSchemaIndex] = useState(initialSessionState.selectedSchemaIndex || 0);
  const [previewLimit, setPreviewLimit] = useState(initialSessionState.previewLimit || 50);
  const [selectedColumnsBySource, setSelectedColumnsBySource] = useState(initialSessionState.selectedColumnsBySource || {});
  const [selectedSections, setSelectedSections] = useState(initialSessionState.selectedSections || ["schema", "columns", "correlations", "findings"]);
  const [history, setHistory] = useState(initialSessionState.history || []);
  const [profileReports, setProfileReports] = useState(initialSessionState.profileReports || []);
  const [dbValues, setDbValues] = useState(DEFAULT_DB_VALUES);
  const [dbStatus, setDbStatus] = useState("Connection not tested.");
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState({ schema_name: "", table_name: "" });
  const [selectedTables, setSelectedTables] = useState([]);
  const [dbInputMode, setDbInputMode] = useState(initialSessionState.dbInputMode || "table");
  const [dbQuery, setDbQuery] = useState(initialSessionState.dbQuery || "");
  const [dbProfileProgress, setDbProfileProgress] = useState(null);
  const [testSourceMode, setTestSourceMode] = useState("file");
  const [testFile, setTestFile] = useState(null);
  const [selectedTest, setSelectedTest] = useState("pearson-correlation");
  const [testForm, setTestForm] = useState({
    x_column: "unit_price",
    y_column: "revenue",
    value_column: "final_exam_score",
    group_column: "gender",
    alpha: "0.05",
  });
  const [testResult, setTestResult] = useState(null);
  const chatUserId = session?.id || "anonymous";
  const [conversationId, setConversationId] = useState(initialSessionState.conversationId || null);
  const [conversations, setConversations] = useState([]);
  const [chatMessages, setChatMessages] = useState([CHAT_WELCOME_MESSAGE]);
  const [chatInput, setChatInput] = useState("");
  const [hitlRecords, setHitlRecords] = useState(initialSessionState.hitlRecords || []);
  const [agentRuns, setAgentRuns] = useState(initialSessionState.agentRuns || []);
  const [traceEvents, setTraceEvents] = useState(initialSessionState.traceEvents || []);
  const [userWorkspace, setUserWorkspace] = useState(initialSessionState.userWorkspace || null);
  const [knowledgeDocs, setKnowledgeDocs] = useState(initialSessionState.knowledgeDocs || []);
  const [customRequirements, setCustomRequirements] = useState(initialSessionState.customRequirements || "");
  const [profilingPlan, setProfilingPlan] = useState(initialSessionState.profilingPlan || null);
  const [userRules, setUserRules] = useState(initialSessionState.userRules || []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(initialSessionState.sidebarWidth || 280);
  const [agentCollapsed, setAgentCollapsed] = useState(
    initialSessionState.agentCollapsed ?? initialRoute.view === "dashboard",
  );
  const [agentWidth, setAgentWidth] = useState(initialSessionState.agentWidth || 320);
  const autoTestRequestId = useRef(0);
  const routeReadyRef = useRef(false);
  const restoringRouteRef = useRef(false);

  const { toast, showToast } = useToast();
  const { loading, runTask } = useAsyncTask(showToast);
  const displayResult = resultSources[selectedProfileIndex] || (result?.source ? result : sectionsToResult(sectionsResult));
  const columns = displayResult?.columns || [];
  const findings = displayResult?.findings || [];
  const correlations = displayResult?.relationships?.correlations || [];
  const quality = displayResult?.quality_summary || {};
  const profileExplorerPreviews = useMemo(
    () => buildExplorerPreviews(resultSources.length ? resultSources : (displayResult?.source ? [displayResult] : []), schemaPreviews),
    [displayResult, resultSources, schemaPreviews],
  );
  const explorerPreviews = profileExplorerPreviews.length ? profileExplorerPreviews : schemaPreviews;
  const safeSelectedSchemaIndex = explorerPreviews[selectedSchemaIndex] ? selectedSchemaIndex : 0;
  const schema = explorerPreviews[safeSelectedSchemaIndex]?.columns || sectionsResult?.sections?.schema || [];
  const topCategoricalColumn = useMemo(() => columns.find((column) => column.top_values?.length), [columns]);
  const selectedConnector = useMemo(
    () => sourceCards.find((source) => source.id === selectedSource),
    [selectedSource],
  );

  useEffect(() => {
    clearLegacyStoredDbValues();
  }, []);

  useEffect(() => {
    setTables([]);
    setSelectedTables([]);
    setSelectedTable({ schema_name: "", table_name: "" });
  }, [
    dbValues.type,
    dbValues.host,
    dbValues.port,
    dbValues.database,
    dbValues.username,
    dbValues.password,
    dbValues.driver,
    dbValues.authType,
  ]);

  useEffect(() => {
    saveStoredSessionState({
      activeView,
      workspaceStep,
      selectedSource,
      result,
      resultSources,
      selectedProfileIndex,
      sectionsResult,
      schemaPreviews,
      selectedSchemaIndex,
      previewLimit,
      selectedColumnsBySource,
      selectedSections,
      history,
      profileReports,
      hitlRecords,
      agentRuns,
      traceEvents,
      userWorkspace,
      knowledgeDocs: knowledgeDocs.map(({ extracted_text, ...doc }) => doc),
      customRequirements,
      profilingPlan,
      userRules,
      dbInputMode,
      dbQuery,
      conversationId,
      agentCollapsed,
      agentWidth,
      sidebarWidth,
    });
  }, [
    activeView,
    workspaceStep,
    selectedSource,
    result,
    resultSources,
    selectedProfileIndex,
    sectionsResult,
    schemaPreviews,
    selectedSchemaIndex,
    previewLimit,
    selectedColumnsBySource,
    selectedSections,
    history,
    profileReports,
    hitlRecords,
    agentRuns,
    traceEvents,
    userWorkspace,
    knowledgeDocs,
    customRequirements,
    profilingPlan,
    userRules,
    dbInputMode,
    dbQuery,
    conversationId,
    agentCollapsed,
    agentWidth,
    sidebarWidth,
  ]);

  function startSidebarResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    function onMove(moveEvent) {
      const nextWidth = Math.min(420, Math.max(72, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
      if (nextWidth > 96 && sidebarCollapsed) setSidebarCollapsed(false);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing-panel");
    }

    document.body.classList.add("is-resizing-panel");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startAgentResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentWidth;

    function onMove(moveEvent) {
      const nextWidth = Math.min(560, Math.max(280, startWidth + startX - moveEvent.clientX));
      setAgentWidth(nextWidth);
      if (agentCollapsed) setAgentCollapsed(false);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing-panel");
    }

    document.body.classList.add("is-resizing-panel");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    async function restoreServerChat() {
      try {
        const items = await requestJson(
          `${apiBase}/conversations?user_id=${encodeURIComponent(chatUserId)}&limit=50`,
        );
        if (cancelled) return;
        setConversations(items || []);
        const selectedId = items?.some((item) => item.id === conversationId) ? conversationId : items?.[0]?.id;
        if (conversationId && selectedId !== conversationId) {
          setConversationId(selectedId || null);
        }
        if (!selectedId) return;
        const messages = await requestJson(
          `${apiBase}/conversations/${selectedId}/messages?user_id=${encodeURIComponent(chatUserId)}&limit=200`,
        );
        if (cancelled) return;
        setConversationId(selectedId);
        setChatMessages(messages?.length ? messages.map(toClientChatMessage) : [CHAT_WELCOME_MESSAGE]);
      } catch {
        // Chat history is best-effort while the backend is starting.
      }
    }
    restoreServerChat();
    return () => {
      cancelled = true;
    };
  }, [apiBase, chatUserId, session]);

  useEffect(() => {
    if (!session) return;
    const runId = displayResult?.agent_run?.run_id;
    if (!runId) return;
    refreshAgentGovernance(runId);
  }, [displayResult?.agent_run?.run_id, session]);

  useEffect(() => {
    if (!session) return;
    refreshAgentGovernance();
    loadProfileReports();
    loadUserWorkspace();
    loadKnowledgeDocs();
    loadUserRules();
  }, [apiBase, chatUserId, session]);

  useEffect(() => {
    if (!session) return undefined;
    if (agentCollapsed && activeView !== "dashboard" && activeView !== "reports") return undefined;
    const intervalId = window.setInterval(() => {
      refreshAgentGovernance(displayResult?.agent_run?.run_id);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [activeView, agentCollapsed, apiBase, displayResult?.agent_run?.run_id, session]);

  function setActiveView(nextView) {
    setActiveViewState((current) => {
      const value = typeof nextView === "function" ? nextView(current) : nextView;
      return VALID_VIEWS.has(value) ? value : current;
    });
  }

  function openProfilingSource(sourceId = "csv") {
    setSelectedSource(sourceId);
    setWorkspaceStep("source");
    setActiveView("workspace");
  }

  useEffect(() => {
    const onPopState = () => {
      const route = getRouteFromLocation();
      restoringRouteRef.current = true;
      setActiveViewState(route.view);
      setWorkspaceStep(route.step);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const route = {
      view: activeView,
      step: activeView === "workspace" ? workspaceStep : "source",
    };

    const nextUrl = routeToUrl(route);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (!routeReadyRef.current) {
      window.history.replaceState(route, "", nextUrl);
      routeReadyRef.current = true;
      return;
    }

    if (restoringRouteRef.current) {
      restoringRouteRef.current = false;
      return;
    }

    if (nextUrl !== currentUrl) {
      window.history.pushState(route, "", nextUrl);
    }
  }, [activeView, workspaceStep]);

  useEffect(() => {
    if (activeView !== "workspace") return undefined;
    if (selectedConnector?.category === "Databases" && !selectedConnector.backendType) {
      setDbStatus("Connector adapter is not implemented yet.");
      return undefined;
    }
    if (!isDatabaseConfigReady(dbValues)) {
      setDbStatus("Fill required connection fields to test automatically.");
      return undefined;
    }

    const requestId = autoTestRequestId.current + 1;
    autoTestRequestId.current = requestId;
    setDbStatus("Testing connection...");

    const timer = window.setTimeout(async () => {
      try {
        const connection = databaseConnectionFromForm(dbValues);
        const data = await requestJson(`${apiBase}/profile/database/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(connection),
        });
        if (autoTestRequestId.current === requestId) {
          setDbStatus(`Connection OK: ${data.database_type} / ${data.database}`);
        }
      } catch (error) {
        if (autoTestRequestId.current === requestId) {
          setDbStatus(`Connection failed: ${error.message}`);
        }
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeView, apiBase, dbValues, selectedConnector]);

  function setProfileResult(data, addToHistory = true) {
    setResult(data);
    setResultSources(data ? [data] : []);
    setSelectedProfileIndex(0);
    setSectionsResult(null);
    if (addToHistory && data) {
      setHistory((current) => [createHistoryEntry(data), ...current]);
    }
    loadProfileReports();
  }

  function setProfileResults(sources) {
    const normalizedSources = sources || [];
    const first = normalizedSources[0] || null;
    setResult(first);
    setResultSources(normalizedSources);
    setSelectedProfileIndex(0);
    setSectionsResult(null);
    setHistory((current) => normalizedSources.map(createHistoryEntry).concat(current));
    loadProfileReports();
  }

  async function checkApi() {
    await runTask("Checking backend", async () => {
      const healthUrl = apiBase.replace("/api/v1", "/health");
      const health = await requestJson(healthUrl);
      showToast(`Backend ${health.status} (${health.env})`, "success");
    });
  }

  async function loadProfileReports() {
    try {
      const reports = await requestJson(`${apiBase}/profile/reports?user_id=${encodeURIComponent(chatUserId)}&limit=100`);
      setProfileReports(reports || []);
    } catch {
      // Report history is best-effort while the backend is starting.
    }
  }

  async function loadUserWorkspace() {
    try {
      const workspace = await requestJson(`${apiBase}/users/${encodeURIComponent(chatUserId)}/workspace`);
      setUserWorkspace(workspace);
    } catch {
      // User workspace is best-effort for MVP identity.
    }
  }

  async function updateUserWorkspace(nextValues) {
    await runTask("Saving workspace", async () => {
      const workspace = await requestJson(`${apiBase}/users/${encodeURIComponent(chatUserId)}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: nextValues.display_name || "Analyst",
          role: nextValues.role || "data_analyst",
          metadata: nextValues.metadata || {},
        }),
      });
      setUserWorkspace(workspace);
      showToast("Workspace saved", "success");
    }, false);
  }

  async function loadKnowledgeDocs() {
    try {
      const docs = await requestJson(`${apiBase}/knowledge/documents?user_id=${encodeURIComponent(chatUserId)}`);
      setKnowledgeDocs(docs || []);
    } catch {
      // Knowledge documents are optional.
    }
  }

  async function uploadKnowledgeDocs(fileList) {
    const selectedFiles = Array.from(fileList || []);
    if (!selectedFiles.length) return [];
    const uploaded = [];
    await runTask("Uploading requirement docs", async () => {
      for (const file of selectedFiles) {
        const form = fileForm(file, "file");
        form.append("user_id", chatUserId);
        const doc = await requestJson(`${apiBase}/knowledge/documents`, { method: "POST", body: form });
        uploaded.push(doc);
      }
      setKnowledgeDocs((current) => [...uploaded, ...current]);
      showToast(`Uploaded ${uploaded.length} requirement document(s)`, "success");
    }, false);
    return uploaded;
  }

  async function loadUserRules() {
    try {
      const rules = await requestJson(`${apiBase}/users/${encodeURIComponent(chatUserId)}/rules`);
      setUserRules(rules || []);
    } catch {
      // Rules are optional metadata.
    }
  }

  async function generateProfilingPlan() {
    const activePreview = explorerPreviews[safeSelectedSchemaIndex];
    const activeColumns = activePreview?.columns?.length
      ? activePreview.columns.map((column) => column.name).filter(Boolean)
      : schema.map((column) => column.name).filter(Boolean);
    await runTask("Generating profiling plan", async () => {
      const plan = await requestJson(`${apiBase}/profiling/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: chatUserId,
          source_name: activePreview?.name || displayResult?.source?.name || null,
          columns: activeColumns,
          selected_sections: selectedSections,
          custom_requirements: customRequirements,
          document_ids: knowledgeDocs.map((doc) => doc.id),
        }),
      });
      setProfilingPlan(plan);
      if (plan.selected_sections?.length) {
        setSelectedSections(plan.selected_sections);
      }
      showToast("Profiling plan generated", "success");
    }, false);
  }

  async function confirmProfilingPlan(answers = {}) {
    if (!profilingPlan?.id) {
      showToast("Generate a profiling plan first.", "warning");
      return;
    }
    await runTask("Confirming profiling plan", async () => {
      const confirmed = await requestJson(`${apiBase}/profiling/plans/${profilingPlan.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: chatUserId,
          confirmed_items: profilingPlan.items?.map((item) => item.id) || [],
          answers,
        }),
      });
      setProfilingPlan(confirmed);
      await loadUserRules();
      showToast("Profiling plan confirmed", "success");
    }, false);
  }

  async function openStoredReport(runId, nextView = "reports") {
    if (!runId) return;
    await runTask("Loading saved report", async () => {
      const data = await requestJson(`${apiBase}/profile/reports/${runId}?user_id=${encodeURIComponent(chatUserId)}`);
      if (data?.report) {
        setProfileResult(data.report, false);
        setActiveView(nextView);
      }
    }, false);
  }

  async function runFullProfile() {
    if (!files.length) {
      showToast("Select at least one CSV or Excel file first.", "warning");
      return;
    }
    await runTask("Running profiling", async () => {
      const selectedFiles = Array.from(files);
      if (selectedFiles.length > 1) {
        const form = fileForm(selectedFiles, "files");
        form.append("user_id", chatUserId);
        const data = await requestJson(`${apiBase}/profile/files`, { method: "POST", body: form });
        setProfileResults((data.sources || []).map((source) => applySelectedColumnsToProfile(source, selectedColumnsBySource)));
        showToast(`Profiled ${data.collection_summary.source_count} sources`, "success");
      } else if (selectedFiles[0].name.toLowerCase().endsWith(".xlsx")) {
        const form = fileForm(selectedFiles[0], "file");
        form.append("user_id", chatUserId);
        const data = await requestJson(`${apiBase}/profile/excel`, { method: "POST", body: form });
        setProfileResults((data.sources || []).map((source) => applySelectedColumnsToProfile(source, selectedColumnsBySource)));
        showToast(`Profiled ${data.collection_summary.source_count} sheets`, "success");
      } else {
        const form = fileForm(selectedFiles[0], "file");
        form.append("user_id", chatUserId);
        const data = await requestJson(`${apiBase}/profile/file`, { method: "POST", body: form });
        setProfileResult(applySelectedColumnsToProfile(data, selectedColumnsBySource));
        showToast("Full profile completed", "success");
      }
      setActiveView("reports");
    });
  }

  async function runSectionsProfile() {
    if (!files.length) {
      showToast("Select one CSV file before running sections.", "warning");
      return;
    }
    await runTask("Running selected sections", async () => {
      const form = fileForm(Array.from(files)[0], "file");
      form.append("sections", JSON.stringify(selectedSections));
      form.append("user_id", chatUserId);
      const data = await requestJson(`${apiBase}/profile/file/sections`, { method: "POST", body: form });
      setSectionsResult(data);
      setResult(null);
      setResultSources([]);
      setActiveView("reports");
      showToast(`Loaded sections: ${Object.keys(data.sections).join(", ")}`, "success");
    });
  }

  async function previewSchema(fileOverride = null, limitOverride = null, preserveProfile = false) {
    const selectedFiles = Array.from(fileOverride || files || []);
    const effectivePreviewLimit = Number(limitOverride || previewLimit || 50);
    if (!selectedFiles.length) {
      showToast("Select one CSV file first.", "warning");
      return;
    }
    const staleFile = selectedFiles.find((file) => !isUploadableFile(file));
    if (staleFile) {
      showToast(`Please re-select ${staleFile.name || "the file"} before previewing. Browser file handles were refreshed.`, "warning");
      setFiles([]);
      return;
    }
    await runTask("Previewing schema", async () => {
      const previews = [];
      for (const file of selectedFiles) {
        try {
          if (file.name.toLowerCase().endsWith(".xlsx")) {
            const form = fileForm(file, "file");
            form.append("user_id", chatUserId);
            const data = await requestJson(`${apiBase}/profile/excel`, { method: "POST", body: form });
            (data.sources || []).forEach((source) => {
              previews.push({
                name: source.source?.name || source.source_name || file.name,
                type: source.source?.type || "excel_sheet",
                columns: source.columns || [],
              });
            });
          } else {
            const form = fileForm(file, "file");
            form.append("user_id", chatUserId);
            const data = await requestJson(`${apiBase}/profile/file/schema`, { method: "POST", body: form });
            const previewForm = fileForm(file, "file");
            previewForm.append("limit", String(effectivePreviewLimit));
            previewForm.append("user_id", chatUserId);
            const previewData = await requestJson(`${apiBase}/profile/file/preview`, { method: "POST", body: previewForm });
            previews.push({
              name: data.source_name || file.name,
              type: data.source_type || "file",
              rowCount: data.row_count,
              columnCount: data.column_count,
              columns: data.columns || [],
              rows: previewData.rows || [],
            });
          }
        } catch (error) {
          throw new Error(`${file.name}: ${error.message || "Could not preview schema."}`);
        }
      }
      setSchemaPreviews(previews);
      setSelectedSchemaIndex(0);
      setSectionsResult(previews[0] ? {
        source_name: previews[0].name,
        source_type: previews[0].type,
        requested_sections: ["schema"],
        sections: { schema: previews[0].columns },
        errors: [],
      } : null);
      if (!preserveProfile) {
        setResult(null);
        setResultSources([]);
      }
      setActiveView("workspace");
      setWorkspaceStep("dataset");
      if (!preserveProfile) showToast(`Loaded schema preview for ${previews.length} source(s)`, "success");
    });
  }

  async function refreshSelectedPreviewRows(limit) {
    const selectedPreview = explorerPreviews[safeSelectedSchemaIndex];
    if (!selectedPreview) return;
    const matchedFile = Array.from(files || []).find((file) => file.name === selectedPreview.name);
    if (!matchedFile || !matchedFile.name.toLowerCase().endsWith(".csv")) return;

    await runTask("Refreshing preview rows", async () => {
      const previewForm = fileForm(matchedFile, "file");
      previewForm.append("limit", String(limit));
      previewForm.append("user_id", chatUserId);
      const previewData = await requestJson(`${apiBase}/profile/file/preview`, { method: "POST", body: previewForm });
      setSchemaPreviews((current) => current.map((preview) => (
        preview.name === selectedPreview.name
          ? { ...preview, rows: previewData.rows || [] }
          : preview
      )));
    }, false);
  }

  async function testConnection() {
    await runTask("Testing connection", async () => {
      const connection = databaseConnectionFromForm(dbValues);
      const data = await requestJson(`${apiBase}/profile/database/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connection),
      });
      setDbStatus(`${data.status}: ${data.database_type} / ${data.database}`);
      showToast("Connection OK", "success");
    });
  }

  async function listDbTables() {
    if (selectedConnector?.category === "Databases" && !selectedConnector.backendType) {
      showToast("This connector needs a backend adapter before listing tables.", "warning");
      return;
    }
    setTables([]);
    setSelectedTables([]);
    setSelectedTable({ schema_name: "", table_name: "" });
    await runTask("Listing tables", async () => {
      const connection = databaseConnectionFromForm(dbValues);
      const data = await fetchDbTables(connection);
      setTables(data.tables || []);
      setSelectedTables([]);
      setSelectedTable({ schema_name: "", table_name: "" });
      showToast(`Found ${data.tables.length} tables`, "success");
    });
  }

  async function fetchDbTables(connection) {
    return requestJson(`${apiBase}/profile/database/tables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection),
    });
  }

  async function loadDbTablePreviews(tableSelections) {
    const connection = databaseConnectionFromForm(dbValues);
    const previews = [];
    for (const table of tableSelections) {
      const schemaData = await requestJson(`${apiBase}/profile/database/schema`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection, ...table }),
      });
      const previewData = await requestJson(`${apiBase}/profile/database/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection, ...table, limit: previewLimit }),
      });
      previews.push({
        name: `${table.schema_name}.${table.table_name}`,
        type: schemaData.source_type || dbValues.type,
        rowCount: schemaData.row_count,
        columnCount: schemaData.column_count,
        columns: schemaData.columns || [],
        rows: previewData.rows || [],
      });
    }
    setSchemaPreviews(previews);
    setSelectedSchemaIndex(0);
    setResult(null);
    setResultSources([]);
    setSectionsResult(previews[0] ? {
      source_name: previews[0].name,
      source_type: previews[0].type,
      requested_sections: ["schema"],
      sections: { schema: previews[0].columns },
      errors: [],
    } : null);
    setActiveView("workspace");
    setWorkspaceStep("dataset");
    return previews;
  }

  async function previewSelectedDbTables(tableOverride = null) {
    if (selectedConnector?.category === "Databases" && !selectedConnector.backendType) {
      showToast("This connector needs a backend adapter before previewing tables.", "warning");
      return;
    }
    const tableSelections = tableOverride || (selectedTables.length ? selectedTables : (selectedTable.table_name ? [selectedTable] : []));
    if (!tableSelections.length) {
      showToast("Select at least one database table first.", "warning");
      return;
    }
    await runTask("Previewing database table", async () => {
      const previews = await loadDbTablePreviews(tableSelections);
      showToast(`Loaded preview for ${previews.length} table(s)`, "success");
    });
  }

  async function autoConfigureDbFromDocs() {
    if (selectedConnector?.category === "Databases" && !selectedConnector.backendType) {
      showToast("This connector needs a backend adapter before Agent configuration.", "warning");
      return;
    }
    if (!customRequirements.trim() && !knowledgeDocs.length) {
      showToast("Add requirements or upload policy docs before asking Agent to choose database objects.", "warning");
      return;
    }
    await runTask("Agent configuring database source", async () => {
      const connection = databaseConnectionFromForm(dbValues);
      let availableTables = tables;
      if (!availableTables.length) {
        const data = await fetchDbTables(connection);
        availableTables = data.tables || [];
        setTables(availableTables);
      }
      if (!availableTables.length) {
        throw new Error("No database tables were found for Agent configuration.");
      }
      const recommendation = await requestJson(`${apiBase}/profiling/database-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: chatUserId,
          tables: availableTables.map(toDatabasePlanTable),
          custom_requirements: customRequirements,
          document_ids: knowledgeDocs.map((doc) => doc.id),
          max_tables: 3,
        }),
      });
      const recommendedTables = (recommendation.recommended_tables || []).map((table) => ({
        schema_name: table.schema_name,
        table_name: table.table_name,
      }));
      if (!recommendedTables.length) {
        showToast(recommendation.questions?.[0] || "Agent could not match any table from the uploaded docs.", "warning");
        return;
      }
      setDbInputMode("table");
      setSelectedTables(recommendedTables);
      setSelectedTable(recommendedTables[0]);
      const previews = await loadDbTablePreviews(recommendedTables);
      showToast(`Agent selected and previewed ${previews.length} table(s)`, "success");
    });
  }

  async function profileSelectedDbTable() {
    if (selectedConnector?.category === "Databases" && !selectedConnector.backendType) {
      showToast("This connector needs a backend adapter before profiling.", "warning");
      return;
    }
    const tableSelections = selectedTables.length ? selectedTables : (selectedTable.table_name ? [selectedTable] : []);
    if (!tableSelections.length) {
      showToast("Select at least one database table first.", "warning");
      return;
    }
    await runTask("Profiling database table", async () => {
      const connection = databaseConnectionFromForm(dbValues);
      const profiledSources = [];
      const completedTables = [];
      try {
        setDbProfileProgress({ current: 0, total: tableSelections.length, tableName: tableKey(tableSelections[0]), completed: completedTables });
        for (const [index, table] of tableSelections.entries()) {
          setDbProfileProgress({ current: index, total: tableSelections.length, tableName: tableKey(table), completed: [...completedTables] });
          const data = await requestJson(`${apiBase}/profile/database/table?user_id=${encodeURIComponent(chatUserId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connection, ...table }),
          });
          completedTables.push({
            name: tableKey(table),
            rows: data.dataset_summary?.row_count ?? data.row_count,
            columns: data.dataset_summary?.column_count ?? data.column_count ?? data.columns?.length,
          });
          profiledSources.push(applySelectedSectionsToProfile(data, selectedSections));
          setDbProfileProgress({ current: index + 1, total: tableSelections.length, tableName: tableKey(table), completed: [...completedTables] });
        }
      } finally {
        setDbProfileProgress(null);
      }
      setProfileResults(profiledSources);
      setActiveView("reports");
      showToast(`Profiled ${profiledSources.length} database table(s)`, "success");
    });
  }

  async function previewDbQuery() {
    if (!dbQuery.trim()) {
      showToast("Write a SELECT query before previewing.", "warning");
      return;
    }
    await runTask("Previewing query", async () => {
      const data = await requestJson(`${apiBase}/profile/database/query/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection: databaseConnectionFromForm(dbValues),
          query: dbQuery,
          limit: 50,
        }),
      });
      setSchemaPreviews([{
        name: "SQL query",
        type: data.source_type || "database_query",
        rowCount: data.row_count,
        columnCount: data.column_count,
        columns: data.columns || [],
        rows: data.rows || [],
      }]);
      setSelectedSchemaIndex(0);
      setSectionsResult({
        source_name: "SQL query",
        source_type: data.source_type || "database_query",
        requested_sections: ["schema"],
        sections: { schema: data.columns || [] },
        errors: [],
      });
      setResult(null);
      setResultSources([]);
      setActiveView("workspace");
      setWorkspaceStep("dataset");
      showToast(`Loaded query preview with ${data.row_count} rows`, "success");
    });
  }

  async function profileDbQuery() {
    if (!dbQuery.trim()) {
      showToast("Write a SELECT query before profiling.", "warning");
      return;
    }
    await runTask("Profiling query", async () => {
      const data = await requestJson(`${apiBase}/profile/database/query?user_id=${encodeURIComponent(chatUserId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection: databaseConnectionFromForm(dbValues),
          query: dbQuery,
          limit: 50,
        }),
      });
      setProfileResult(data);
      setActiveView("reports");
      showToast("Query profiling completed", "success");
    });
  }

  async function runStatisticalTest() {
    const selected = statisticalTests.find((item) => item.id === selectedTest);
    if (testSourceMode === "database") {
      if (!selectedTable.table_name) {
        showToast("Select a database table before running the statistical test.", "warning");
        return;
      }
      await runTask("Running database statistical test", async () => {
        const data = await requestJson(`${apiBase}/analysis/statistical-test/database`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connection: databaseConnectionFromForm(dbValues),
            ...selectedTable,
            test_type: selectedTest.replaceAll("-", "_"),
            x_column: testForm.x_column,
            y_column: testForm.y_column,
            value_column: testForm.value_column,
            group_column: testForm.group_column,
            alpha: Number(testForm.alpha || 0.05),
          }),
        });
        setTestResult(data);
        showToast(`${selected.title} completed`, "success");
      });
      return;
    }

    if (!testFile) {
      showToast("Select a CSV file for the statistical test.", "warning");
      return;
    }
    await runTask("Running statistical test", async () => {
      const form = fileForm(testFile, "file");
      selected.fields.forEach((field) => form.append(field, testForm[field]));
      form.append("alpha", testForm.alpha || "0.05");
      const data = await requestJson(`${apiBase}/analysis/${selectedTest}/file`, { method: "POST", body: form });
      setTestResult(data);
      showToast(`${selected.title} completed`, "success");
    });
  }

  async function loadStatisticalTestColumns() {
    if (testSourceMode === "database") {
      if (!selectedTable.table_name) {
        showToast("Select a database table before loading columns.", "warning");
        return;
      }
      await runTask("Loading table columns", async () => {
        const data = await requestJson(`${apiBase}/profile/database/schema`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connection: databaseConnectionFromForm(dbValues),
            ...selectedTable,
          }),
        });
        setSchemaPreviews([{
          name: `${selectedTable.schema_name}.${selectedTable.table_name}`,
          type: "database_table",
          rowCount: data.row_count,
          columnCount: data.column_count,
          columns: data.columns || [],
          rows: [],
        }]);
        setSelectedSchemaIndex(0);
        showToast(`Loaded ${data.column_count} columns`, "success");
      }, false);
      return;
    }

    if (!testFile) {
      showToast("Select a CSV file before loading columns.", "warning");
      return;
    }
    await runTask("Loading file columns", async () => {
      const form = fileForm(testFile, "file");
      form.append("user_id", chatUserId);
      const data = await requestJson(`${apiBase}/profile/file/schema`, { method: "POST", body: form });
      setSchemaPreviews([{
        name: data.source_name || testFile.name,
        type: data.source_type || "file",
        rowCount: data.row_count,
        columnCount: data.column_count,
        columns: data.columns || [],
        rows: [],
      }]);
      setSelectedSchemaIndex(0);
      showToast(`Loaded ${data.column_count} columns`, "success");
    }, false);
  }

  async function askAgent(messageText, options = {}) {
    const message = String(messageText || "").trim();
    if (!message) return;
    const finalMessage = options.context ? `${message}\n\nContext:\n${options.context}` : message;
    setChatInput("");
    setChatMessages((current) => [...current, { id: `pending-${Date.now()}`, role: "user", text: message }]);
    await runTask("Asking agent", async () => {
      const runId = options.runId || displayResult?.agent_run?.run_id || null;
      const postChat = (nextConversationId) => requestJson(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: finalMessage,
          conversation_id: nextConversationId,
          user_id: chatUserId,
          run_id: runId,
        }),
      });
      let data;
      try {
        data = await postChat(conversationId);
      } catch (error) {
        if (isStaleConversationError(error)) {
          setConversationId(null);
          data = await postChat(null);
        } else {
          setChatMessages((current) => [
            ...current,
            {
              id: `agent-error-${Date.now()}`,
              role: "agent",
              text: error.message || "Agent request failed.",
            },
          ]);
          throw error;
        }
      }
      setConversationId(data.conversation_id);
      setChatMessages((current) => [
        ...current,
        {
          id: data.run_id || `agent-${Date.now()}`,
          role: "agent",
          text: data.response || "No response.",
          runId: data.run_id,
        },
      ]);
      try {
        const [messages, items] = await Promise.all([
          requestJson(
            `${apiBase}/conversations/${data.conversation_id}/messages?user_id=${encodeURIComponent(chatUserId)}&limit=200`,
          ),
          requestJson(`${apiBase}/conversations?user_id=${encodeURIComponent(chatUserId)}&limit=50`),
        ]);
        setChatMessages(messages?.length ? messages.map(toClientChatMessage) : [CHAT_WELCOME_MESSAGE]);
        setConversations(items || []);
        await refreshAgentGovernance(runId);
      } catch {
        // Keep the live response visible even if history sync is temporarily unavailable.
      }
    }, false);
  }

  async function sendChat(event) {
    event.preventDefault();
    await askAgent(chatInput);
  }

  async function selectConversation(nextConversationId) {
    if (!nextConversationId) return;
    setConversationId(nextConversationId);
    try {
      const messages = await requestJson(
        `${apiBase}/conversations/${nextConversationId}/messages?user_id=${encodeURIComponent(chatUserId)}&limit=200`,
      );
      setChatMessages(messages?.length ? messages.map(toClientChatMessage) : [CHAT_WELCOME_MESSAGE]);
    } catch (error) {
      showToast(error.message || "Could not load conversation", "error");
    }
  }

  function startNewConversation() {
    setConversationId(null);
    setChatMessages([CHAT_WELCOME_MESSAGE]);
    setChatInput("");
  }

  async function refreshAgentGovernance(runId = displayResult?.agent_run?.run_id) {
    try {
      const [records, runs, trace] = await Promise.all([
        requestJson(`${apiBase}/hitl?user_id=${encodeURIComponent(chatUserId)}`),
        requestJson(`${apiBase}/agent/runs?user_id=${encodeURIComponent(chatUserId)}`),
        runId ? requestJson(`${apiBase}/agent/runs/${runId}/trace`) : Promise.resolve([]),
      ]);
      setHitlRecords(records || []);
      setAgentRuns(runs || []);
      setTraceEvents(trace || []);
    } catch {
      // Observability panels are best-effort and should not block profiling UX.
    }
  }

  async function decideHitl(recordId, decision) {
    await runTask(`${decision === "approve" ? "Approving" : "Rejecting"} HITL item`, async () => {
      await requestJson(`${apiBase}/hitl/${recordId}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewer: chatUserId, comment: "Reviewed in Agent Panel" }),
      });
      await refreshAgentGovernance();
      showToast(`HITL item ${decision === "approve" ? "approved" : "rejected"}`, "success");
    }, false);
  }

  if (!session) {
    return <LoginView onLogin={setSession} />;
  }

  if (session.role !== "da") {
    return <RoleComingSoon session={session} onLogout={() => { logout(); setSession(null); }} />;
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${agentCollapsed || activeView === "agent" ? "agent-collapsed" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--agent-width": `${agentWidth}px`,
      }}
    >
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        loading={loading}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onResizeStart={startSidebarResize}
      />
      <main className="main-panel">
        <Topbar
          onNewProfile={() => openProfilingSource("csv")}
          session={session}
          onLogout={() => {
            logout();
            setSession(null);
          }}
        />
        {activeView === "dashboard" && (
          <DashboardView
            result={displayResult}
            history={history}
            agentRuns={agentRuns}
            hitlRecords={hitlRecords}
            profileReports={profileReports}
            onOpenReports={() => setActiveView("reports")}
            onOpenWorkspace={() => setActiveView("workspace")}
          />
        )}
        {activeView === "workspace" && (
          <DataWorkspaceView
            workspaceStep={workspaceStep}
            setWorkspaceStep={setWorkspaceStep}
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
            previewSchema={previewSchema}
            runFullProfile={runFullProfile}
            testConnection={testConnection}
            listDbTables={listDbTables}
            autoConfigureDbFromDocs={autoConfigureDbFromDocs}
            previewSelectedDbTables={previewSelectedDbTables}
            profileSelectedDbTable={profileSelectedDbTable}
            previewDbQuery={previewDbQuery}
            profileDbQuery={profileDbQuery}
            schema={schema}
            schemaPreviews={explorerPreviews}
            selectedSchemaIndex={safeSelectedSchemaIndex}
            setSelectedSchemaIndex={setSelectedSchemaIndex}
            previewLimit={previewLimit}
            setPreviewLimit={setPreviewLimit}
            refreshSelectedPreviewRows={refreshSelectedPreviewRows}
            selectedColumnsBySource={selectedColumnsBySource}
            setSelectedColumnsBySource={setSelectedColumnsBySource}
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
            runSectionsProfile={runSectionsProfile}
            loading={loading}
          />
        )}
        {activeView === "reports" && (
          <ResultsView
            result={displayResult}
            resultSources={resultSources}
            selectedProfileIndex={selectedProfileIndex}
            setSelectedProfileIndex={setSelectedProfileIndex}
            columns={columns}
            findings={findings}
            correlations={correlations}
            quality={quality}
            topCategoricalColumn={topCategoricalColumn}
            traceEvents={traceEvents}
            hitlRecords={hitlRecords}
            decideHitl={decideHitl}
            savedReports={profileReports}
            openStoredReport={openStoredReport}
            apiBase={apiBase}
            userId={chatUserId}
          />
        )}
        {activeView === "agent" && (
          <AgentWorkspaceView
            currentReport={displayResult}
            profileReports={profileReports}
            openStoredReport={(runId) => openStoredReport(runId, "agent")}
            chatMessages={chatMessages}
            conversations={conversations}
            conversationId={conversationId}
            selectConversation={selectConversation}
            startNewConversation={startNewConversation}
            chatInput={chatInput}
            setChatInput={setChatInput}
            askAgent={askAgent}
            hitlRecords={hitlRecords}
            loading={loading}
            onOpenReports={() => setActiveView("reports")}
            knowledgeDocs={knowledgeDocs}
            uploadKnowledgeDocs={uploadKnowledgeDocs}
          />
        )}
        {activeView === "review" && (
          <ReviewCenterView
            hitlRecords={hitlRecords}
            agentRuns={agentRuns}
            decideHitl={decideHitl}
          />
        )}
        {activeView === "history" && (
          <HistoryView
            history={history}
            profileReports={profileReports}
            conversations={conversations}
            agentRuns={agentRuns}
            openStoredReport={openStoredReport}
            selectConversation={selectConversation}
            setActiveView={setActiveView}
          />
        )}
        {activeView === "tests" && (
          <StatisticalTestsView
            testSourceMode={testSourceMode}
            setTestSourceMode={setTestSourceMode}
            selectedTest={selectedTest}
            setSelectedTest={setSelectedTest}
            testForm={testForm}
            setTestForm={setTestForm}
            testFile={testFile}
            setTestFile={setTestFile}
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
            schema={schema}
            schemaPreviews={explorerPreviews}
            selectedSchemaIndex={safeSelectedSchemaIndex}
            loadColumns={loadStatisticalTestColumns}
            testResult={testResult}
            runStatisticalTest={runStatisticalTest}
          />
        )}
        {activeView === "settings" && (
          <SettingsView
            apiBase={apiBase}
            setApiBase={setApiBase}
            userWorkspace={userWorkspace}
            updateUserWorkspace={updateUserWorkspace}
            userRules={userRules}
          />
        )}
      </main>
      {activeView !== "agent" && (
        <AgentPanel
          collapsed={agentCollapsed}
          setCollapsed={setAgentCollapsed}
          chatMessages={chatMessages}
          conversations={conversations}
          conversationId={conversationId}
          selectConversation={selectConversation}
          startNewConversation={startNewConversation}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChat={sendChat}
          askAgent={askAgent}
          loading={loading}
          currentReport={displayResult}
          profileReports={profileReports}
          openStoredReport={(runId) => openStoredReport(runId, activeView)}
          findings={findings}
          hitlRecords={hitlRecords}
          decideHitl={decideHitl}
          openReviewCenter={() => setActiveView("reports")}
          onResizeStart={startAgentResize}
        />
      )}
      {toast && <Toast toast={toast} />}
    </div>
  );
}

function isDatabaseConfigReady(values) {
  const required = [values.type, values.host, values.port];
  if (values.authType === "username_password") {
    required.push(values.username, values.password);
  }
  if (values.type === "sql_server") {
    required.push(values.driver);
  }
  return required.every((value) => String(value || "").trim());
}

function RoleComingSoon({ session, onLogout }) {
  const title = session.role === "admin" ? "Admin workspace" : "User workspace";
  return (
    <main className="role-soon-shell">
      <section className="role-soon-card">
        <span className="fabric-kicker">{session.role}</span>
        <h1>{title} is coming soon</h1>
        <p>
          You are signed in as <b>{session.displayName}</b>. The current build enables the
          Data Analyst role only; user and admin workflows will be added later.
        </p>
        <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
      </section>
    </main>
  );
}

function buildExplorerPreviews(profileSources, existingPreviews) {
  const profiles = (profileSources || []).filter((source) => source?.source || source?.columns);
  if (!profiles.length) return [];

  const profileByName = new Map(profiles.map((source) => [
    source.source?.name || source.source_name || "Profiled dataset",
    source,
  ]));
  const merged = (existingPreviews || []).map((preview) => {
    const profile = profileByName.get(preview.name)
      || profiles.find((source) => {
        const sourceName = source.source?.name || source.source_name || "";
        return sourceName.startsWith(`${preview.name}:`) || preview.name.startsWith(`${sourceName}:`);
      });
    if (!profile) return preview;
    const columns = (profile.columns || preview.columns || []).map((column) => ({
      name: column.name,
      data_type: column.data_type,
    }));
    return {
      ...preview,
      type: profile.source?.type || profile.source_type || preview.type,
      rowCount: profile.dataset_summary?.row_count ?? profile.row_count ?? preview.rowCount,
      columnCount: profile.dataset_summary?.column_count ?? profile.column_count ?? columns.length,
      columns,
      profiled: true,
    };
  });

  profiles.forEach((source) => {
    const name = source.source?.name || source.source_name || "Profiled dataset";
    const alreadyIncluded = merged.some((preview) => preview.name === name);
    if (alreadyIncluded) return;
    const columns = (source.columns || []).map((column) => ({
      name: column.name,
      data_type: column.data_type,
    }));
    merged.push({
      name,
      type: source.source?.type || source.source_type || "profile_result",
      rowCount: source.dataset_summary?.row_count ?? source.row_count,
      columnCount: source.dataset_summary?.column_count ?? source.column_count ?? columns.length,
      columns,
      rows: [],
      profiled: true,
    });
  });

  return merged;
}

function applySelectedColumnsToProfile(profile, selectedColumnsBySource) {
  const sourceName = profile?.source?.name || profile?.source_name;
  const selectedColumns = selectedColumnsBySource[sourceName];
  if (!sourceName || !selectedColumns) return profile;

  const allowed = new Set(selectedColumns);
  const columns = (profile.columns || []).filter((column) => allowed.has(column.name));
  const findings = (profile.findings || []).filter((finding) => (
    !finding.column || allowed.has(finding.column)
  ));
  const relationships = profile.relationships || {};
  const correlations = (relationships.correlations || []).filter((correlation) => (
    allowed.has(correlation.left_column) && allowed.has(correlation.right_column)
  ));

  return {
    ...profile,
    dataset_summary: {
      ...profile.dataset_summary,
      column_count: columns.length,
    },
    columns,
    relationships: {
      ...relationships,
      correlations,
    },
    findings,
    quality_summary: summarizeFindings(findings),
  };
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    const key = `${finding.severity || "info"}_count`;
    return { ...summary, [key]: (summary[key] || 0) + 1 };
  }, { critical_count: 0, warning_count: 0, info_count: 0 });
}

function applySelectedSectionsToProfile(profile, selectedSections) {
  const selected = new Set(selectedSections || []);
  const keepColumns = selected.has("columns") || selected.has("schema");
  const keepFindings = selected.has("findings");
  const keepCorrelations = selected.has("correlations");
  const keepQuality = selected.has("quality_summary");

  return {
    ...profile,
    columns: keepColumns ? profile.columns : [],
    findings: keepFindings ? profile.findings : [],
    relationships: {
      ...(profile.relationships || {}),
      correlations: keepCorrelations ? (profile.relationships?.correlations || []) : [],
    },
    quality_summary: keepQuality ? profile.quality_summary : summarizeFindings(keepFindings ? (profile.findings || []) : []),
  };
}

function getRouteFromLocation() {
  if (typeof window === "undefined") {
    return { view: "dashboard", step: "source" };
  }

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") || "dashboard";
  const step = params.get("step") || "source";

  return {
    view: VALID_VIEWS.has(view) ? view : "dashboard",
    step: VALID_WORKSPACE_STEPS.has(step) ? step : "source",
  };
}

function routeToUrl(route) {
  const params = new URLSearchParams();
  if (route.view !== "dashboard") {
    params.set("view", route.view);
  }

  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

function getStoredSessionState() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(APP_STATE_SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredSessionState(state) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(APP_STATE_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Session storage is best-effort; large profiling results can exceed browser quota.
  }
}

function clearLegacyStoredDbValues() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("profiling-agent.dbValues");
  } catch {
    // Ignore cleanup failures; credentials still are not written by this version.
  }
}

function toClientChatMessage(message) {
  return {
    id: message.id,
    role: message.role,
    text: message.content,
    createdAt: message.created_at,
    runId: message.run_id,
  };
}

function isStaleConversationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("conversation") && (
    message.includes("not found")
    || message.includes("does not belong")
    || message.includes("403")
  );
}

function isUploadableFile(file) {
  return Boolean(
    file
    && typeof file.name === "string"
    && typeof file.size === "number"
    && typeof file.arrayBuffer === "function"
  );
}

function tableKey(table) {
  return `${table.schema_name || table.schema || ""}.${table.table_name || table.table || ""}`;
}

function toDatabasePlanTable(table) {
  return {
    schema: table.schema_name || table.schema || "",
    table: table.table_name || table.table || "",
  };
}
