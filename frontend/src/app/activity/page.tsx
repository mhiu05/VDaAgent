"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorNotice, LoadingBlock, LoadingButton, PageHeader } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { getCalendarStatus, listCalendarEvents, listWorkspaceActivity, type ActivityEntry, type CalendarEvent } from "@/lib/api";
import { formatDate, toTitle } from "@/lib/format";

type NotificationTone = "success" | "info" | "warning" | "error";
type NotificationFilter = "all" | "success" | "calendar" | "attention";
type NotificationItem = {
  id: string;
  ts: string;
  tone: NotificationTone;
  icon: string;
  category: "success" | "info" | "calendar" | "attention";
  title: string;
  message: string;
  href?: string;
};

const providerLabels: Record<string, string> = {
  mongodb: "MongoDB Atlas",
  mysql: "MySQL",
  duckdb: "DuckDB",
  google_drive: "Google Drive",
  google_calendar: "Google Calendar",
};

const calendarWindow = (() => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
})();

function textValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function providerLabel(value: unknown): string {
  const provider = textValue(value) || "datasource";
  return providerLabels[provider] || toTitle(provider);
}

function auditNotification(entry: ActivityEntry, index: number): NotificationItem | null {
  const provider = providerLabel(entry.provider || entry.kind);
  const name = textValue(entry.name);
  const filename = textValue(entry.filename);
  const errorCode = textValue(entry.error_code);
  const issueCount = textValue(entry.issue_count);
  const decision = textValue(entry.decision);
  const id = `${entry.ts}-${entry.event}-${entry.resource_id || index}`;
  const base = { id, ts: entry.ts };

  switch (entry.event) {
    case "connector.created":
      return { ...base, tone: "success", category: "success", icon: "✓", title: `${provider} đã kết nối`, message: name ? `Connector “${name}” đã sẵn sàng dùng cho dataset.` : "Connector đã được lưu và sẵn sàng dùng cho dataset.", href: "/connectors" };
    case "connector.tested":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Kiểm tra kết nối thành công", message: `${provider} phản hồi bình thường.`, href: "/connectors" };
    case "connector.updated":
      return { ...base, tone: "info", category: "info", icon: "↻", title: `${provider} đã được cập nhật`, message: "Cấu hình connector mới đã được lưu.", href: "/connectors" };
    case "connector.disconnected":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: `${provider} đã ngắt kết nối`, message: "Các dataset hiện có vẫn được giữ nguyên.", href: "/connectors" };
    case "api_datasource_connected":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Datasource đã kết nối", message: `Đã tạo dataset mới từ ${provider}.`, href: "/datasets" };
    case "api_datasource_reused":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Đã dùng datasource đã lưu", message: "Dataset mới đã được tạo từ connector dùng chung.", href: "/datasets" };
    case "api_upload":
      return { ...base, tone: "success", category: "success", icon: "↑", title: "Tải dữ liệu thành công", message: filename ? `File “${filename}” đã được lưu vào workspace.` : "Dữ liệu đã được lưu vào workspace.", href: "/datasets" };
    case "api_profile":
      return { ...base, tone: "info", category: "info", icon: "◌", title: "Profiling đã được bắt đầu", message: "Hệ thống đang chuẩn bị phân tích dataset.", href: "/datasets" };
    case "profile_job_succeeded":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Profiling hoàn tất", message: "Dataset đã có kết quả profiling để xem.", href: "/profiles" };
    case "profile_job_failed":
      return { ...base, tone: "error", category: "attention", icon: "!", title: "Profiling chưa hoàn tất", message: errorCode ? `Hệ thống gặp lỗi ${toTitle(errorCode)}. Hãy mở lại profile để kiểm tra.` : "Hệ thống gặp lỗi khi profiling. Hãy thử lại.", href: "/datasets" };
    case "profile_job_recovered":
    case "profile_resume_recovered":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: "Profiling cần được tiếp tục", message: "Hệ thống đã khôi phục một tiến trình chưa hoàn tất.", href: "/datasets" };
    case "report_created":
    case "profile_report_created":
      return { ...base, tone: "success", category: "success", icon: "▤", title: "Báo cáo đã được tạo", message: "Báo cáo mới đã sẵn sàng để xem hoặc review.", href: "/reports" };
    case "report_published":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Báo cáo đã xuất bản", message: "Báo cáo hiện đã sẵn sàng chia sẻ trong workspace.", href: "/reports" };
    case "report_reviewed":
    case "report_approved":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Báo cáo đã được review", message: "Quy trình review báo cáo đã hoàn tất.", href: "/reports" };
    case "report_submitted":
      return { ...base, tone: "info", category: "info", icon: "→", title: "Báo cáo đã được gửi review", message: "Báo cáo đang chờ bước tiếp theo trong quy trình.", href: "/reports" };
    case "report_archived":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: "Báo cáo đã được lưu trữ", message: "Báo cáo không còn nằm trong danh sách đang làm việc.", href: "/reports" };
    case "api_delete_dataset":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: "Dataset đã bị xóa", message: "Dataset và lịch sử profiling liên quan đã được xóa.", href: "/datasets" };
    case "guardrail_block":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: "Yêu cầu đã bị chặn", message: "Guardrail đã chặn một yêu cầu không phù hợp với chính sách an toàn.", href: "/chat" };
    case "guardrail_output":
      return { ...base, tone: "warning", category: "attention", icon: "!", title: "Đầu ra đã được bảo vệ", message: "Một phần nội dung đã được ẩn hoặc rút gọn theo chính sách an toàn.", href: "/chat" };
    case "analysis_quality_gate":
      return { ...base, tone: decision === "reject" ? "warning" : "info", category: decision === "reject" ? "attention" : "info", icon: decision === "reject" ? "!" : "i", title: decision === "reject" ? "Phân tích cần được xem lại" : "Đã cập nhật quality gate", message: issueCount ? `${issueCount} vấn đề đang được theo dõi trong phiên phân tích.` : "Trạng thái kiểm tra chất lượng đã được cập nhật.", href: "/charts" };
    case "workspace_created":
    case "self_signup_provisioned":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Workspace đã sẵn sàng", message: "Bạn đã có thể bắt đầu làm việc trong workspace.", href: "/dashboard" };
    case "invitation_accepted":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Đã tham gia workspace", message: "Lời mời workspace đã được chấp nhận.", href: "/dashboard" };
    case "member_invited":
      return { ...base, tone: "info", category: "info", icon: "↗", title: "Đã gửi lời mời thành viên", message: "Lời mời thành viên đã được gửi.", href: "/workspaces/manage" };
    case "membership_updated":
      return { ...base, tone: "info", category: "info", icon: "↻", title: "Quyền thành viên đã cập nhật", message: "Vai trò hoặc trạng thái thành viên trong workspace đã thay đổi.", href: "/workspaces/manage" };
    case "api_export":
    case "api_report_export":
    case "report_exported":
      return { ...base, tone: "success", category: "success", icon: "↓", title: "Xuất dữ liệu thành công", message: "Tài liệu hoặc báo cáo đã được xuất.", href: "/reports" };
    case "hitl_decision":
      return { ...base, tone: "success", category: "success", icon: "✓", title: "Đã xác nhận thay đổi profile", message: "Quyết định review đã được lưu và workflow có thể tiếp tục.", href: "/profiles" };
    default:
      return null;
  }
}

