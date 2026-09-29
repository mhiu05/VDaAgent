'use client';

import { useState } from 'react';
import { type Catalog, type ReportDefinition, type ReportDefinitionInput } from '@vda/contracts';
import { CalendarClock, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useSchedules } from '../hooks/use-schedules';
import {
  deleteReportDefinition,
  saveReportDefinition,
  tickScheduler,
  triggerReportDefinition,
} from '../api/report-definitions';
import { dateTime } from '../../../lib/format/date-time';
import { EmptyState } from '../../../components/feedback/empty-state';
import { ScopeFields } from '../../../components/forms/scope-fields';

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
  const [project, setProject] = useState(catalog.projects[0]?.project_external_id ?? '');
  const [zone, setZone] = useState('');
  const [name, setName] = useState('Tồn kho hằng ngày');
  const [localTime, setLocalTime] = useState('08:00');
  const [timezone, setTimezone] = useState('Asia/Bangkok');
  const [policy, setPolicy] = useState<'scheduled_date' | 'previous_day'>('scheduled_date');
  const [editing, setEditing] = useState<ReportDefinition | null>(null);
  const { definitions, busy, error, notice, setNotice, action } = useSchedules(orgId);
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
            <span className="eyebrow">BÁO CÁO TỰ ĐỘNG</span>
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
              await saveReportDefinition(input, editing?.report_definition_id);
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
          <p className="muted">Người xem có thể xem lịch nhưng không thể thay đổi hoặc kích hoạt.</p>
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
            <span className="eyebrow">LỊCH HẰNG NGÀY</span>
            <h2>Lịch đang theo dõi</h2>
          </div>
          <button
            className="secondary"
            disabled={!canWrite || busy}
            onClick={() =>
              void action(async () => {
                const result = await tickScheduler(orgId);
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
                      const accepted = await triggerReportDefinition(
                        orgId,
                        definition.report_definition_id,
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
                      saveReportDefinition(
                        { ...inputOf(definition), enabled: !definition.enabled },
                        definition.report_definition_id,
                      ),
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
                      deleteReportDefinition(orgId, definition.report_definition_id),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="Chưa có lịch báo cáo" illustration>
            Tạo lịch để theo dõi tồn kho mỗi ngày.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
