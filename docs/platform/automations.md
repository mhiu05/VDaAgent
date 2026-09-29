# Automations và lịch báo cáo

**Status: Implemented cho report definition theo lịch.** `/automations` và `/api/report-definitions` cho phép `owner`/`analyst` tạo, sửa, tắt và trigger định nghĩa báo cáo. Định nghĩa lưu scope, timezone, giờ chạy, chính sách `data_as_of`, người tạo và version. UI gọi đây là automation; code chưa có engine automation tổng quát.

Scheduler trong worker tick khoảng mỗi phút; `--scheduler-once` chạy một tick theo lệnh. Repository khóa các definition đến hạn bằng `FOR UPDATE SKIP LOCKED`, tạo occurrence duy nhất theo definition/`scheduled_for` và run `agent-v1`, rồi cập nhật `next_run_at`. Trigger thủ công dùng cùng occurrence logic. Occurrence giữ snapshot của definition/version tại thời điểm enqueue; run vẫn cần worker xử lý.

Trước khi enqueue, scheduler kiểm lại quyền ghi của người tạo. Nếu membership không còn hợp lệ, definition bị tắt. `DELETE` tắt definition thay vì xóa lịch sử. Chưa có external scheduler service, email delivery hay workflow builder tùy ý trong repo.

Code: `src/backend/database/repositories/schedule-repository.ts`, `src/backend/worker/scheduler.ts`, `src/frontend/server/api/routes/report-definitions.ts`, `src/frontend/features/schedules`. Xem [failure recovery](../workflows/failure-recovery.md).
