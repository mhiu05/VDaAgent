# Cấu hình

> Đã đối chiếu với `config.yaml`, `.env.example` và `backend/src/config.py` ngày 2026-09-01.

Backend nạp cấu hình theo thứ tự ưu tiên:

1. biến môi trường;
2. `config.yaml`;
3. default trong `backend/src/config.py`.

Khi điều tra khác biệt giữa môi trường, hãy kiểm tra giá trị hiệu lực chứ không chỉ đọc một file.

## Thiết lập local tối thiểu

Sao chép `.env.example` thành `.env`, sau đó sửa tối thiểu:

```dotenv
APP_ENV=development
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
AUTH_REQUIRE_EMAIL_CONFIRMED=false
CANONICAL_STORAGE_PROVIDER=local
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/p170
```

`.env.example` cố ý gần production hơn: hiện đặt `APP_ENV=production`, `AUTH_MODE=supabase` và `CANONICAL_STORAGE_PROVIDER=supabase`. Không chạy nguyên trạng với các placeholder.

PostgreSQL là bắt buộc. SQLite không còn là runtime được hỗ trợ.

## Production bắt buộc

- `APP_ENV=production`
- `DATABASE_URL` và, nếu cần kết nối riêng cho release, `DATABASE_MIGRATION_URL`
- `AUTH_MODE=supabase`
- `SUPABASE_URL`, `SUPABASE_AUTH_ISSUER`, `SUPABASE_AUTH_AUDIENCE`
- `SUPABASE_PUBLISHABLE_KEY` cho auth public và `SUPABASE_SECRET_KEY` cho backend
- `DATASOURCE_ENCRYPTION_KEY`
- `CANONICAL_STORAGE_PROVIDER=supabase`, `SUPABASE_STORAGE_BUCKET` và server-side Supabase credential
- `CORS_ORIGINS`
- LLM key khi bật provider cần API key

Chỉ các biến `NEXT_PUBLIC_*` được đưa vào browser bundle. Database URL, secret/service key, connector encryption key, Drive secret và LLM key phải chỉ tồn tại phía server.

## Nhóm cấu hình

### AI và retrieval

`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, timeout/retry, embedding provider/model, external knowledge và các quota agent. `config.yaml` hiện nghiêng về Gemini/Voyage và bật external retrieval, trong khi default Python nghiêng về local và tắt external retrieval; giá trị hiệu lực phụ thuộc môi trường.

### Profiling worker

- concurrency: 1;
- poll: 1 giây;
- lease: 300 giây;
- max attempts: 3;
- shutdown grace: 30 giây.

Tăng concurrency chỉ sau khi đo database pool, RAM và I/O nguồn.

### Profiling và bounded execution

Giới hạn upload/materialization, sample, số cột, top-k, query timeout, preview expiry, row/result cap, planner/chart cap và policy PII.

### Auth và workspace

Auth mode, guest/signup/email confirmation, issuer/audience, JWKS cache, token fallback, bootstrap và capability policy.

### Storage và connector

`CANONICAL_STORAGE_PROVIDER` chọn Supabase production hoặc local development. Google Drive OAuth/folder chỉ bật connector import và không phải dependency startup. `STORAGE_PROVIDER` là bridge cấu hình cũ; không dùng cho deployment mới.

### Telemetry

`PERF_TELEMETRY_ENABLED=true`, slow query threshold mặc định 200 ms, sample rate 1,0 và `PERF_SERVER_TIMING_ENABLED=false`. Các giá trị này có default trong code dù chưa được liệt kê đầy đủ ở `config.yaml` hay `.env.example`.

LangSmith chấp nhận data mode `sanitized_content`, nhưng adapter hiện vẫn ẩn input/output và gửi metadata-only. Không dựa vào tên mode để cho rằng nội dung người dùng đã được export.

## Kiểm tra cấu hình

- Khởi động API và đọc lỗi validation ngay từ startup.
- Gọi `GET /health` và `GET /api/v1/status`.
- Không log secret hoặc toàn bộ settings object.
- Khi đổi policy/limit, cập nhật test hợp đồng và tài liệu cùng commit.
- Production không được bật compatibility auth hoặc local storage do sơ suất.

## Nguồn triển khai

- `.env.example`
- `config.yaml`
- `backend/src/config.py`
- `.github/workflows/azure-container-deploy.yml`
