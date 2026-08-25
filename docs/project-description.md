# VDaAgent — Mô tả dự án và kỹ thuật sử dụng

## Mô tả dự án

VDaAgent là nền tảng profiling và phân tích dữ liệu theo mô hình workspace. Người dùng tải lên CSV, TSV, Parquet hoặc JSON; hệ thống tự động lập hồ sơ schema, chất lượng và quyền riêng tư, sau đó cho phép Analyst kiểm duyệt metadata/PII trước khi sử dụng kết quả cho biểu đồ, hỏi đáp, so sánh drift và báo cáo PDF/JSON.

Dự án theo nguyên tắc **evidence-first**: các con số được tính toán từ dữ liệu bằng pipeline deterministic, còn AI chỉ hỗ trợ lập kế hoạch, diễn giải và trả lời trong phạm vi bằng chứng đã xác thực.

## Kỹ thuật sử dụng

- **Frontend:** Next.js 15, React 19, TypeScript, React Query và Tailwind/CSS.
- **Backend:** Python, FastAPI, REST API và SSE cho dữ liệu streaming.
- **Data processing:** DuckDB, pandas, NumPy và SciPy để profiling, thống kê, quality checks, drift và forecasting.
- **Agent/AI:** LangGraph, native skill registry và LLM provider tùy cấu hình; số liệu không do LLM tự tính.
- **Database:** PostgreSQL/Supabase PostgreSQL lưu user, workspace, dataset metadata, profile run, evidence, report và audit log.
- **Storage:** Supabase Storage, Google Drive hoặc local storage tùy môi trường.
- **Security:** Supabase Auth, JWT/JWKS, PKCE, workspace-scoped authorization, capability permissions, PII masking và audit trail.
- **Processing architecture:** profiling worker xử lý job bất đồng bộ, có lease, retry giới hạn, idempotency và HITL checkpoint/resume.
- **Deployment:** Docker, GitHub Actions và Azure Container Apps/Container Registry.

## Luồng chính

```text
Đăng nhập → Workspace → Upload dataset → Profile Run bất đồng bộ
→ Profiling deterministic → Analyst review → Completed profile
→ Charts / Agent Q&A / Drift comparison / Report snapshot
```

Xem chi tiết kiến trúc tại [ARCHITECTURE.md](../ARCHITECTURE.md) và hướng dẫn cài đặt tại [README.md](../README.md).
