'use client';

import { useCallback, useReducer, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { SetupSchema, type Session } from '@vda/contracts';
import { CircleAlert, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../lib/http/api-client';
import { MascotAvatar } from '../../components/assistant';
import { organizationFromSession, useSessionBootstrap } from '../auth/hooks/use-session-bootstrap';
import { logout } from '../auth/api/session';
import { Login } from '../auth/components/login';
import { AgentChat } from '../agent-chat/agent-chat';
import { EvidenceDrawer } from '../evidence/components/evidence';
import { useEvidenceSelection } from '../evidence/hooks/use-evidence-selection';
import { GrokWorkspace } from '../grok-workspace/components/grok-workspace';
import { HistoryPanel } from '../runs/components/history-panel';
import { ImportsPanel } from '../imports/components/imports-panel';
import { SchedulesPanel } from '../schedules/components/schedules-panel';
import { AppShell } from '../../components/shell/app-shell';
import {
  defaultWorkspaceRoute,
  workspaceRouteHref,
  type WorkspaceRoute,
} from '../../components/shell/routes';
import { WorkspaceDashboard } from './dashboard/workspace-dashboard';
import { useWorkspaceBootstrap } from './hooks/use-workspace-bootstrap';
import { useAnalysisRun } from '../analysis/hooks/use-analysis-run';
import { useWorkspaceReport } from '../reports/hooks/use-workspace-report';
import { WorkspaceReportDetail } from '../reports/components/workspace-report-detail';
import {
  resolveWorkspaceRoute,
  safeRouteForOrganization,
  useWorkspaceRouteSelection,
} from './routing/workspace-route';
import { initialWorkspaceContextState, workspaceContextReducer } from './context';

type Setup = z.infer<typeof SetupSchema>;
type Tab = 'dashboard' | 'analysis' | 'reports' | 'schedules' | 'imports' | 'history';
export function Workspace({ route = defaultWorkspaceRoute }: { route?: WorkspaceRoute }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedOrgId = searchParams.get('org_id');
  const { setup, session, setSession, orgId, setOrgId, loading, error, setError, initialize } =
    useSessionBootstrap(requestedOrgId);
  if (loading)
    return (
      <main className="loading-screen" role="status">
        <MascotAvatar decorative state="thinking" size={58} />
        <span className="eyebrow">VDa NAVIGATOR</span>
        <p>Đang mở không gian phân tích…</p>
      </main>
    );
  if (!session)
    return (
      <Login
        setup={setup}
        error={error}
        onRetry={initialize}
        onLogin={(value) => {
          setSession(value);
          setOrgId(organizationFromSession(value, requestedOrgId));
          setError('');
        }}
      />
    );
  const organization = session.organizations.find((item) => item.org_id === orgId);
  if (!organization)
    return (
      <main className="loading-screen" role="alert">
        <MascotAvatar decorative state="warning" size={58} />
        <span className="eyebrow">VDa NAVIGATOR · TRUY CẬP</span>
        <ShieldCheck size={36} />
        <h1>Chưa có quyền truy cập workspace</h1>
        <p>Tài khoản chưa thuộc workspace này. Liên hệ chủ sở hữu để được thêm vào.</p>
        <button
          className="secondary"
          onClick={() =>
            void logout()
              .then(() => setSession(null))
              .catch((cause: unknown) => setError(errorMessage(cause)))
          }
        >
          Đăng xuất
        </button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <WorkspaceShell
      key={`${session.user_id}:${orgId}`}
      session={session}
      setup={setup}
      organization={organization}
      setOrgId={(nextOrgId) => {
        if (!session.organizations.some((item) => item.org_id === nextOrgId)) return;
        setOrgId(nextOrgId);
        router.replace(workspaceRouteHref(safeRouteForOrganization(route), nextOrgId));
      }}
      route={route}
      onLogout={async () => {
        await logout();
        setSession(null);
      }}
    />
  );
}

function WorkspaceShell({
  session,
  setup,
  organization,
  setOrgId,
  onLogout,
  route,
}: {
  session: Session;
  setup: Setup | null;
  organization: Session['organizations'][number];
  setOrgId: (id: string) => void;
  onLogout: () => Promise<void>;
  route: WorkspaceRoute;
}) {
  const router = useRouter();
  const routeSelection = resolveWorkspaceRoute(route);
  const { routeMeta, routedConversationId } = routeSelection;
  const orgId = organization.org_id;
  const canWrite = organization.role !== 'viewer';
  const [tab, setTab] = useState<Tab>(routeMeta.surface);
  const [workspaceContextState, dispatchWorkspaceContext] = useReducer(
    workspaceContextReducer,
    initialWorkspaceContextState,
  );
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const analysis = useAnalysisRun(orgId, setError, false);
  const {
    setConversationId,
    setMessages,
    runId,
    setRunId,
    setRunDetail,
    bundle,
    setBundle,
    setBrief,
    decision,
    setDecision,
    setBriefStatus,
    setDetailsLoading,
    setPollEpoch,
  } = analysis;
  const { report, setReport, openReport, exportReport } = useWorkspaceReport(
    orgId,
    runId,
    setBundle,
    setDecision,
    setTab,
    setBusy,
    setError,
  );
  const { evidenceId, setEvidenceId, selectedArtifact } = useEvidenceSelection(
    orgId,
    runId,
    bundle,
    setBundle,
    setDetailsLoading,
    setError,
  );
  const grokWorkspaceEnabled = setup?.grok_workspace_enabled === true;
  const { catalog, catalogLoading, project, setProject, dataAsOf, setDataAsOf, refreshCatalog } =
    useWorkspaceBootstrap(orgId, setError);
  function updateWorkspaceProject(value: string) {
    setProject(value);
    dispatchWorkspaceContext({ type: 'clear_for_scope_change' });
  }
  function updateWorkspaceZone(value: string) {
    setZone(value);
    dispatchWorkspaceContext({ type: 'clear_for_scope_change' });
  }
  function updateWorkspaceDataAsOf(value: string) {
    setDataAsOf(value);
    dispatchWorkspaceContext({ type: 'clear_for_scope_change' });
  }
  const selectRun = useCallback(
    (id: string, conversation?: string, navigate = true) => {
      setRunId(id);
      dispatchWorkspaceContext({ type: 'set_active_run', run_id: id });
      setConversationId(conversation ?? null);
      setRunDetail(null);
      setBundle({ artifacts: [], validations: [], sources: [] });
      setBrief(null);
      setDecision(null);
      setBriefStatus('idle');
      setDetailsLoading(false);
      setReport(null);
      setMessages([]);
      setEvidenceId(null);
      setError('');
      setTab('analysis');
      setPollEpoch((value) => value + 1);
      if (navigate) router.push(workspaceRouteHref({ page: 'runs', runId: id }, orgId));
    },
    [
      orgId,
      router,
      setBrief,
      setBriefStatus,
      setBundle,
      setConversationId,
      setDecision,
      setDetailsLoading,
      setMessages,
      setPollEpoch,
      setRunDetail,
      setRunId,
      setReport,
      setEvidenceId,
    ],
  );
  function clearSelectedRun() {
    setRunId(null);
    dispatchWorkspaceContext({ type: 'set_active_run', run_id: null });
    setRunDetail(null);
    setMessages([]);
    setConversationId(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setDetailsLoading(false);
    setError('');
  }
  useWorkspaceRouteSelection(
    route,
    routeSelection,
    setTab,
    setEvidenceId,
    dispatchWorkspaceContext,
    selectRun,
    openReport,
  );
  const statusText = setup
    ? `Mô hình: ${setup.llm_primary_provider === 'gemini' ? 'Gemini' : 'OpenAI'} · Dự phòng: ${setup.llm_fallback_provider === 'openai' ? 'OpenAI' : 'Gemini'}`
    : 'Đang kiểm tra cấu hình mô hình';
  return (
    <AppShell
      section={routeMeta.section}
      title={routeMeta.title}
      eyebrow={routeMeta.eyebrow}
      description={routeMeta.description}
      session={session}
      organization={organization}
      setOrgId={setOrgId}
      onLogout={async () => {
        try {
          await onLogout();
        } catch (cause) {
          setError(errorMessage(cause));
        }
      }}
      statusText={statusText}
      presentation={tab === 'analysis' && grokWorkspaceEnabled ? 'analytical' : 'standard'}
      pageHeader={false}
    >
      <div
        id="workspace-content"
        className={tab === 'dashboard' ? 'workspace-dashboard-route' : undefined}
      >
        <header className="page-heading">
          <div>
            <span className="eyebrow">{routeMeta.eyebrow}</span>
            <h1>{routeMeta.title}</h1>
            <p>
              {tab === 'analysis'
                ? 'Hiểu dữ liệu. Khám phá bằng chứng. Tự tin với từng nhận định.'
                : 'Phân tích có thể kiểm chứng, trong cùng một không gian.'}
            </p>
          </div>
          {tab === 'analysis' && !grokWorkspaceEnabled && runId && (
            <button className="secondary" onClick={clearSelectedRun}>
              <Plus size={16} />
              Mở Agent Chat
            </button>
          )}
        </header>
        <div className="provisional-banner">
          <ShieldCheck size={17} />
          <span>
              <strong>Giả định và giới hạn tạm thời</strong>
              <span className="banner-detail"> · Công thức ngữ nghĩa chưa được chuyên viên nghiệp vụ hoặc chủ sở hữu dữ liệu phê duyệt.</span>
          </span>
          <span className="banner-version">mvp-inventory-v0.2</span>
        </div>
        {error && (
          <div className="error-box" role="alert">
            <CircleAlert size={19} />
            <div>
              {error}
              {runId && <code>run_id: {runId}</code>}
            </div>
            <button
              className="text-button"
              onClick={() => {
                setError('');
                setPollEpoch((value) => value + 1);
                void refreshCatalog().catch((cause: unknown) => setError(errorMessage(cause)));
              }}
            >
              Thử lại
            </button>
          </div>
        )}
        {tab === 'dashboard' ? (
          <WorkspaceDashboard
            orgId={orgId}
            organizationName={organization.name}
            onStartAnalysis={() => router.push(workspaceRouteHref({ page: 'chat' }, orgId))}
            onOpenRun={(nextRunId) => selectRun(nextRunId)}
            onOpenConversation={(conversationId) =>
              router.push(workspaceRouteHref({ page: 'chat', conversationId }, orgId))
            }
            onOpenReport={(nextReportId) => void openReport(nextReportId)}
            onOpenImports={() => router.push(workspaceRouteHref({ page: 'imports' }, orgId))}
            onOpenSchedules={() => router.push(workspaceRouteHref({ page: 'automations' }, orgId))}
          />
        ) : catalogLoading ? (
          <div className="card loading-panel" role="status">
            <LoaderCircle className="spin" />
            Đang tải workspace…
          </div>
        ) : (
          <>
            {tab === 'analysis' && grokWorkspaceEnabled && (
              <GrokWorkspace
                orgId={orgId}
                organizationName={organization.name}
                catalog={catalog}
                canWrite={canWrite}
                sseEnabled={setup?.grok_runtime_enabled === true && setup.grok_sse_enabled === true}
                project={project}
                zone={zone}
                dataAsOf={dataAsOf}
                initialConversationId={routedConversationId}
                externalRunId={routeSelection.routedRunId}
                workspaceState={workspaceContextState}
                workspaceRevision={workspaceContextState.revision}
                staleSelectionCleared={workspaceContextState.stale_selection_cleared}
                onProject={updateWorkspaceProject}
                onZone={updateWorkspaceZone}
                onDataAsOf={updateWorkspaceDataAsOf}
                onActiveRunChange={(value) =>
                  dispatchWorkspaceContext({ type: 'set_active_run', run_id: value })
                }
                onWorkspaceAction={(action, expectedRevision) =>
                  dispatchWorkspaceContext({
                    type: 'apply_workspace_action',
                    action,
                    expected_revision: expectedRevision,
                  })
                }
                onDashboardSelectionChange={(selection, runId) =>
                  dispatchWorkspaceContext({
                    type: 'set_dashboard_selection',
                    selection,
                    run_id: runId,
                  })
                }
                onActiveArtifactChange={(artifactId) =>
                  dispatchWorkspaceContext({
                    type: 'set_active_artifact',
                    artifact_id: artifactId,
                  })
                }
                onClearStaleNotice={() => dispatchWorkspaceContext({ type: 'clear_stale_notice' })}
              />
            )}
            {tab === 'analysis' && !grokWorkspaceEnabled && (
              <AgentChat
                orgId={orgId}
                catalog={catalog}
                canWrite={canWrite}
                sseEnabled={setup?.grok_runtime_enabled === true && setup.grok_sse_enabled === true}
                initialConversationId={routedConversationId}
                workspaceState={workspaceContextState}
                workspaceMode="agent_chat"
                onActiveRunChange={(value) =>
                  dispatchWorkspaceContext({ type: 'set_active_run', run_id: value })
                }
                onWorkspaceAction={(action) =>
                  dispatchWorkspaceContext({ type: 'apply_workspace_action', action })
                }
                externalRunId={runId}
                onClearExternalRun={clearSelectedRun}
                onReport={(id) => void openReport(id)}
              />
            )}
            {tab === 'reports' &&
              (report?.artifact.kind === 'report' ? (
                <WorkspaceReportDetail
                  report={report.report}
                  artifact={report.artifact}
                  decision={decision}
                  artifacts={bundle.artifacts}
                  busy={busy}
                  onClose={() => setReport(null)}
                  onExport={(format) => void exportReport(format)}
                  onEvidence={setEvidenceId}
                />
              ) : (
                <HistoryPanel orgId={orgId} kind="reports" onOpen={(id) => void openReport(id)} />
              ))}
            {tab === 'history' && <HistoryPanel orgId={orgId} kind="runs" onOpen={selectRun} />}
            {tab === 'imports' && (
              <ImportsPanel orgId={orgId} canWrite={canWrite} onImported={refreshCatalog} />
            )}
            {tab === 'schedules' && (
              <SchedulesPanel
                orgId={orgId}
                canWrite={canWrite}
                catalog={catalog}
                onRun={selectRun}
              />
            )}
          </>
        )}
        {busy && tab !== 'analysis' && (
          <p className="floating-status" role="status">
            <LoaderCircle size={16} className="spin" />
            Đang xử lý…
          </p>
        )}
      </div>
      {selectedArtifact && (
        <EvidenceDrawer
          artifact={selectedArtifact}
          artifacts={bundle.artifacts}
          validations={bundle.validations}
          sources={bundle.sources}
          onSelect={setEvidenceId}
          onClose={() => setEvidenceId(null)}
        />
      )}
      {evidenceId && !selectedArtifact && (
        <div role="alert" className="floating-status">
          Không tìm thấy artifact trong lượt chạy này.
          <button className="text-button" onClick={() => setEvidenceId(null)}>
            Đóng
          </button>
        </div>
      )}
    </AppShell>
  );
}
