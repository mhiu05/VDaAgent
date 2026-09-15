# Cấu hình

> Đã đối chiếu với `config.yaml`, `.env.example` và `src/backend/src/config.py` ngày 2026-09-15.

> `PROJECT_ROOT` được resolve từ vị trí source về repository root chứa `README.md`, `config.yaml` và `alembic.ini`, vì vậy `.env`/`config.yaml` không phụ thuộc working directory. Xem [giới hạn hiện tại](../architecture/known-limitations.md) cho các hạn chế cấu hình còn lại.

Backend nạp cấu hình theo thứ tự ưu tiên:

1. biến môi trường;
2. `config.yaml`;
3. default trong `src/backend/src/config.py`.

File `.env` tại repository root được nạp như biến môi trường; giá trị trong file này có thể ghi đè `config.yaml`. Không chia sẻ nội dung `.env` khi báo lỗi.

Khi điều tra khác biệt giữa môi trường, hãy kiểm tra giá trị hiệu lực chứ không chỉ đọc một file.

## Thiết lập local tối thiểu

Sao chép `.env.example` thành `.env`, sau đó sửa tối thiểu:

```dotenv
APP_ENV=development
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
AUTH_REQUIRE_EMAIL_CONFIRMED=false
CANONICAL_STORAGE_PROVIDER=local
GUEST_STORAGE_PROVIDER=local
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/p170
```

`.env.example` cố ý gần production hơn: hiện đặt `APP_ENV=production`, `AUTH_MODE=supabase` và `CANONICAL_STORAGE_PROVIDER=supabase`. Không chạy nguyên trạng với các placeholder; file này cũng không liệt kê hết secret bắt buộc hay mọi biến frontend. Đối chiếu `Settings.missing_required()` và workflow trước khi deploy.

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

Frontend cần `NEXT_PUBLIC_API_URL` và `NEXT_PUBLIC_SITE_URL` theo môi trường; Supabase browser Auth cần `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (workflow dùng chúng ở build time, nhưng `.env.example` chưa liệt kê cả hai). `NEXT_PUBLIC_AUTH_ALLOW_GUEST` chỉ bật cho guest trial local. Next server PDF ưu tiên `INTERNAL_API_URL` rồi `NEXT_PUBLIC_API_URL`, dùng Chromium được tìm từ `PDF_CHROMIUM_EXECUTABLE_PATH` hoặc path hệ thống; frontend Azure image đã cài Chromium và đặt path này. Không đặt server secret trong các biến `NEXT_PUBLIC_*`.

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

### Database connector policy

Pilot chỉ hỗ trợ upload canonical và Google Drive import. MySQL, MongoDB và DuckDB database connector bị tắt cố định ở backend. `DATABASE_CONNECTORS_ENABLED` mặc định là `false`; nếu đặt `true`, Settings từ chối khởi động thay vì làm rộng trust boundary. Không dùng feature flag hay override deployment để tái bật connector.

`DATASOURCE_ENCRYPTION_KEY` vẫn là secret production vì `Settings.missing_required()` và workflow Azure còn kiểm tra nó, ngay cả sau khi credential legacy đã được purge. Không revoke/chặn cấp key trước một thay đổi cấu hình và release riêng. Không log giá trị đã giải mã, hostname, URI, password hoặc đường dẫn DuckDB. Tái mở connector cần một thiết kế hardening/egress/sandbox độc lập và không thuộc cấu hình pilot.

### Telemetry

`PERF_TELEMETRY_ENABLED=true`, slow query threshold mặc định 200 ms, sample rate 1,0 và `PERF_SERVER_TIMING_ENABLED=false`. Các giá trị này có default trong code dù chưa được liệt kê đầy đủ ở `config.yaml` hay `.env.example`.

LangSmith chấp nhận data mode `sanitized_content`, nhưng adapter hiện vẫn ẩn input/output và gửi metadata-only. Không dựa vào tên mode để cho rằng nội dung người dùng đã được export.

## Kiểm tra cấu hình

- Khởi động API và đọc lỗi validation ngay từ startup.
- Gọi `GET /health` và `GET /api/v1/status`; health HTTP 200 không chứng minh database/storage sẵn sàng.
- Không log secret hoặc toàn bộ settings object.
- Khi đổi policy/limit, cập nhật test hợp đồng và tài liệu cùng commit.
- Production không được bật compatibility auth hoặc local storage do sơ suất.

## Nguồn triển khai

- `.env.example`
- `config.yaml`
- `src/backend/src/config.py`
- `.github/workflows/azure-container-deploy.yml`
