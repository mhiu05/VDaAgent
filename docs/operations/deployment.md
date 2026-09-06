# Triển khai Azure

> Đã đối chiếu trực tiếp với `.github/workflows/azure-container-deploy.yml` ngày 2026-09-06.

> **Release blocker hiện tại:** workflow, Docker build context và path filter vẫn dùng `backend/`/`frontend/`, trong khi source đã chuyển vào `src/`. Topology và thứ tự release dưới đây vẫn là thiết kế triển khai, nhưng working tree hiện chưa build/deploy được từ clean checkout cho tới khi đồng bộ đường dẫn. Xem [giới hạn hiện tại](../architecture/known-limitations.md).

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
- Job `changes` hiện chỉ nhận diện layout cũ; sau migration phải theo dõi `src/backend/**`, `src/frontend/**`, Dockerfile, requirements Azure, Alembic và workflow.
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

Migration lỗi hoặc health check thất bại sẽ chặn release. API và worker phải dùng cùng backend SHA.

## Secret và variable

Workflow yêu cầu Azure OIDC (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), ACR pull credential, `DATABASE_URL`, `SUPABASE_SECRET_KEY`, datasource encryption key và Supabase public build config. `AZURE_PROFILING_WORKER_APP` là repository variable. LLM/Google Drive/LangSmith là tùy chọn theo path sử dụng, nhưng provider LLM cần key hợp lệ khi bật.

Backend production luôn đặt `AUTH_MODE=supabase`, `CANONICAL_STORAGE_PROVIDER=supabase`, Supabase issuer/audience, bucket `p170-dataset`, CORS frontend và `AGENT_TRACE_MODE=shadow`. Không đưa database URL, secret key, token connector hay LLM key vào frontend.

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
