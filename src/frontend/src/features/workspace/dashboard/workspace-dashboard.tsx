'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  FileText,
  Inbox,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceSummary } from '@vda/contracts';
import { AssistantPresence, type AssistantState } from '../../../components/assistant';
import { MotionReveal } from '../../../components/motion';
import { dateTime } from '../../../lib/format/date-time';
import { errorMessage } from '../../../lib/http/api-client';
import { getWorkspaceSummary } from '../api/workspace-summary';
import styles from './workspace-dashboard.module.css';

const runLabels: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang phân tích',
  succeeded: 'Hoàn tất',
  failed: 'Cần xem lại',
  cancelled: 'Đã hủy',
};
const runStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
const messageLabels: Record<string, string> = {
  submitted: 'Đã gửi',
  in_progress: 'Đang xử lý',
  completed: 'Hoàn tất',
  failed: 'Cần xem lại',
  cancelled: 'Đã hủy',
};

function assistantFor(summary: WorkspaceSummary | null, hasError: boolean): AssistantState {
  if (hasError) return 'warning';
  if (!summary) return 'idle';
  if (summary.run_counts.queued || summary.run_counts.running) return 'analyzing';
  if (summary.recent_reports.length) return 'report-ready';
  return summary.recent_runs.length ? 'happy' : 'idle';
}

function scopeLabel(scope: { project_external_id: string; zone_external_id: string | null }) {
  return scope.zone_external_id
    ? `${scope.project_external_id} / ${scope.zone_external_id}`
    : scope.project_external_id;
}

function Panel({
  id,
  icon: Icon,
  eyebrow,
  title,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <header className={styles.panelHeader}>
        <span className={styles.panelIcon} aria-hidden={true}>
          <Icon size={18} />
        </span>
        <div>
          <span className={styles.panelEyebrow}>{eyebrow}</span>
          <h2 id={id}>{title}</h2>
        </div>
        {action && <div className={styles.panelAction}>{action}</div>}
      </header>
      {children}
    </section>
  );
}

function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden={true}>
        <Icon size={20} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function List({ children, empty }: { children: ReactNode[]; empty: ReactNode }) {
  return children.length ? <ul className={styles.list}>{children}</ul> : empty;
}

function Status({ value, labels }: { value: string; labels: Record<string, string> }) {
  return (
    <span className={styles.status} data-status={value}>
      {labels[value] ?? value}
    </span>
  );
}

