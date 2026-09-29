# Tích hợp ngoài

| Hệ thống | Dùng để làm gì / chiều dữ liệu | Xác thực và lỗi |
| --- | --- | --- |
| Supabase Auth | Browser/API lấy danh tính đăng nhập; API `getUser()` trước thao tác | Publishable key ở client; lỗi trả `AUTH_REQUIRED`/`LOGIN_FAILED`. Dev role bypass chỉ khi được bật và bị cấm trong production. |
| Supabase PostgreSQL | API/worker đọc ghi trạng thái và queue | `SUPABASE_DB_URL` chỉ ở server; thiếu kết nối làm API/worker lỗi, worker dừng ở startup. |
| Supabase Storage | Upload CSV nguồn và export JSON/CSV tới bucket riêng tư | Server dùng `SUPABASE_SECRET_KEY`; lỗi upload trả mã storage, không coi là import/export thành công. |
| Gemini | Provider chính cho narrative và Agent Runtime theo config mặc định | API key/model trên server; timeout/lỗi qua lớp fallback. |
| OpenAI | Fallback bắt buộc theo config ứng dụng | API key/model trên server; provider error được chuẩn hóa. |
| xAI | Adapter tùy chọn cho Agent Runtime | Cần key/model và cờ provider; production giới hạn base URL hợp lệ. |

Không có kết nối MCP, webhook/email hay hệ thống phát báo cáo ra ngoài trong luồng hiện hành.

Code mapping: `src/backend/config/index.ts`, `src/backend/agents/runtime/providers/factory.ts`, `src/backend/database/storage.ts`. Xem [security](security.md).
