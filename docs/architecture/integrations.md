# Tích hợp ngoài

| Hệ thống | Dùng để làm gì / chiều dữ liệu | Xác thực và lỗi |
| --- | --- | --- |
| Supabase Auth | Browser/API lấy danh tính đăng nhập; API `getUser()` trước thao tác | Publishable key ở client; lỗi trả `AUTH_REQUIRED`/`LOGIN_FAILED`. Dev role bypass chỉ khi được bật và bị cấm trong production. |
| Supabase PostgreSQL | API/worker đọc ghi trạng thái và queue | `SUPABASE_DB_URL` chỉ ở server; thiếu kết nối làm API/worker lỗi, worker dừng ở startup. |
| Supabase Storage | Upload CSV nguồn và export JSON/CSV tới bucket riêng tư | Server dùng `SUPABASE_SECRET_KEY`; lỗi upload trả mã storage, không coi là import/export thành công. |
| Gemini | Provider chính cho narrative và Agent Runtime theo config mặc định | API key/model trên server; timeout/lỗi qua lớp fallback. |
| OpenAI | Fallback bắt buộc theo config ứng dụng | API key/model trên server; provider error được chuẩn hóa. |
| xAI | Adapter tùy chọn cho Agent Runtime | Cần key/model và cờ provider; production giới hạn base URL hợp lệ. |
| Telegram | Webhook câu hỏi và lệnh trạng thái; kết quả ngắn gửi qua outbox sau khi assistant message kết thúc | `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, allowlist `TELEGRAM_BINDINGS_JSON` (chat, Telegram user, workspace user/org, scope, timezone); thiếu cấu hình trả 503. Không công bố transcript hoặc draft. |

Telegram gọi cùng Agent Runtime và conversation/run trong workspace. Binding phải khớp cả chat ID và Telegram user ID; repository kiểm lại quyền thành viên trước khi tạo conversation/turn. `update_id` làm idempotency key, còn ngày phân tích lấy từ timestamp của message theo timezone của binding. Worker chỉ claim delivery khi assistant message đã hoàn tất, và retry tối đa năm lần. Việc gửi qua Telegram API có ngữ nghĩa *at least once*: nếu tiến trình dừng sau khi Telegram chấp nhận nhưng trước khi outbox ghi `sent`, thông báo có thể được gửi lại. Có thể đặt `VDA_PUBLIC_URL` để thêm link về hội thoại đầy đủ.

Không có kết nối MCP hoặc email trong luồng hiện hành.

Code mapping: `src/backend/config/index.ts`, `src/backend/agents/runtime/providers/factory.ts`, `src/backend/database/storage.ts`, `src/backend/agents/external/telegram.ts`, `src/frontend/server/api/routes/telegram.ts`, `src/backend/worker/external-delivery.ts`. Xem [security](security.md).