function calendarNotification(event: CalendarEvent, index: number): NotificationItem | null {
  if (!event.start) return null;
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return null;
  const hoursUntil = (start.getTime() - Date.now()) / (60 * 60 * 1000);
  const soon = hoursUntil >= 0 && hoursUntil <= 24;
  const location = event.location ? ` · ${event.location}` : "";
  return {
    id: `calendar-${event.id}-${index}`,
    ts: event.start,
    tone: soon ? "warning" : "info",
    category: "calendar",
    icon: "◷",
    title: soon ? `Sắp diễn ra: ${event.summary}` : `Lịch sắp tới: ${event.summary}`,
    message: `${formatDate(event.start)}${location}`,
    href: "/calendar",
  };
}

function NotificationItemView({ item }: { item: NotificationItem }) {
  const content = <>
    <span className={`activity-notification-icon activity-notification-${item.tone}`} aria-hidden="true">{item.icon}</span>
    <div className="activity-notification-content">
      <div className="activity-notification-heading"><strong>{item.title}</strong><time dateTime={item.ts}>{formatDate(item.ts)}</time></div>
      <p>{item.message}</p>
    </div>
  </>;
  return item.href
    ? <Link className="activity-notification" href={item.href}>{content}<span className="activity-notification-arrow" aria-hidden="true">→</span></Link>
    : <article className="activity-notification">{content}</article>;
}