export function WorkspaceDashboard({
  orgId,
  organizationName,
  onStartAnalysis,
  onOpenRun,
  onOpenConversation,
  onOpenReport,
  onOpenImports,
  onOpenSchedules,
}: {
  orgId: string;
  organizationName: string;
  onStartAnalysis: () => void;
  onOpenRun: (runId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenReport: (reportId: string) => void;
  onOpenImports: () => void;
  onOpenSchedules: () => void;
}) {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setSummary(null);
    setLoading(true);
    setError('');

    void getWorkspaceSummary(orgId)
      .then((next) => {
        if (active) setSummary(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orgId, refreshVersion]);

  const overview = useMemo(() => {
    if (!summary) return null;
    const activeRuns = summary.run_counts.queued + summary.run_counts.running;
    return {
      activeRuns,
      metrics: [
        {
          icon: Activity,
          label: 'Đang xử lý',
          value: activeRuns,
          detail: `${summary.run_counts.queued} đang chờ · ${summary.run_counts.running} đang phân tích`,
        },
        {
          icon: Sparkles,
          label: 'Đã hoàn tất',
          value: summary.run_counts.succeeded,
          detail: 'Lượt phân tích đã lưu',
        },
        {
          icon: CircleAlert,
          label: 'Cần xem lại',
          value: summary.run_counts.failed,
          detail: 'Lượt phân tích gặp lỗi',
        },
        {
          icon: CalendarClock,
          label: 'Lịch đang bật',
          value: summary.active_schedules.length,
          detail: 'Quy trình báo cáo đã bật',
        },
      ],
      statuses: runStatuses.map((status) => ({
        status,
        label: runLabels[status],
        count: summary.run_counts[status],
      })),
    };
  }, [summary]);

  const assistantState = assistantFor(summary, Boolean(error));
  const assistantCopy = useMemo(() => {
    if (error)
      return {
        label: 'Cần làm mới hoạt động workspace',
        description: 'Chưa tải được hoạt động mới nhất. Dữ liệu đã lưu vẫn được giữ nguyên.',
      };
    if (!summary)
      return {
        label: 'Đang chuẩn bị workspace',
        description: 'Đang tải lượt phân tích, báo cáo, dữ liệu và lịch chạy mới nhất.',
      };
    if (overview?.activeRuns)
      return {
        label: `${overview.activeRuns} lượt phân tích đang chạy`,
        description: 'Theo dõi tiến độ trong danh sách hoạt động gần đây.',
      };
    if (summary.recent_reports.length)
      return {
        label: 'Báo cáo mới nhất đã sẵn sàng',
        description: 'Mở báo cáo để xem lại phân tích đã lưu và bằng chứng liên quan.',
      };
    if (summary.recent_runs.length)
      return {
        label: 'Bạn có thể tiếp tục phân tích',
        description: 'Mở lại lượt trước hoặc bắt đầu một phân tích mới.',
      };
    return {
      label: 'Sẵn sàng cho câu hỏi đầu tiên',
      description: 'Bắt đầu phân tích để tạo hồ sơ có thể truy vết từ dữ liệu workspace.',
    };
  }, [error, overview, summary]);

  function refreshDashboard() {
    setRefreshVersion((value) => value + 1);
  }

  return (
    <div className={styles.dashboard} aria-busy={loading}>
      <MotionReveal className={styles.hero} distance={16} scale={0.99}>
        <div className={styles.heroCopy}>
          <span className={styles.heroEyebrow}>
            <Sparkles size={15} aria-hidden={true} />
            TRUNG TÂM ĐIỀU HÀNH
          </span>
          <h1>{organizationName}</h1>
          <p>Theo dõi phân tích, báo cáo, dữ liệu nguồn và tác vụ đã lên lịch tại đây.</p>
          <div className={styles.heroActions}>
            <button className={styles.primaryAction} onClick={onStartAnalysis}>
              Bắt đầu phân tích <ArrowRight size={17} aria-hidden={true} />
            </button>
            <button
              className={styles.refreshAction}
              onClick={refreshDashboard}
              disabled={loading}
              aria-label={'Làm mới hoạt động workspace'}
            >
              <RefreshCw size={17} aria-hidden={true} /> Làm mới
            </button>
          </div>
        </div>
        <Image
          className={styles.heroMascot}
          src="/brand/mascot/navigator-hero.webp"
          alt=""
          width={768}
          height={922}
          sizes="(max-width: 760px) 190px, (max-width: 1100px) 220px, 270px"
          priority
        />
        <div className={styles.heroPresence}>
          <AssistantPresence
            state={assistantState}
            label={assistantCopy.label}
            description={assistantCopy.description}
            avatarSize={54}
            announce
          />
          {summary && overview && (
            <p className={styles.heroFootnote}>
              {overview.activeRuns
                ? `${overview.activeRuns} lượt phân tích đang chạy trong workspace.`
                : 'Hiện không có lượt phân tích nào đang chạy.'}
            </p>
          )}
        </div>
      </MotionReveal>
      {error && (
        <div className={styles.error} role={'alert'}>
          <CircleAlert size={19} aria-hidden={true} />
          <div>
            <strong>Chưa làm mới được hoạt động workspace</strong>
            <p>{error}</p>
          </div>
          <button className={styles.retry} onClick={refreshDashboard}>
            Thử lại
          </button>
        </div>
      )}
      {loading && !summary ? (
        <MotionReveal className={styles.loading} delay={0.06}>
          <LoaderCircle className={styles.spinning} size={24} aria-hidden={true} />
          <div>
            <h2>Đang tải hoạt động workspace</h2>
            <p>Đang lấy các bản ghi mới nhất của tổ chức này.</p>
          </div>
        </MotionReveal>
      ) : summary && overview ? (
        <>
          <MotionReveal className={styles.metricGrid} delay={0.07}>
            {overview.metrics.map(({ icon: Icon, label, value, detail }) => (
              <article className={styles.metric} key={label}>
                <span className={styles.metricIcon} aria-hidden={true}>
                  <Icon size={18} />
                </span>
                <span className={styles.metricLabel}>{label}</span>
                <strong>{value}</strong>
                <span className={styles.metricDetail}>{detail}</span>
              </article>
            ))}
          </MotionReveal>
          <MotionReveal className={styles.statusStrip} delay={0.11}>
            <div>
              <span className={styles.stripEyebrow}>TRẠNG THÁI LƯỢT CHẠY</span>
              <strong>Tất cả lượt phân tích đã lưu</strong>
            </div>
            <div className={styles.statusCounts} aria-label={'Số lượt chạy theo trạng thái'}>
              {overview.statuses.map(({ status, label, count }) => (
                <span className={styles.statusCount} data-status={status} key={status}>
                  <b>{count}</b>
                  {label}
                </span>
              ))}
            </div>
          </MotionReveal>
          <div className={styles.grid}>
            <MotionReveal delay={0.14}>
              <Panel
                id={'recent-analyses'}
                icon={Activity}
                eyebrow={'PHÂN TÍCH GẦN ĐÂY'}
                title={'Hoạt động phân tích'}
              >
                <List
                  empty={
                    <Empty
                      icon={Activity}
                      title={'Chưa có lượt phân tích'}
                      description={
                        'Đặt câu hỏi để tạo lượt phân tích có thể truy vết đầu tiên trong workspace.'
                      }
                      action={
                        <button className={styles.emptyAction} onClick={onStartAnalysis}>
                          Bắt đầu phân tích <ArrowRight size={15} aria-hidden={true} />
                        </button>
                      }
                    />
                  }
                >
                  {summary.recent_runs.map((run) => (
                    <li key={run.run_id}>
                      <button className={styles.listButton} onClick={() => onOpenRun(run.run_id)}>
                        <span className={styles.listBody}>
                          <strong>{run.request.question}</strong>
                          <span>
                            {scopeLabel(run.request.scope)} · Dữ liệu đến {run.request.data_as_of}
                          </span>
                          <small>
                            {run.entrypoint === 'scheduled' ? 'Theo lịch' : 'Thủ công'} ·
                            Cập nhật {dateTime(run.updated_at)}
                          </small>
                        </span>
                        <span className={styles.listMeta}>
                          <Status value={run.status} labels={runLabels} />
                          <ArrowUpRight size={17} aria-hidden={true} />
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </Panel>
            </MotionReveal>
            <MotionReveal delay={0.18}>
              <Panel
                id={'recent-conversations'}
                icon={MessageSquareText}
                eyebrow={'HỘI THOẠI'}
                title={'Trao đổi gần đây'}
              >
                <List
                  empty={
                    <Empty
                      icon={MessageSquareText}
                      title={'Chưa có hội thoại'}
                      description={
                        'Hội thoại phân tích sẽ xuất hiện tại đây sau khi được lưu.'
                      }
                    />
                  }
                >
                  {summary.recent_conversations.map((conversation) => (
                    <li key={conversation.conversation_id}>
                      <button
                        className={styles.listButton}
                        onClick={() => onOpenConversation(conversation.conversation_id)}
                      >
                        <span className={styles.staticIcon} aria-hidden={true}>
                          <MessageSquareText size={17} />
                        </span>
                        <span className={styles.listBody}>
                          <strong>{conversation.title}</strong>
                          <span>
                            {conversation.kind === 'scheduled'
                              ? 'Hội thoại theo lịch'
                              : 'Hội thoại thủ công'}
                          </span>
                          <small>Cập nhật {dateTime(conversation.updated_at)}</small>
                        </span>
                        <span className={styles.listMeta}>
                          {conversation.latest_status ? (
                            <Status value={conversation.latest_status} labels={messageLabels} />
                          ) : (
                            <span className={styles.quietLabel}>Chưa có tin nhắn</span>
                          )}
                          <ArrowUpRight size={17} aria-hidden={true} />
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </Panel>
            </MotionReveal>
            <MotionReveal delay={0.22}>
              <Panel
                id={'recent-reports'}
                icon={FileText}
                eyebrow={'BÁO CÁO'}
                title={'Báo cáo đã tạo'}
              >
                <List
                  empty={
                    <Empty
                      icon={FileText}
                      title={'Chưa có báo cáo'}
                      description={
                        'Báo cáo đã duyệt sẽ xuất hiện sau khi một lượt phân tích tạo artifact báo cáo.'
                      }
                    />
                  }
                >
                  {summary.recent_reports.map((report) => (
                    <li key={report.report_id}>
                      <button
                        className={styles.listButton}
                        onClick={() => onOpenReport(report.report_id)}
                      >
                        <span className={styles.listBody}>
                          <strong>Báo cáo phân tích</strong>
                          <span>
                            {report.occurrence_id ? 'Báo cáo theo lịch' : 'Báo cáo theo yêu cầu'}
                          </span>
                          <small>Tạo lúc {dateTime(report.created_at)}</small>
                        </span>
                        <span className={styles.listMeta}>
                          <span className={styles.quietLabel}>Mở</span>
                          <ArrowUpRight size={17} aria-hidden={true} />
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </Panel>
            </MotionReveal>
            <MotionReveal delay={0.26}>
              <Panel
                id={'recent-imports'}
                icon={Inbox}
                eyebrow={'NHẬP DỮ LIỆU'}
                title={'Snapshot nguồn mới nhất'}
                action={
                  <button className={styles.panelLink} onClick={onOpenImports}>
                    Quản lý <ArrowRight size={14} aria-hidden={true} />
                  </button>
                }
              >
                <List
                  empty={
                    <Empty
                      icon={Inbox}
                      title={'Chưa có nguồn dữ liệu'}
                      description={
                        'Nhập snapshot CSV để đưa dữ liệu nguồn vào phân tích.'
                      }
                      action={
                        <button className={styles.emptyAction} onClick={onOpenImports}>
                          Mở dữ liệu <ArrowRight size={15} aria-hidden={true} />
                        </button>
                      }
                    />
                  }
                >
                  {summary.recent_imports.map((importRecord) => (
                    <li className={styles.staticItem} key={importRecord.import_id}>
                      <span className={styles.staticIcon} aria-hidden={true}>
                        <Inbox size={17} />
                      </span>
                      <span className={styles.listBody}>
                        <strong>{importRecord.source_name}</strong>
                        <span>{importRecord.row_count.toLocaleString('vi-VN')} dòng nguồn</span>
                        <small>Nhập lúc {dateTime(importRecord.created_at)}</small>
                      </span>
                      <span className={styles.provisional}>Tạm thời</span>
                    </li>
                  ))}
                </List>
              </Panel>
            </MotionReveal>
            <MotionReveal className={styles.scheduleSpan} delay={0.3}>
              <Panel
                id={'active-schedules'}
                icon={CalendarClock}
                eyebrow={'TỰ ĐỘNG HÓA'}
                title={'Lịch đang bật'}
                action={
                  <button className={styles.panelLink} onClick={onOpenSchedules}>
                    Quản lý <ArrowRight size={14} aria-hidden={true} />
                  </button>
                }
              >
                <List
                  empty={
                    <Empty
                      icon={CalendarClock}
                      title={'Chưa có lịch tự động'}
                      description={
                        'Tạo lịch báo cáo khi workspace cần phân tích định kỳ.'
                      }
                      action={
                        <button className={styles.emptyAction} onClick={onOpenSchedules}>
                          Mở lịch tự động <ArrowRight size={15} aria-hidden={true} />
                        </button>
                      }
                    />
                  }
                >
                  {summary.active_schedules.map((schedule) => (
                    <li className={styles.staticItem} key={schedule.report_definition_id}>
                      <span className={styles.staticIcon} aria-hidden={true}>
                        <CalendarClock size={17} />
                      </span>
                      <span className={styles.listBody}>
                        <strong>{schedule.name}</strong>
                        <span>
                          {scopeLabel(schedule.scope)} · {schedule.local_time} {schedule.timezone}
                        </span>
                        <small>Lượt tiếp theo {dateTime(schedule.next_run_at)}</small>
                      </span>
                      <span className={styles.scheduleLive}>Đang bật</span>
                    </li>
                  ))}
                </List>
              </Panel>
            </MotionReveal>
          </div>
        </>
      ) : (
        <MotionReveal className={styles.noData} delay={0.08}>
          <Empty
            icon={CircleAlert}
            title={'Chưa thể tải hoạt động workspace'}
            description={'Làm mới để tải hoạt động phân tích đã lưu của tổ chức này.'}
            action={
              <button className={styles.emptyAction} onClick={refreshDashboard}>
                Thử lại <RefreshCw size={15} aria-hidden={true} />
              </button>
            }
          />
        </MotionReveal>
      )}
    </div>
  );
}
