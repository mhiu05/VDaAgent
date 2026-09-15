# Triển khai Azure

> Đã đối chiếu trực tiếp với `.github/workflows/azure-container-deploy.yml` ngày 2026-09-15. Đây là workflow/target topology, không phải xác nhận môi trường production hiện đang healthy.

> **Build contract:** backend dùng repository root làm Docker context; frontend dùng `src/frontend`. Bộ lọc deploy không theo dõi thay đổi docs hoặc `scripts/retire_database_connectors.py`; rollout CLI credential là bước vận hành riêng, không tự chạy qua workflow.

Topology release được định nghĩa với ba Azure App Service container và một Azure Container Registry (ACR):

| Thành phần | Tên hiện tại | Image/port |
| --- | --- | --- |
| API | `vdaagent-api` | `backend:<commit-sha>` / 8000 |
| Profiling worker | repository variable `AZURE_PROFILING_WORKER_APP` | cùng backend image / health 8000 |
| Frontend | `vdaagent` | `frontend:<commit-sha>` / 8080 |

Workflow đặt resource group `rg-p170-linh-260829`, ACR `p170linh260829acr` và URL mặc định `https://vdaagent-api.azurewebsites.net` (API), `https://vdaagent.azurewebsites.net` (frontend).

## Workflow

Nguồn sự thật là `.github/workflows/azure-container-deploy.yml`.

- Pull request và `workflow_dispatch` được thiết kế chạy backend/frontend quality gate; manual run có thể chọn `skip_quality`.
- Push vào `main` deploy theo điều kiện workflow; hai quality job bị skip trên push trực tiếp. Branch protection/PR gate phải bảo đảm kiểm thử trước release.
- Pull request không deploy.
- Job `changes` theo dõi `src/backend/**`, `src/frontend/**`, Dockerfile, requirements, Alembic, một số script release đã liệt kê trong workflow, Makefile và workflow; không bao gồm mọi script mới.
- Release dùng self-hosted runner, OIDC Azure, image tag bất biến theo commit SHA và thêm tag `latest`.

## Quality gate

Backend: Ruff, PostgreSQL migration smoke, toàn bộ pytest và evaluation dry-run/offline. Frontend: pnpm frozen-lockfile, Vitest, typecheck, ESLint, production build và Playwright Chromium.

## Thứ tự release

1. Validate secret/variable production.
2. Build/push backend và frontend image lên ACR.
3. Chạy `alembic upgrade head` bằng backend image cùng SHA.
4. Cấu hình/deploy API và worker; worker chạy `python -m src.workers.profiling_worker --health-port 8000`.
5. Cấu hình/deploy frontend với `node server.js` trên port 8080.
6. Restart cả ba app và chờ health API, worker, frontend trả HTTP 200.

Migration lỗi hoặc health check thất bại sẽ chặn release. API và worker phải dùng cùng backend SHA. Các endpoint health chỉ kiểm tra process/HTTP; kiểm tra DB, auth và nghiệp vụ sau deploy là bước riêng.

## Secret và variable

Workflow yêu cầu Azure OIDC (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), ACR pull credential, `DATABASE_URL`, `SUPABASE_SECRET_KEY`, datasource encryption key và Supabase public build config. `AZURE_PROFILING_WORKER_APP` là repository variable. LLM/Google Drive/LangSmith là tùy chọn theo path sử dụng, nhưng provider LLM cần key hợp lệ khi bật.

Workflow đặt `AUTH_MODE=supabase`, `CANONICAL_STORAGE_PROVIDER=supabase`, Supabase issuer/audience, bucket `p170-dataset`, CORS frontend và `AGENT_TRACE_MODE=shadow`. `DATASOURCE_ENCRYPTION_KEY` vẫn bắt buộc ở startup/workflow sau purge; không revoke nó chỉ dựa trên rollout CLI. Không đưa database URL, secret key, token connector hay LLM key vào frontend.

## Database connector rollout

Migration `20260915_0028` trong working tree cho phép bỏ credential khỏi tombstone legacy. Rollout dùng
`scripts/retire_database_connectors.py`: command không giải mã hay in config, mặc định
read-only ở cả repository lẫn PostgreSQL transaction, và chỉ purge credential khi có cả
ba cờ explicit. CLI ưu tiên `DATABASE_MIGRATION_URL` và có thể chạy chỉ với biến này;
`DATABASE_URL` là fallback. Chạy từ repository root với DSN production đã được cấp qua
secret manager. Script rollout không được đóng gói vào backend Azure image; chạy riêng từ checkout có script và dependencies phù hợp:

```powershell
python scripts/retire_database_connectors.py --dry-run
python -m alembic -c alembic.ini upgrade head
python scripts/retire_database_connectors.py --dry-run
python scripts/retire_database_connectors.py --execute --purge-credentials --yes
python scripts/retire_database_connectors.py --dry-run
```

Lưu JSON-lines inventory trước/sau vào release evidence. Command chuyển active
MySQL/MongoDB/DuckDB sang `disabled`, xóa `config_encrypted` và fingerprint, kể cả
tombstone đã delete từ bản cũ; không xóa canonical artifact hay dataset đã ingest. Sau
deploy, kiểm tra `GET /api/v1/connectors`: chỉ Google Drive xuất hiện trong `available`;
connection legacy nếu còn chỉ có `disabled`/`unavailable` và Owner chỉ có hành động xóa.

Theo dõi audit event `database_connector.rejected` theo route/provider. Không rollback bằng cách tái bật connector; rollback application vẫn phải giữ guard fail-closed cho đến khi có security design mới được review.

## Rollback

- Chọn lại commit-SHA image tương thích cho API, worker và frontend.
- Không force-push và không rollback schema bằng cách sửa tay.
- Nếu schema không tương thích ngược, dùng migration/restore plan đã review.
- Sau rollback kiểm tra health, đăng nhập, workspace-scoped query, queue/worker và SSE terminal event.

## Kiểm tra sau deploy

```powershell
curl https://vdaagent-api.azurewebsites.net/health
curl https://vdaagent.azurewebsites.net/health
python scripts/reconcile_storage.py --workspace-id <synthetic-workspace>
```

Nên chạy thêm synthetic upload/finalize, profiling, QA verified/abstain và assertion browser role không đọc bảng domain qua Supabase Data API. Chi tiết OIDC/ACR nằm trong chính workflow; không dùng tài liệu Azure cũ với tên app khác.
