'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import {
  AcceptedSchema,
  ArtifactListSchema,
  CatalogSchema,
  DecisionBriefResponseSchema,
  ExportResponseSchema,
  MessageSchema,
  ReportDetailSchema,
  ReportRecordSchema,
  RunDetailSchema,
  SessionSchema,
  SetupSchema,
  type ArtifactOf,
  type Catalog,
  type DecisionBriefResponse,
  type Role,
  type Session,
} from '@vda/contracts';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  Printer,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Workflow,
} from 'lucide-react';
import { ApiError, api, dateTime, errorMessage, post, scoped } from '../lib/client-api';
import { AnalysisResult, ReportBody } from './analysis-result';
import { AgentChat } from './agent-chat/agent-chat';
import { EvidenceDrawer } from './evidence';
import { HistoryPanel, ImportsPanel, SchedulesPanel, ScopeFields } from './resource-panels';

type Setup = z.infer<typeof SetupSchema>;
type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type ReportDetail = z.infer<typeof ReportDetailSchema>;
type Tab = 'analysis' | 'reports' | 'schedules' | 'imports' | 'history';
const navigation = [
  { id: 'analysis', name: 'Không gian phân tích', icon: LayoutDashboard },
  { id: 'reports', name: 'Báo cáo', icon: FileText },
  { id: 'schedules', name: 'Lịch báo cáo', icon: Clock3 },
  { id: 'imports', name: 'Nguồn dữ liệu', icon: Database },
  { id: 'history', name: 'Lịch sử', icon: Activity },
] as const;
const taskNames: Record<string, string> = {
  orchestrator: 'Điều phối',
  data: 'Dữ liệu',
  calculation: 'Tính toán',
  comparison: 'So sánh',
  chart: 'Biểu đồ',
  insight: 'Nhận định',
  validation: 'Kiểm tra',
  report: 'Báo cáo',
};
const statusNames: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang phân tích',
  succeeded: 'Hoàn thành',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

const developmentRoles: Array<{ role: Role; label: string; description: string }> = [
  { role: 'owner', label: 'Owner', description: 'Có quyền ghi trong workspace.' },
  { role: 'analyst', label: 'Analyst', description: 'Phân tích, nhập và cập nhật dữ liệu.' },
  { role: 'viewer', label: 'Viewer', description: 'Chỉ xem dữ liệu và báo cáo.' },
];

export function Workspace() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [orgId, setOrgId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSetup(await api('/setup', SetupSchema));
      try {
        const next = await api('/session', SessionSchema);
        setSession(next);
        setOrgId(next.organizations[0]?.org_id ?? '');
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 401)) throw cause;
        setSession(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  if (loading)
    return (
      <main className="loading-screen" role="status">
        <span className="brand-mark">V</span>
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
          setOrgId(value.organizations[0]?.org_id ?? '');
          setError('');
        }}
      />
    );
  const organization = session.organizations.find((item) => item.org_id === orgId);
  if (!organization)
    return (
      <main className="loading-screen">
        <ShieldCheck size={36} />
        <h1>Chưa có quyền truy cập workspace</h1>
        <p>Tài khoản chưa có membership. Liên hệ owner để được thêm vào workspace.</p>
        <button
          className="secondary"
          onClick={() =>
            void api('/auth/logout', z.unknown(), post({}))
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
      setOrgId={setOrgId}
      onLogout={async () => {
        await api('/auth/logout', z.unknown(), post({}));
        setSession(null);
      }}
    />
  );
}

