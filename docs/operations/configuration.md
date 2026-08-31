# Tham chiếu cấu hình

## Thứ tự ưu tiên và khởi động

`backend/src/config.py` load `.env`, đọc default không chứa secret từ `config.yaml` và cho environment variable override YAML. PostgreSQL bắt buộc; `DATABASE_URL` thiếu hoặc không phải PostgreSQL sẽ làm startup fail. `DATABASE_CHECKPOINTER_URL` dùng cho LangGraph checkpoint; có thể cung cấp `DATABASE_MIGRATION_URL` riêng cho migration.

Production validation fail-closed: yêu cầu Supabase auth, email confirmed, database/Supabase key cần thiết, `DATASOURCE_ENCRYPTION_KEY` và setting storage/Google Drive theo provider. Bật planner, verifier enforcement, background jobs hoặc memory khi thiếu dependency hỗ trợ sẽ bị reject thay vì âm thầm degrade.

## Nhóm cấu hình

| Nhóm | Setting quan trọng |
| --- | --- |
| App/API | `APP_ENV`, `APP_HOST`, `APP_PORT`, `CORS_ORIGINS` |
| Database | `DATABASE_URL`, `DATABASE_CHECKPOINTER_URL`, `DATABASE_MIGRATION_URL` |
| Auth | `AUTH_MODE`, guest/signup flag, Supabase URL/issuer/audience/key, email confirmation |
| LLM | `LLM_PROVIDER`, `LLM_MODEL`, provider API key hoặc Ollama setting, temperature, tool round |
| Profiling | scan mode, sample size/strategy/seed, max column, top-k, outlier method |
| Job | worker concurrency, poll interval, lease, max attempt, shutdown grace |
| Analysis | preview timeout/row budget/result limit, Official result limit, quality/statistic budget |
| Security | upload size, raw export, PII masking, rate limit, audit sink, encryption key |
| Retrieval | embedding provider/model/key, rerank, external-knowledge flag |
| Storage | provider/bucket/prefix, guest provider/size/retention, Drive OAuth/chunk setting |
| Runtime/telemetry | trace mode, guardrail limit, LangSmith metadata/tracing, performance telemetry |
| Frontend | `NEXT_PUBLIC_API_URL`, Supabase public URL/key, public UX/auth flag |

YAML hiện chọn Gemini (`gemini-3.6-flash`) và reservoir sampling (10.000 row, seed 42), nhưng đây là default chứ không phải product guarantee. Code-level embedding default là local và external knowledge tắt nếu effective configuration không bật; khi chẩn đoán deployment phải kiểm tra environment thực tế.

## Quản lý bí mật

Không commit `.env`, provider key, JWT secret, database password hoặc OAuth token. `.env.example` chỉ là inventory key, không phải production template. Chỉ variable có prefix `NEXT_PUBLIC_` mới được chủ ý đưa vào browser build.

## Vị trí source code và kiểm chứng

- Settings/validation: [`backend/src/config.py`](../../backend/src/config.py).
- Default: [`config.yaml`](../../config.yaml) và [`.env.example`](../../.env.example).
- Frontend environment: [`frontend/src/lib/api.ts`](../../frontend/src/lib/api.ts) và `frontend/src/app/`.
- Có thể xem effective setting qua `/api/v1/status` trong context đã authorize; không đưa secret vào diagnostic.