export default function ActivityPage() {
  const { me, workspaceId } = useAuth();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [sessionNotifications, setSessionNotifications] = useState<NotificationItem[]>([]);
  const canReadActivity = Boolean(me && can(me.effective_permissions, PERMISSIONS.workspaceAuditRead));
  const canReadCalendar = Boolean(me && can(me.effective_permissions, PERMISSIONS.calendarRead));
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("p170-login-notification-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { ts?: unknown };
      const ts = typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString();
      setSessionNotifications([{ id: `login-${ts}`, ts, tone: "success", category: "success", icon: "✓", title: "Đăng nhập thành công", message: me?.user.email ? `Bạn đang đăng nhập với ${me.user.email}.` : "Phiên làm việc của bạn đang hoạt động.", href: "/account" }]);
      window.sessionStorage.removeItem("p170-login-notification-v1");
    } catch {
      // A malformed or blocked browser session should not affect the feed.
    }
  }, [me?.user.email]);
  const activity = useQuery({
    queryKey: ["workspace-activity", workspaceId],
    queryFn: () => listWorkspaceActivity(150),
    enabled: canReadActivity,
  });
  const calendarStatus = useQuery({
    queryKey: ["calendar-status", workspaceId],
    queryFn: getCalendarStatus,
    enabled: canReadCalendar,
    retry: false,
    staleTime: 30_000,
  });
  const calendarEvents = useQuery({
    queryKey: ["activity-calendar-events", workspaceId],
    queryFn: () => listCalendarEvents(calendarWindow),
    enabled: canReadCalendar && Boolean(calendarStatus.data?.connected),
    retry: false,
    staleTime: 60_000,
  });
  const auditEntries = activity.data?.entries ?? [];
  const auditNotifications = useMemo(() => auditEntries.map(auditNotification).filter((item): item is NotificationItem => Boolean(item)), [auditEntries]);
  const scheduleNotifications = useMemo(() => (calendarEvents.data?.events ?? []).map(calendarNotification).filter((item): item is NotificationItem => Boolean(item)), [calendarEvents.data?.events]);
  const serviceNotifications = useMemo(() => {
    if (calendarStatus.isError) return [{ id: "calendar-status-error", ts: new Date().toISOString(), tone: "warning" as const, category: "attention" as const, icon: "!", title: "Không thể kiểm tra Google Calendar", message: "Hãy mở Calendar để kiểm tra lại kết nối.", href: "/calendar" }];
    if (calendarEvents.isError) return [{ id: "calendar-events-error", ts: new Date().toISOString(), tone: "warning" as const, category: "attention" as const, icon: "!", title: "Không thể tải lịch", message: "Google Calendar đang không phản hồi. Hãy thử làm mới hoặc kết nối lại.", href: "/calendar" }];
    if (canReadCalendar && calendarStatus.data && !calendarStatus.data.connected) return [{ id: "calendar-not-connected", ts: new Date().toISOString(), tone: "info" as const, category: "calendar" as const, icon: "◷", title: "Google Calendar chưa kết nối", message: "Kết nối Google Calendar để nhận thông báo lịch hẹn sắp tới.", href: "/calendar" }];
    return [];
  }, [calendarEvents.isError, calendarStatus.data, calendarStatus.isError, canReadCalendar]);
  const notifications = useMemo(() => [...sessionNotifications, ...auditNotifications, ...scheduleNotifications, ...serviceNotifications].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 80), [auditNotifications, scheduleNotifications, serviceNotifications, sessionNotifications]);
  const visible = useMemo(() => notifications.filter((item) => filter === "all" || filter === "success" && item.category === "success" || filter === "calendar" && item.category === "calendar" || filter === "attention" && item.category === "attention"), [filter, notifications]);
  const counts = {
    all: notifications.length,
    success: notifications.filter((item) => item.category === "success").length,
    calendar: notifications.filter((item) => item.category === "calendar").length,
    attention: notifications.filter((item) => item.category === "attention").length,
  };

  if (me && !canReadActivity) {
    return <main className="page activity-page"><EmptyState title="Không có quyền truy cập" detail="Bạn không có quyền xem thông báo của workspace." /></main>;
  }

  return <main className="page activity-page">
    <PageHeader
      eyebrow="WORKSPACE NOTIFICATIONS"
      title="Thông báo"
      description="Các cập nhật quan trọng về kết nối, lịch hẹn, profiling và an toàn workspace. Chi tiết kỹ thuật không hiển thị ở đây."
      action={<LoadingButton className="button secondary" type="button" busy={activity.isFetching || calendarStatus.isFetching || calendarEvents.isFetching} onClick={() => { void activity.refetch(); if (canReadCalendar) { void calendarStatus.refetch(); if (calendarStatus.data?.connected) void calendarEvents.refetch(); } }}>Làm mới</LoadingButton>}
    />
    {activity.isPending && <LoadingBlock label="Đang tải thông báo…" />}
    {activity.isError && <ErrorNotice error={activity.error} retry={() => activity.refetch()} />}
    {!activity.isPending && !activity.isError && <>
      <section className="activity-notification-summary" aria-label="Tóm tắt thông báo">
        <div><span className="activity-summary-dot activity-summary-all" /><b>{counts.all}</b><small>Tất cả</small></div>
        <div><span className="activity-summary-dot activity-summary-success" /><b>{counts.success}</b><small>Thành công</small></div>
        <div><span className="activity-summary-dot activity-summary-calendar" /><b>{counts.calendar}</b><small>Lịch sắp tới</small></div>
        <div><span className="activity-summary-dot activity-summary-attention" /><b>{counts.attention}</b><small>Cần chú ý</small></div>
      </section>
      <section className="activity-notification-panel">
        <div className="activity-notification-panel-heading"><div><p className="eyebrow">RECENT UPDATES</p><h2>Cập nhật gần đây</h2></div><Link className="button secondary" href="/calendar">Mở lịch</Link></div>
        <div className="inline-actions activity-notification-filters" role="tablist" aria-label="Lọc thông báo">
          {(["all", "success", "calendar", "attention"] as NotificationFilter[]).map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={`button ${filter === item ? "primary" : "secondary"}`} onClick={() => setFilter(item)}>{item === "all" ? `Tất cả (${counts.all})` : item === "success" ? `Thành công (${counts.success})` : item === "calendar" ? `Lịch (${counts.calendar})` : `Cần chú ý (${counts.attention})`}</button>)}
        </div>
        {visible.length ? <div className="activity-notification-list" aria-label="Danh sách thông báo">{visible.map((item) => <NotificationItemView item={item} key={item.id} />)}</div> : <EmptyState title={filter === "all" ? "Chưa có thông báo" : "Không có thông báo phù hợp"} detail="Khi có kết nối, lịch hẹn hoặc cảnh báo mới, chúng sẽ xuất hiện ở đây." action={filter === "calendar" ? <Link className="button secondary" href="/calendar">Mở Google Calendar</Link> : undefined} />}
      </section>
    </>}
  </main>;
}
