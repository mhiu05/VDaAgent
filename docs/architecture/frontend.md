# Frontend

**Implemented.** `src/frontend` dùng Next.js App Router; các trang `/workspace`, `/chat`, `/chat/[conversationId]`, `/runs`, `/runs/[runId]`, `/reports`, `/reports/[reportId]`, `/data/imports`, `/automations` dựng chung `Workspace`. Root `/` chuyển hướng vào workspace. `Workspace` chọn tổ chức từ session, điều hướng tới Grok Workspace hoặc các panel chức năng.

`features/agent-chat` quản lý conversation, message, turn, job, run runtime và context. `features/agent-workspace` ghép rail, hội thoại và inspector. `features/analysis`, `reports`, `imports`, `schedules`, `evidence`, `runs` giữ API client và state riêng cho từng bề mặt. State chủ yếu là React hooks/reducer; dữ liệu lâu dài nằm ở backend.

Mỗi tác nhân có một view trong conversation hiện có, chọn qua tham số URL `agent`. Feed theo tác nhân đọc lịch sử đã lưu, gồm message và thẻ giao việc có liên kết request, invocation, kết quả, artifact. Tham số `item` mở trực tiếp một hoạt động cũ; `run` và `invocation` chọn đúng chi tiết thực thi trong inspector. Rail lấy trạng thái và công việc đã nhận từ toàn bộ conversation, kể cả run khác với run đang xem. Các view không tạo conversation hay kênh lưu trữ riêng.

Giao tiếp qua `lib/http/api-client.ts` và các module `features/*/api`. Chat gửi idempotency identity; hook khôi phục job sau refresh bằng API. SSE đọc event có cursor rồi refresh snapshot; polling vẫn có để phục hồi hoặc khi SSE không khả dụng. Run analysis riêng có polling. Giao diện dùng các route URL theo tổ chức, nhưng API kiểm tra quyền độc lập.

Runtime snapshot có watermark cho độ mới của records; cursor SSE chỉ tiến theo event thực sự đã nhận. Bản ghi mới trong snapshot không bị ghi đè bởi một trang replay cũ. Browser chỉ theo dõi trạng thái; turn và run tiếp tục xử lý trong worker khi đóng trang. Trạng thái chờ của lời gọi con được lưu trong runtime activities; sau khi worker lấy lại lease, workflow dựng lại điều khiển từ các stage checkpoint hiện có.

Code mapping: `src/frontend/features/workspace/workspace.tsx`, `src/frontend/features/agent-chat/hooks/use-agent-chat-controller.ts`, `src/frontend/features/agent-chat/hooks/use-agent-execution.ts`, `src/frontend/components/shell/routes.ts`. Xem [streaming](../api/streaming.md).
