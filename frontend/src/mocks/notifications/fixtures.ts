import type { Notification } from "../../features/notifications/model/types";
import { ids } from "../core/ids";
export function makeNotifications(): Notification[] {
  return [
    {
      id: "notification-report",
      kind: "report-ready",
      title: {
        vi: "Bản tổng hợp nghiên cứu đã sẵn sàng",
        en: "Your research summary is ready",
      },
      summary: {
        vi: "Bản phân tích minh họa đã có trong thư viện. Mở báo cáo để đọc phiên bản đã lưu, kiểm tra nguồn và tải tệp demo.",
        en: "The illustrative analysis is available in your library. Open the report to read the saved version, review its sources, and download a demo file.",
      },
      occurredAt: "2026-10-16T08:00:00Z",
      readAt: null,
      target: { kind: "report", reportId: ids.report },
      access: "available",
    },
    {
      id: "notification-task",
      kind: "task-failed",
      title: {
        vi: "Cần kiểm tra lại nguồn dữ liệu",
        en: "A data source needs another look",
      },
      summary: {
        vi: "Baseline cùng kỳ chưa được cung cấp. Mở cuộc trò chuyện để xem các giới hạn của mẫu.",
        en: "The previous-period baseline is missing. Open the conversation to review the sample limitations.",
      },
      occurredAt: "2026-10-16T07:00:00Z",
      readAt: null,
      target: { kind: "chat", conversationId: ids.conversations.data },
      access: "available",
    },
    {
      id: "notification-action",
      kind: "action-required",
      title: {
        vi: "Bạn có một ghi chú cần xem",
        en: "A research note needs your attention",
      },
      summary: {
        vi: "Nhóm minh họa đã tổng hợp các câu hỏi cần xác minh tiếp theo.",
        en: "The demo group collected questions for the next verification step.",
      },
      occurredAt: "2026-10-15T23:30:00Z",
      readAt: null,
      target: { kind: "chat", conversationId: ids.groups[0] },
      access: "available",
    },
    {
      id: "notification-account",
      kind: "account-created",
      title: { vi: "Chào mừng đến với VDaAgent", en: "Welcome to VDaAgent" },
      summary: {
        vi: "Thiết lập ngôn ngữ, giao diện và múi giờ cho không gian nghiên cứu của bạn.",
        en: "Choose the language, appearance and timezone for your research workspace.",
      },
      occurredAt: "2026-10-15T04:00:00Z",
      readAt: "2026-10-15T05:00:00Z",
      target: { kind: "account" },
      access: "available",
    },
    {
      id: "notification-system",
      kind: "system",
      title: {
        vi: "Không gian minh họa đã được cập nhật",
        en: "The demo workspace has been updated",
      },
      summary: {
        vi: "Mọi phản hồi và dữ liệu trong phiên này đều là nội dung minh họa. Chưa kết nối mô hình hoặc backend thật.",
        en: "All replies and data in this session are illustrative. No live model or backend is connected.",
      },
      occurredAt: "2026-10-14T09:00:00Z",
      readAt: "2026-10-14T10:00:00Z",
      target: { kind: "system-detail", notificationId: "notification-system" },
      access: "available",
    },
    {
      id: "notification-missing",
      kind: "action-required",
      title: {
        vi: "Nguồn tham chiếu không còn khả dụng",
        en: "A referenced source is unavailable",
      },
      summary: {
        vi: "Nội dung chi tiết được giữ lại, nhưng không thể mở cuộc trò chuyện đã bị xóa.",
        en: "The detail is preserved, but the deleted conversation cannot be opened.",
      },
      occurredAt: "2026-10-13T09:00:00Z",
      readAt: null,
      target: { kind: "chat", conversationId: "missing" },
      access: "missing",
    },
  ];
}
