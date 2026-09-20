'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  AcceptedSchema,
  ImportManifestSchema,
  ReportDefinitionSchema,
  ReportRecordSchema,
  RunSchema,
  type Catalog,
  type ReportDefinition,
  type ReportDefinitionInput,
} from '@vda/contracts';
import {
  ArrowRight,
  CalendarClock,
  Clock3,
  FileSpreadsheet,
  FileText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, dateTime, errorMessage, post, scoped } from '../lib/client-api';

export function ScopeFields({
  catalog,
  project,
  zone,
  setProject,
  setZone,
}: {
  catalog: Catalog;
  project: string;
  zone: string;
  setProject: (value: string) => void;
  setZone: (value: string) => void;
}) {
  return (
    <>
      <label>
        Dự án
        <select
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setZone('');
          }}
          required
        >
          <option value="" disabled>
            Chọn dự án
          </option>
          {catalog.projects.map((item) => (
            <option key={item.project_external_id} value={item.project_external_id}>
              {item.project_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Phân khu
        <select value={zone} onChange={(event) => setZone(event.target.value)}>
          <option value="">Tất cả phân khu</option>
          {catalog.projects
            .find((item) => item.project_external_id === project)
            ?.zones.map((item) => (
              <option key={item.zone_external_id} value={item.zone_external_id}>
                {item.zone_name}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <LayersIcon />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function LayersIcon() {
  return <FileText size={26} strokeWidth={1.5} />;
}

export function HistoryPanel({
  orgId,
  kind,
  onOpen,
}: {
  orgId: string;
  kind: 'runs' | 'reports';
  onOpen: (id: string) => void;
}) {
  const [runs, setRuns] = useState<z.infer<typeof RunSchema>[]>([]);
  const [reports, setReports] = useState<z.infer<typeof ReportRecordSchema>[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      if (kind === 'runs')
        setRuns((await api(scoped('/runs', orgId), z.object({ runs: z.array(RunSchema) }))).runs);
      else
        setReports(
          (await api(scoped('/reports', orgId), z.object({ reports: z.array(ReportRecordSchema) })))
            .reports,
        );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [orgId, kind]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="card">
      <header className="section-heading">
        <div>
          <span className="eyebrow">{kind === 'runs' ? 'RUN HISTORY' : 'REPORT LIBRARY'}</span>
          <h2>{kind === 'runs' ? 'Lịch sử phân tích' : 'Thư viện báo cáo'}</h2>
        </div>
        <button className="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} /> Làm mới
        </button>
      </header>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="empty-inline">
          Đang tải…
        </p>
      ) : (
        <div className="history-list">
          {kind === 'runs'
            ? runs.map((run) => (
                <button
                  className="history-item"
                  key={run.run_id}
                  onClick={() => onOpen(run.run_id)}
                >
                  <span className="list-icon">
                    <Clock3 size={20} />
                  </span>
                  <span className="history-content">
                    <strong>{run.request.question}</strong>
                    <span>
                      {run.request.scope.project_external_id}
                      {run.request.scope.zone_external_id
                        ? ` / ${run.request.scope.zone_external_id}`
                        : ''}{' '}
                      · {run.request.data_as_of} · {run.entrypoint}
                    </span>
                    <code>{run.run_id}</code>
                  </span>
                  <span className={`status status-${run.status}`}>{run.status}</span>
                  <ArrowRight size={18} />
                </button>
              ))
            : reports.map((report) => (
                <button
                  className="history-item"
                  key={report.report_id}
                  onClick={() => onOpen(report.report_id)}
                >
                  <span className="list-icon">
                    <FileText size={20} />
                  </span>
                  <span className="history-content">
                    <strong>Báo cáo tồn kho · {dateTime(report.created_at)}</strong>
                    <span>
                      {report.occurrence_id ? 'Báo cáo theo lịch' : 'Báo cáo theo yêu cầu'}
                    </span>
                    <code>{report.report_id}</code>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
        </div>
      )}
      {!loading && !(kind === 'runs' ? runs.length : reports.length) && (
        <EmptyState title={kind === 'runs' ? 'Chưa có lượt phân tích' : 'Chưa có báo cáo'}>
          Chạy phân tích đầu tiên để tạo bộ bằng chứng và báo cáo cho workspace.
        </EmptyState>
      )}
    </section>
  );
}

export function ImportsPanel({
  orgId,
  canWrite,
  onImported,
}: {
  orgId: string;
  canWrite: boolean;
  onImported: () => Promise<void>;
}) {
  const [imports, setImports] = useState<z.infer<typeof ImportManifestSchema>[]>([]);
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setImports(
        (await api(scoped('/imports', orgId), z.object({ imports: z.array(ImportManifestSchema) })))
          .imports,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="result-stack">
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">SNAPSHOT IMPORT</span>
            <h2>Nhập dữ liệu CSV</h2>
          </div>
          <FileSpreadsheet size={23} className="muted" />
        </header>
        <p className="muted">
          Toàn bộ tệp được kiểm tra trước khi lưu. Mỗi lần nhập có manifest và SHA-256 để truy vết.
        </p>
        {!canWrite && (
          <p className="notice">
            Vai trò viewer chỉ được xem dữ liệu. Cần owner hoặc analyst để nhập CSV.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setSuccess('');
            void api(
              '/imports',
              z.object({ manifest: ImportManifestSchema }),
              post({ org_id: orgId, source_name: source, csv }),
            )
              .then(async ({ manifest }) => {
                setSuccess(`Đã nhập ${manifest.row_count} dòng từ ${manifest.source_name}.`);
                setCsv('');
                await refresh();
                await onImported();
              })
              .catch((cause: unknown) => setError(errorMessage(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="import-grid">
            <label className="upload-zone">
              <Upload size={25} />
              <strong>Chọn snapshot CSV</strong>
              <span>UTF-8 · Tối đa 2 MB</span>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Chọn tệp CSV"
                disabled={!canWrite || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2_000_000) {
                    setError('Tệp vượt quá giới hạn 2 MB.');
                    setCsv('');
                    return;
                  }
                  setSource(file.name);
                  void file
                    .text()
                    .then(setCsv)
                    .catch((cause: unknown) => setError(errorMessage(cause)));
                }}
              />
            </label>
            <div>
              <label>
                Tên nguồn
                <input
                  value={source}
                  maxLength={200}
                  required
                  disabled={!canWrite || busy}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="inventory-snapshot.csv"
                />
              </label>
              <p className="muted small">
                Trạng thái hợp lệ: available, reserved, sold, held, unknown. Ô thiếu được giữ là
                null.
              </p>
              <button
                type="submit"
                className="primary"
                disabled={!canWrite || busy || !csv || !source}
              >
                <Upload size={16} />
                {busy ? 'Đang kiểm tra…' : 'Kiểm tra & nhập dữ liệu'}
              </button>
            </div>
          </div>
          <details>
            <summary>Các cột CSV v1 bắt buộc</summary>
            <code className="csv-columns">
              snapshot_date, market_external_id, market_name, project_external_id, project_name,
              zone_external_id, zone_name, unit_external_id, unit_code, unit_type, area_sqm,
              list_price, currency, status, available_since, sold_at
            </code>
          </details>
        </form>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="notice success">
            {success}
          </p>
        )}
      </section>
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">SOURCE MANIFESTS</span>
            <h2>Nguồn dữ liệu đã nhập</h2>
          </div>
        </header>
        {loading ? (
          <p role="status">Đang tải nguồn dữ liệu…</p>
        ) : imports.length ? (
          imports.map((item) => (
            <details className="import-record" key={item.import_id}>
              <summary>
                <strong>{item.source_name}</strong>
                <span>
                  {item.row_count} dòng · {dateTime(item.created_at)}
                </span>
              </summary>
              <dl className="metadata-list">
                <dt>Import ID</dt>
                <dd>
                  <code>{item.import_id}</code>
                </dd>
                <dt>File SHA-256</dt>
                <dd>
                  <code>{item.file_hash}</code>
                </dd>
                <dt>Schema</dt>
                <dd>{item.schema_version}</dd>
              </dl>
            </details>
          ))
        ) : (
          <EmptyState title="Chưa có nguồn dữ liệu">Nhập CSV để bắt đầu tạo snapshot.</EmptyState>
        )}
      </section>
    </div>
  );
}

export function SchedulesPanel({
  orgId,
  catalog,
  canWrite,
  onRun,
}: {
  orgId: string;
  catalog: Catalog;
  canWrite: boolean;
  onRun: (runId: string, conversationId: string) => void;
}) {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [project, setProject] = useState(catalog.projects[0]?.project_external_id ?? '');
  const [zone, setZone] = useState('');
  const [name, setName] = useState('Tồn kho hằng ngày');
  const [localTime, setLocalTime] = useState('08:00');
  const [timezone, setTimezone] = useState('Asia/Bangkok');
  const [policy, setPolicy] = useState<'scheduled_date' | 'previous_day'>('scheduled_date');
  const [editing, setEditing] = useState<ReportDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setDefinitions(
      (
        await api(
          scoped('/report-definitions', orgId),
          z.object({ definitions: z.array(ReportDefinitionSchema) }),
        )
      ).definitions,
    );
  }, [orgId]);
  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(errorMessage(cause)));
  }, [refresh]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function inputOf(definition: ReportDefinition): ReportDefinitionInput {
    return {
      org_id: orgId,
      name: definition.name,
      scope: definition.scope,
      timezone: definition.timezone,
      local_time: definition.local_time,
      data_as_of_policy: definition.data_as_of_policy,
      enabled: definition.enabled,
    };
  }
  return (
    <div className="result-stack">
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">AUTOMATED REPORTING</span>
            <h2>{editing ? 'Chỉnh sửa lịch báo cáo' : 'Báo cáo đúng nhịp làm việc'}</h2>
          </div>
          <CalendarClock size={23} className="muted" />
        </header>
        <p className="muted">
          Báo cáo hằng ngày dùng cùng pipeline phân tích và được lưu tại thư viện. Múi giờ áp dụng
          cho thời gian chạy.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input: ReportDefinitionInput = {
              org_id: orgId,
              name,
              scope: { project_external_id: project, zone_external_id: zone || null },
              timezone,
              local_time: localTime,
              data_as_of_policy: policy,
              enabled: editing?.enabled ?? true,
            };
            void action(async () => {
              await api(
                editing
                  ? `/report-definitions/${editing.report_definition_id}`
                  : '/report-definitions',
                z.unknown(),
                { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(input) },
              );
              setEditing(null);
              setNotice('Đã lưu lịch báo cáo.');
            });
          }}
        >
          <fieldset disabled={!canWrite || busy}>
            <div className="schedule-grid">
              <label>
                Tên lịch
                <input
                  value={name}
                  maxLength={200}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <ScopeFields
                catalog={catalog}
                project={project}
                zone={zone}
                setProject={setProject}
                setZone={setZone}
              />
              <label>
                Giờ chạy
                <input
                  type="time"
                  required
                  value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)}
                />
              </label>
              <label>
                Múi giờ
                <input
                  required
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
              <label>
                Ngày dữ liệu
                <select
                  value={policy}
                  onChange={(event) => setPolicy(event.target.value as typeof policy)}
                >
                  <option value="scheduled_date">Ngày của lịch chạy</option>
                  <option value="previous_day">Ngày trước lịch chạy</option>
                </select>
              </label>
            </div>
            <div className="button-row">
              <button className="primary" type="submit" disabled={!project}>
                <Plus size={16} />
                {editing ? 'Lưu thay đổi' : 'Tạo lịch báo cáo'}
              </button>
              {editing && (
                <button className="secondary" type="button" onClick={() => setEditing(null)}>
                  Hủy sửa
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {!canWrite && (
          <p className="muted">Viewer có thể xem lịch, nhưng không thể thay đổi hoặc kích hoạt.</p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice success">
            {notice}
          </p>
        )}
      </section>
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">DAILY SCHEDULES</span>
            <h2>Lịch đang theo dõi</h2>
          </div>
          <button
            className="secondary"
            disabled={!canWrite || busy}
            onClick={() =>
              void action(async () => {
                const result = await api(
                  '/scheduler/tick',
                  z.object({ enqueued: z.number() }),
                  post({ org_id: orgId }),
                );
                setNotice(`Đã đưa ${result.enqueued} lượt đến hạn vào hàng đợi.`);
              })
            }
          >
            <RefreshCw size={15} />
            Kiểm tra lịch đến hạn
          </button>
        </header>
        {definitions.length ? (
          definitions.map((definition) => (
            <div className="schedule-item" key={definition.report_definition_id}>
              <div className="schedule-item-heading">
                <span className="list-icon">
                  <CalendarClock size={20} />
                </span>
                <div>
                  <h3>{definition.name}</h3>
                  <p>
                    {definition.local_time} mỗi ngày · {definition.timezone}
                  </p>
                </div>
                <span
                  className={`status ${definition.enabled ? 'status-succeeded' : 'status-pending'}`}
                >
                  {definition.enabled ? 'Đang bật' : 'Tạm dừng'}
                </span>
              </div>
              <p className="muted">
                {definition.scope.project_external_id} /{' '}
                {definition.scope.zone_external_id ?? 'Tất cả phân khu'} · Lần tiếp theo:{' '}
                {dateTime(definition.next_run_at)}
              </p>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!canWrite || busy}
                  onClick={() =>
                    void action(async () => {
                      const accepted = await api(
                        `/report-definitions/${definition.report_definition_id}/trigger`,
                        AcceptedSchema,
                        post({ org_id: orgId }),
                      );
                      onRun(accepted.run_id, accepted.conversation_id);
                    })
                  }
                >
                  <Play size={14} />
                  Chạy ngay
                </button>
                <button
                  className="secondary"
                  disabled={!canWrite || busy}
                  onClick={() => {
                    setEditing(definition);
                    setName(definition.name);
                    setProject(definition.scope.project_external_id);
                    setZone(definition.scope.zone_external_id ?? '');
                    setLocalTime(definition.local_time);
                    setTimezone(definition.timezone);
                    setPolicy(definition.data_as_of_policy);
                  }}
                >
                  Chỉnh sửa
                </button>
                <button
                  className="secondary"
                  disabled={!canWrite || busy}
                  onClick={() =>
                    void action(() =>
                      api(`/report-definitions/${definition.report_definition_id}`, z.unknown(), {
                        method: 'PATCH',
                        body: JSON.stringify({
                          ...inputOf(definition),
                          enabled: !definition.enabled,
                        }),
                      }),
                    )
                  }
                >
                  {definition.enabled ? <Pause size={14} /> : <Play size={14} />}
                  {definition.enabled ? 'Tạm dừng' : 'Bật lịch'}
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Xóa lịch ${definition.name}`}
                  disabled={!canWrite || busy}
                  onClick={() =>
                    void action(() =>
                      api(
                        scoped(`/report-definitions/${definition.report_definition_id}`, orgId),
                        z.unknown(),
                        { method: 'DELETE' },
                      ),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="Chưa có lịch báo cáo">
            Tạo lịch để theo dõi tồn kho mỗi ngày.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
