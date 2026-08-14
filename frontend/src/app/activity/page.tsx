"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { listWorkspaceActivity, type ActivityEntry } from "@/lib/api";
import { formatDate, toTitle } from "@/lib/format";

const eventLabels: Record<string, string> = {
  workspace_created: "Tạo workspace",
  workspace_archived: "Lưu trữ workspace",
  workspace_deleted: "Lưu trữ workspace",
  member_invited: "Mời thành viên",
  member_updated: "Cập nhật thành viên",
  invitation_accepted: "Chấp nhận lời mời",
  ingest: "Upload dataset",
  api_profile: "Chạy profiling",
  profile_review: "Review profile",
  report_created: "Tạo báo cáo",
  report_submitted: "Nộp báo cáo",
  report_reviewed: "Review báo cáo",
  report_published: "Xuất bản báo cáo",
  report_archived: "Lưu trữ báo cáo",
  guardrail_block: "Chặn yêu cầu theo guardrail",
  agent_run_started: "Bắt đầu Agent session",
  agent_run_completed: "Hoàn tất Agent session",
};

function textValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function eventLabel(event: string): string {
  return eventLabels[event] || toTitle(event);
}

function actorLabel(entry: ActivityEntry): string {
  if (!entry.actor_user_id) return "Hệ thống";
  return `User ${entry.actor_user_id.slice(0, 8)}…`;
}

function resourceLabel(entry: ActivityEntry): string | null {
  const type = textValue(entry.resource_type);
  const id = textValue(entry.resource_id);
  if (!type && !id) return null;
  return `${type ? toTitle(type) : "Tài nguyên"}${id ? ` · ${id.slice(0, 12)}…` : ""}`;
}

function detailLabel(entry: ActivityEntry): string | null {
  const details: string[] = [];
  const name = textValue(entry.name);
  const filename = textValue(entry.filename);
  const status = textValue(entry.status);
  const decision = textValue(entry.decision);
  const targetRole = textValue(entry.target_role);
  const deletedRuns = textValue(entry.deleted_runs);
  if (name) details.push(name);
  if (filename) details.push(filename);
  if (status) details.push(`Trạng thái: ${toTitle(status)}`);
  if (decision) details.push(`Quyết định: ${toTitle(decision)}`);
  if (targetRole) details.push(`Role: ${toTitle(targetRole)}`);
  if (deletedRuns) details.push(`Đã xử lý ${deletedRuns} run`);
  return details.length ? details.join(" · ") : null;
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const resource = resourceLabel(entry);
  const detail = detailLabel(entry);
  return <article className="activity-entry">
    <span className="activity-entry-icon" aria-hidden="true">↗</span>
    <div className="activity-entry-content">
      <div className="activity-entry-heading"><strong>{eventLabel(entry.event)}</strong><time dateTime={entry.ts}>{formatDate(entry.ts)}</time></div>
      <p className="activity-entry-meta">{actorLabel(entry)}{resource ? ` · ${resource}` : ""}</p>
      {detail && <p className="activity-entry-detail">{detail}</p>}
    </div>
  </article>;
}

export default function ActivityPage() {
  const { me } = useAuth();
  const activity = useQuery({
    queryKey: ["workspace-activity"],
    queryFn: () => listWorkspaceActivity(100),
    enabled: Boolean(me && can(me.effective_permissions, PERMISSIONS.workspaceAuditRead)),
  });
  const entries = activity.data?.entries ?? [];

  if (me && !can(me.effective_permissions, PERMISSIONS.workspaceAuditRead)) {
    return <main className="page activity-page"><EmptyState title="Không có quyền truy cập" detail="Chỉ Admin mới có thể xem activity log của workspace." /></main>;
  }

  return <main className="page activity-page">
    <PageHeader
      eyebrow="WORKSPACE ACTIVITY"
      title="Hoạt động workspace"
      description="Theo dõi các thao tác quan trọng trong workspace hiện tại. Dữ liệu được lọc theo workspace và không hiển thị nội dung câu hỏi raw."
      action={<span className="activity-count">{entries.length} sự kiện</span>}
    />
    {activity.isPending && <LoadingBlock label="Đang tải activity log…" />}
    {activity.isError && <ErrorNotice error={activity.error} retry={() => activity.refetch()} />}
    {!activity.isPending && !activity.isError && (entries.length ? <section className="activity-list" aria-label="Activity log">{entries.map((entry, index) => <ActivityItem entry={entry} key={`${entry.ts}-${entry.event}-${index}`} />)}</section> : <EmptyState title="Chưa có hoạt động" detail="Các thao tác upload, profiling, báo cáo và quản trị workspace sẽ xuất hiện ở đây." />)}
  </main>;
}