function Login({
  setup,
  error: initialError,
  onRetry,
  onLogin,
}: {
  setup: Setup | null;
  error: string;
  onRetry: () => Promise<void>;
  onLogin: (session: Session) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(body: { email: string; password: string }) {
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/auth/login', SessionSchema, post(body)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function loginAsRole(role: Role) {
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/auth/development-role', SessionSchema, post({ role })));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="brand" href="/">
          <span className="brand-mark">V</span>
          <span>
            VDaAgent<span className="brand-sub">REAL ESTATE INTELLIGENCE</span>
          </span>
        </Link>
        <div className="login-story-content">
          <span className="eyebrow">TỪ DỮ LIỆU ĐẾN QUYẾT ĐỊNH</span>
          <h1>
            Mỗi nhận định.
            <br />
            Một chuỗi bằng chứng.
          </h1>
          <p>Hiểu rõ tồn kho, theo dõi sản phẩm chậm luân chuyển và tạo báo cáo có thể truy vết.</p>
          <div className="truth-chain">
            Data <ArrowRight size={14} /> Analysis <ArrowRight size={14} /> Evidence{' '}
            <ArrowRight size={14} /> Insight <ArrowRight size={14} /> Report
          </div>
        </div>
        <div className="login-story-footer">
          <ShieldCheck size={18} /> Dữ liệu được phân tách theo workspace
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span>
          <h2>Bắt đầu khám phá</h2>
          <p className="muted">
            {setup?.development_role_bypass
              ? 'Chọn vai trò để mở workspace ngay.'
              : 'Đăng nhập để mở không gian phân tích của bạn.'}
          </p>
          {setup && (
            <div className="notice">
              <Sparkles size={18} />
              <div>
                <strong>
                  {setup.development_role_bypass ? 'Chế độ development' : 'Supabase workspace'}
                </strong>
                <p>{setup.message}</p>
                <p>
                  Nhận định qua {setup.llm_primary_provider === 'gemini' ? 'Gemini' : 'OpenAI'}
                  {' · '}dự phòng {setup.llm_fallback_provider === 'openai' ? 'OpenAI' : 'Gemini'}
                </p>
              </div>
            </div>
          )}
          {(initialError || error) && (
            <div className="error-box" role="alert">
              {error || initialError}
            </div>
          )}
          {!setup ? (
            <button className="primary" onClick={() => void onRetry()}>
              Thử kết nối lại
            </button>
          ) : setup.development_role_bypass ? (
            <div className="role-login" aria-label="Development role selection">
              {developmentRoles.map(({ role, label, description }) => (
                <button
                  key={role}
                  className="secondary full-width"
                  disabled={busy || !setup.ready}
                  onClick={() => void loginAsRole(role)}
                >
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void login({ email, password });
              }}
              className="login-form"
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Mật khẩu
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="primary full-width" disabled={busy || !setup.ready}>
                {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          <p className="login-disclaimer">
            Assumption / MVP provisional
            <br />
            Công thức semantic chưa được BA/Data Owner phê duyệt.
          </p>
        </div>
      </section>
    </main>
  );
}

function WorkspaceShell({
  session,
  setup,
  organization,
  setOrgId,
  onLogout,
}: {
  session: Session;
  setup: Setup | null;
  organization: Session['organizations'][number];
  setOrgId: (id: string) => void;
  onLogout: () => Promise<void>;
}) {
  const orgId = organization.org_id;
  const canWrite = organization.role !== 'viewer';
  const [tab, setTab] = useState<Tab>('analysis');
  const [catalog, setCatalog] = useState<Catalog>({ projects: [], latest_snapshot_date: null });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [project, setProject] = useState('');
  const [zone, setZone] = useState('');
  const [dataAsOf, setDataAsOf] = useState('');
  const [question, setQuestion] = useState('Phân tích tồn kho và các sản phẩm chậm luân chuyển.');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<z.infer<typeof MessageSchema>[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [bundle, setBundle] = useState<ArtifactList>({
    artifacts: [],
    validations: [],
    sources: [],
  });
  const [brief, setBrief] = useState<DecisionBriefResponse | null>(null);
  const [briefStatus, setBriefStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>(
    'idle',
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollEpoch, setPollEpoch] = useState(0);
  const refreshCatalog = useCallback(async () => {
    const value = await api(scoped('/catalog', orgId), CatalogSchema);
    setCatalog(value);
    setProject((current) =>
      value.projects.some((item) => item.project_external_id === current)
        ? current
        : (value.projects[0]?.project_external_id ?? ''),
    );
    setDataAsOf((current) => current || value.latest_snapshot_date || '');
  }, [orgId]);
  useEffect(() => {
    void refreshCatalog()
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setCatalogLoading(false));
  }, [refreshCatalog]);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const detail = await api(scoped(`/runs/${runId}`, orgId), RunDetailSchema);
        if (cancelled) return;
        setRunDetail(detail);
        const conversation = detail.run.request.conversation_id;
        if (conversation) {
          const value = await api(
            scoped(`/messages?conversation_id=${encodeURIComponent(conversation)}`, orgId),
            z.object({ messages: z.array(MessageSchema) }),
          );
          if (cancelled) return;
          setMessages(value.messages);
          setConversationId(conversation);
        }
        if (detail.run.status === 'succeeded') {
          if (!cancelled) setBriefStatus('loading');
          try {
            const nextBrief = await api(
              scoped(`/runs/${runId}/brief`, orgId),
              DecisionBriefResponseSchema,
            );
            if (!cancelled) {
              setBrief(nextBrief);
              setBriefStatus('available');
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
            if (!cancelled) setBriefStatus('unavailable');
            const nextBundle = await api(
              scoped(`/runs/${runId}/artifacts`, orgId),
              ArtifactListSchema,
            );
            if (!cancelled) setBundle(nextBundle);
          }
        } else if (['failed', 'cancelled'].includes(detail.run.status)) {
          if (!cancelled) setBriefStatus('unavailable');
          const nextBundle = await api(
            scoped(`/runs/${runId}/artifacts`, orgId),
            ArtifactListSchema,
          );
          if (!cancelled) setBundle(nextBundle);
        } else if (!cancelled) timer = setTimeout(() => void poll(), 1100);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, orgId, pollEpoch]);
  function selectRun(id: string, conversation?: string) {
    setRunId(id);
    setConversationId(conversation ?? null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setBriefStatus('idle');
    setDetailsLoading(false);
    setReport(null);
    setMessages([]);
    setEvidenceId(null);
    setError('');
    setTab('analysis');
    setPollEpoch((value) => value + 1);
  }
  async function loadRunArtifacts() {
    if (!runId || bundle.artifacts.length || detailsLoading) return;
    setDetailsLoading(true);
    try {
      setBundle(await api(scoped(`/runs/${runId}/artifacts`, orgId), ArtifactListSchema));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailsLoading(false);
    }
  }
  async function openEvidence(id: string) {
    if (!bundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
      if (!runId) return;
      setDetailsLoading(true);
      try {
        const nextBundle = await api(scoped(`/runs/${runId}/artifacts`, orgId), ArtifactListSchema);
        setBundle(nextBundle);
        if (!nextBundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
          setError('The referenced evidence artifact is unavailable for this run.');
          return;
        }
      } catch (cause) {
        setError(errorMessage(cause));
        return;
      } finally {
        setDetailsLoading(false);
      }
    }
    setEvidenceId(id);
  }
  async function openReport(id: string) {
    setBusy(true);
    setError('');
    try {
      const detail = await api(scoped(`/reports/${id}`, orgId), ReportDetailSchema);
      const nextBundle = await api(
        scoped(`/runs/${detail.report.run_id}/artifacts`, orgId),
        ArtifactListSchema,
      );
      setBundle(nextBundle);
      setReport(detail);
      setTab('reports');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openRunReport() {
    setBusy(true);
    setError('');
    try {
      const { reports } = await api(
        scoped('/reports', orgId),
        z.object({ reports: z.array(ReportRecordSchema) }),
      );
      const found = reports.find((item) => item.run_id === runId);
      if (!found) throw new Error('Báo cáo chưa được xuất bản. Hãy thử lại sau.');
      await openReport(found.report_id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exportReport(format: 'json' | 'csv') {
    if (!report) return;
    setBusy(true);
    setError('');
    try {
      const exported = await api(
        scoped(`/reports/${report.report.report_id}/exports`, orgId),
        ExportResponseSchema,
        post({ format }),
      );
      const anchor = document.createElement('a');
      anchor.href = exported.url;
      anchor.download = `report-${report.report.report_id}.${format}`;
      anchor.rel = 'noopener';
      anchor.click();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const active = runDetail && ['queued', 'running'].includes(runDetail.run.status);
  const selectedArtifact = bundle.artifacts.find((item) => item.artifact_id === evidenceId);
  const currentNav = navigation.find((item) => item.id === tab)!;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">V</span>
          <span>
            VDaAgent<span className="brand-sub">INTELLIGENCE WORKSPACE</span>
          </span>
        </Link>
        <div className="workspace-picker">
          <Building2 size={20} />
          <label>
            <span className="sr-only">Workspace</span>
            <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
              {session.organizations.map((item) => (
                <option key={item.org_id} value={item.org_id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span>{organization.role}</span>
          </label>
          <ChevronDown size={14} />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Điều hướng chính">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => {
                setTab(item.id);
                setEvidenceId(null);
                if (item.id === 'reports') setReport(null);
              }}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              {item.name}
              {tab === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="trust-note">
            <Workflow size={22} />
            <strong>Mọi con số đều có nguồn.</strong>
            <p>Từ snapshot đến báo cáo, luôn giữ nguyên chuỗi bằng chứng.</p>
            <span className="badge">SUPABASE</span>
          </div>
          <div className="user-row">
            <span className="avatar">{organization.role.slice(0, 1).toUpperCase()}</span>
            <span className="user-identity">
              <strong>{organization.role}</strong>
              <small title={session.email}>{session.email}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Đăng xuất"
              onClick={() =>
                void onLogout().catch((cause: unknown) => setError(errorMessage(cause)))
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span> <strong>{currentNav.name}</strong>
          </div>
          <div className="topbar-status">
            <span className="live-dot" />
            {setup
              ? `${setup.llm_primary_provider === 'gemini' ? 'Gemini' : 'OpenAI'} → ${setup.llm_fallback_provider === 'openai' ? 'OpenAI' : 'Gemini'}`
              : 'Đang kiểm tra LLM'}
            <span className="badge">{organization.role}</span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <header className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === 'analysis' ? 'INVENTORY INTELLIGENCE' : 'VDaAgent WORKSPACE'}
              </span>
              <h1>{currentNav.name}</h1>
              <p>
                {tab === 'analysis'
                  ? 'Hiểu dữ liệu. Khám phá bằng chứng. Tự tin với từng nhận định.'
                  : 'Phân tích có thể kiểm chứng, trong cùng một không gian.'}
              </p>
            </div>
            {tab === 'analysis' && runId && (
              <button
                className="secondary"
                onClick={() => {
                  setRunId(null);
                  setRunDetail(null);
                  setMessages([]);
                  setConversationId(null);
                  setBundle({ artifacts: [], validations: [], sources: [] });
                  setBrief(null);
                  setBriefStatus('idle');
                  setDetailsLoading(false);
                  setError('');
                }}
              >
                <Plus size={16} />
                Mở Agent Chat
              </button>
            )}
          </header>
          <div className="provisional-banner">
            <ShieldCheck size={17} />
            <span>
              <strong>Assumption / MVP provisional</strong>
              <span className="banner-detail"> · Semantic chưa được BA/Data Owner phê duyệt.</span>
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
          {catalogLoading ? (
            <div className="card loading-panel" role="status">
              <LoaderCircle className="spin" />
              Đang tải workspace…
            </div>
          ) : (
            <>
              {tab === 'analysis' &&
                (runId ? (
                  <div className="result-stack">
                    <section className="card analysis-composer">
                      <header className="section-heading">
                        <div className="composer-title">
                          <span className="spark-icon">
                            <Sparkles size={20} />
                          </span>
                          <div>
                            <h2>Bạn muốn tìm hiểu điều gì?</h2>
                            <p>Chọn phạm vi, đặt câu hỏi và để dữ liệu trả lời.</p>
                          </div>
                        </div>
                        <span className="badge">Project / Zone</span>
                      </header>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          setBusy(true);
                          setError('');
                          void api('/analyses', AcceptedSchema, {
                            ...post({
                              org_id: orgId,
                              scope: {
                                project_external_id: project,
                                zone_external_id: zone || null,
                              },
                              data_as_of: dataAsOf,
                              question,
                              conversation_id: conversationId,
                            }),
                            headers: { 'Idempotency-Key': crypto.randomUUID() },
                          })
                            .then((accepted) =>
                              selectRun(accepted.run_id, accepted.conversation_id),
                            )
                            .catch((cause: unknown) => setError(errorMessage(cause)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        <div className="scope-row">
                          <ScopeFields
                            catalog={catalog}
                            project={project}
                            zone={zone}
                            setProject={setProject}
                            setZone={setZone}
                          />
                          <label>
                            Ngày dữ liệu
                            <input
                              type="date"
                              required
                              value={dataAsOf}
                              onChange={(event) => setDataAsOf(event.target.value)}
                            />
                          </label>
                        </div>
                        <label className="question-label">
                          <span className="sr-only">Câu hỏi phân tích</span>
                          <textarea
                            aria-label="Câu hỏi phân tích"
                            value={question}
                            onChange={(event) => setQuestion(event.target.value)}
                            maxLength={2000}
                            required
                            rows={2}
                            placeholder="Ví dụ: Phân khu nào có sản phẩm chậm luân chuyển?"
                            disabled={!canWrite}
                          />
                        </label>
                        <div className="composer-footer">
                          <span>
                            <span className="live-dot" />
                            {catalog.latest_snapshot_date
                              ? `Snapshot mới nhất: ${catalog.latest_snapshot_date}`
                              : 'Chưa có snapshot'}{' '}
                            · {zone ? 'Phạm vi Zone' : 'Phạm vi Project'}
                          </span>
                          <button
                            className="primary"
                            type="submit"
                            disabled={
                              !canWrite ||
                              busy ||
                              !!active ||
                              !project ||
                              !dataAsOf ||
                              !question.trim()
                            }
                          >
                            {busy || active ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <Send size={16} />
                            )}
                            {busy || active ? 'Đang phân tích…' : 'Phân tích'}
                          </button>
                        </div>
                      </form>
                      {!canWrite && (
                        <p className="viewer-notice">
                          <ShieldCheck size={15} />
                          Bạn đang ở chế độ xem. Mở lịch sử hoặc báo cáo để khám phá bằng chứng.
                        </p>
                      )}
                    </section>
                    {!runId && (
                      <>
                        <div className="suggestion-row">
                          {[
                            'Tổng quan tồn kho hiện tại',
                            'Phân tích tuổi tồn và chậm luân chuyển',
                            'So sánh sản phẩm với nhóm tương đồng',
                          ].map((suggestion) => (
                            <button
                              key={suggestion}
                              className="suggestion"
                              disabled={!canWrite}
                              onClick={() => setQuestion(suggestion)}
                            >
                              {suggestion}
                              <ArrowUpRight size={14} />
                            </button>
                          ))}
                        </div>
                        <section className="card welcome-card">
                          <div className="welcome-orbit">
                            <Workflow size={35} strokeWidth={1.3} />
                          </div>
                          <span className="eyebrow">MỘT CÂU HỎI. TOÀN BỘ BỐI CẢNH.</span>
                          <h2>
                            {catalog.projects.length
                              ? 'Bắt đầu từ dữ liệu của bạn'
                              : 'Workspace chưa có dữ liệu'}
                          </h2>
                          <p>
                            {catalog.projects.length
                              ? 'Kết quả phân tích, biểu đồ và nhận định sẽ xuất hiện tại đây. Mỗi giá trị đều liên kết tới phép tính và snapshot nguồn.'
                              : 'Nhập snapshot CSV trong Nguồn dữ liệu để bắt đầu phân tích.'}
                          </p>
                          <div className="welcome-steps">
                            <span>
                              <Database size={17} />
                              Dữ liệu
                            </span>
                            <ArrowRight size={14} />
                            <span>
                              <Activity size={17} />
                              Phân tích
                            </span>
                            <ArrowRight size={14} />
                            <span>
                              <ShieldCheck size={17} />
                              Bằng chứng
                            </span>
                            <ArrowRight size={14} />
                            <span>
                              <FileText size={17} />
                              Báo cáo
                            </span>
                          </div>
                        </section>
                      </>
                    )}
                    {runId && (
                      <section className="card progress-card" aria-live="polite">
                        <header className="section-heading">
                          <div>
                            <span className="eyebrow">ANALYTICAL PIPELINE</span>
                            <h2>
                              {runDetail
                                ? statusNames[runDetail.run.status]
                                : 'Đang tải lượt phân tích…'}
                            </h2>
                          </div>
                          <div className="button-row">
                            {runDetail?.run.status === 'succeeded' && (
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => void openRunReport()}
                              >
                                <FileText size={16} />
                                Xem báo cáo
                              </button>
                            )}
                            {active && canWrite && (
                              <button
                                className="secondary"
                                disabled={busy || runDetail.run.cancel_requested}
                                onClick={() => {
                                  setBusy(true);
                                  void api(
                                    scoped(`/runs/${runId}/cancel`, orgId),
                                    z.unknown(),
                                    post({ org_id: orgId }),
                                  )
                                    .catch((cause: unknown) => setError(errorMessage(cause)))
                                    .finally(() => setBusy(false));
                                }}
                              >
                                <Square size={12} />
                                {runDetail.run.cancel_requested ? 'Đang hủy…' : 'Hủy lượt chạy'}
                              </button>
                            )}
                          </div>
                        </header>
                        <div className="task-track">
                          {runDetail?.tasks.map((task) => (
                            <div className={`task-step task-${task.status}`} key={task.task_id}>
                              <span>
                                {task.status === 'succeeded' ? (
                                  <Check size={15} />
                                ) : task.status === 'running' ? (
                                  <LoaderCircle size={15} className="spin" />
                                ) : task.status === 'failed' ? (
                                  <CircleAlert size={15} />
                                ) : (
                                  <span className="task-point" />
                                )}
                              </span>
                              <strong>{taskNames[task.kind]}</strong>
                            </div>
                          ))}
                        </div>
                        {runDetail?.run.error_code && (
                          <p className="error-box">{runDetail.run.error_code}</p>
                        )}
                        <details className="diagnostics">
                          <summary>Chẩn đoán · run_id: {runId}</summary>
                          <dl className="metadata-list">
                            <dt>Phạm vi</dt>
                            <dd>
                              {runDetail?.run.request.scope.project_external_id} /{' '}
                              {runDetail?.run.request.scope.zone_external_id ?? 'Project'}
                            </dd>
                            <dt>Ngày dữ liệu</dt>
                            <dd>{runDetail?.run.request.data_as_of}</dd>
                            <dt>Số lần thực thi</dt>
                            <dd>{runDetail?.run.attempt}</dd>
                          </dl>
                          {runDetail?.events.map((event) => (
                            <p key={event.event_id}>
                              <time>{dateTime(event.created_at)}</time> {event.message}
                            </p>
                          ))}
                        </details>
                      </section>
                    )}
                    {messages.length > 0 && (
                      <section className="card conversation">
                        <header className="section-heading">
                          <h2>Hội thoại phân tích</h2>
                          <span className="badge">{messages.length} tin nhắn</span>
                        </header>
                        {messages.map((message) => (
                          <div
                            className={`message message-${message.role}`}
                            key={message.message_id}
                          >
                            <span className="message-role">
                              {message.role === 'user' ? 'Bạn' : 'VDaAgent'}
                            </span>
                            <p>{message.content}</p>
                            {message.run_id && (
                              <button
                                className="text-button"
                                onClick={() => selectRun(message.run_id!, message.conversation_id)}
                              >
                                Xem lượt phân tích
                                <ArrowUpRight size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </section>
                    )}
                    <AnalysisResult
                      artifacts={bundle.artifacts}
                      brief={brief}
                      briefStatus={briefStatus}
                      detailsLoading={detailsLoading}
                      onEvidence={(id) => void openEvidence(id)}
                      onLoadDetails={() => void loadRunArtifacts()}
                      onReport={
                        runDetail?.run.status === 'succeeded'
                          ? () => void openRunReport()
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <AgentChat
                    orgId={orgId}
                    catalog={catalog}
                    canWrite={canWrite}
                    onReport={(id) => void openReport(id)}
                  />
                ))}
              {tab === 'reports' &&
                (report?.artifact.kind === 'report' ? (
                  <div className="card report-detail">
                    <header className="section-heading no-print">
                      <button className="text-button" onClick={() => setReport(null)}>
                        ← Thư viện báo cáo
                      </button>
                      <div className="button-row">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void exportReport('json')}
                        >
                          <ArrowDownToLine size={15} />
                          JSON
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void exportReport('csv')}
                        >
                          <ArrowDownToLine size={15} />
                          CSV
                        </button>
                        <button className="secondary" onClick={() => window.print()}>
                          <Printer size={15} />
                          In báo cáo
                        </button>
                      </div>
                    </header>
                    <ReportBody
                      payload={report.artifact.payload}
                      dataAsOf={report.artifact.data_as_of}
                      visualEvidence={
                        bundle.artifacts.find(
                          (item): item is ArtifactOf<'visual_evidence'> =>
                            item.kind === 'visual_evidence',
                        )?.payload
                      }
                      onEvidence={setEvidenceId}
                    />
                    <details className="no-print">
                      <summary>Metadata báo cáo</summary>
                      <code>
                        run_id: {report.report.run_id}
                        <br />
                        artifact_id: {report.artifact.artifact_id}
                        <br />
                        content_hash: {report.artifact.content_hash}
                      </code>
                      <button
                        className="text-button"
                        onClick={() => setEvidenceId(report.artifact.artifact_id)}
                      >
                        Mở artifact báo cáo
                        <ArrowUpRight size={14} />
                      </button>
                    </details>
                  </div>
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
          <footer className="workspace-footer">
            <span>VDaAgent · Local MVP</span>
            <span>Data → Analysis → Evidence → Insight → Report</span>
          </footer>
        </main>
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
    </div>
  );
}
