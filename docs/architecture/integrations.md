# Tích hợp ngoài

| Hệ thống | Dùng để làm gì / chiều dữ liệu | Xác thực và lỗi |
| --- | --- | --- |
| Supabase Auth | Browser/API lấy danh tính đăng nhập; API `getUser()` trước thao tác | Publishable key ở client; lỗi trả `AUTH_REQUIRED`/`LOGIN_FAILED`. Dev role bypass chỉ khi được bật và bị cấm trong production. |
| Supabase PostgreSQL | API/worker đọc ghi trạng thái và queue | `SUPABASE_DB_URL` chỉ ở server; thiếu kết nối làm API/worker lỗi, worker dừng ở startup. |
| Supabase Storage | Upload CSV nguồn và export JSON/CSV tới bucket riêng tư | Server dùng `SUPABASE_SECRET_KEY`; lỗi upload trả mã storage, không coi là import/export thành công. |
| Gemini | Provider chính cho narrative và Agent Runtime theo config mặc định | API key/model trên server; timeout/lỗi qua lớp fallback. |
| OpenAI | Fallback bắt buộc theo config ứng dụng | API key/model trên server; provider error được chuẩn hóa. |
| xAI | Adapter tùy chọn cho Agent Runtime | Cần key/model và cờ provider; production giới hạn base URL hợp lệ. |

**Partially implemented:** `McpGateway` có cơ chế discover, allowlist, schema, timeout và session nhưng không thấy luồng sản xuất đăng ký server hoặc gọi gateway. Vì vậy chưa có kết nối MCP vận hành mặc định. Không thấy webhook/email hay hệ thống phát báo cáo ra ngoài.

Code mapping: `src/backend/packages/config/src/index.ts`, `src/backend/packages/agents/src/runtime/providers/factory.ts`, `src/backend/packages/db/src/storage.ts`, `src/backend/packages/agents/src/runtime/team/mcp-gateway.ts`. Xem [security](security.md).
