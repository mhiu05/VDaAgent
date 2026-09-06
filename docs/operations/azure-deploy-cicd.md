# Triển khai Azure và CI/CD

> Trang tương thích cho liên kết cũ, đã đối chiếu ngày 2026-09-06. Runbook hiện hành là [Triển khai Azure](deployment.md) và workflow `.github/workflows/azure-container-deploy.yml`.

Workflow hiện còn tham chiếu layout trước khi source chuyển vào `src/`; không chạy release cho tới khi các blocker trong [giới hạn kiến trúc](../architecture/known-limitations.md) được đóng.

Workflow được thiết kế build hai image (`backend`, `frontend`), push vào ACR `p170linh260829acr.azurecr.io`, chạy migration bằng image theo commit SHA, rồi triển khai ba App Service: API `vdaagent-api`, worker lấy từ biến `AZURE_PROFILING_WORKER_APP` và frontend `vdaagent`.

## Trigger và quality gate

- `push` vào `main`: kiểm tra thay đổi deploy-relevant rồi triển khai.
- `pull_request` vào `main`: chạy quality gate, không triển khai.
- `workflow_dispatch`: có input boolean `skip_quality` cho tình huống đã được phê duyệt.
- Runner là `self-hosted`; Azure login dùng OIDC, không lưu mật khẩu Azure dài hạn.

Quality gate gồm Ruff, migration smoke, pytest, evaluation dry-run/offline, Vitest, typecheck, ESLint, frontend build và Playwright.

## Thứ tự triển khai

1. Validate OIDC, ACR, database, Supabase và encryption configuration.
2. Build/push backend và frontend image với tag `${GITHUB_SHA}` cùng `latest`.
3. Chạy `alembic -c alembic.ini upgrade head`.
4. Cập nhật API và worker dùng cùng backend image; worker startup là `python -m src.workers.profiling_worker --health-port 8000`.
5. Cập nhật frontend chạy `node server.js` trên port 8080.
6. Restart và kiểm tra `/health` của API, worker và frontend.

## Cấu hình bắt buộc

Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_PULL_USERNAME`, `ACR_PULL_PASSWORD`, `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `DATASOURCE_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Repository variable bắt buộc: `AZURE_PROFILING_WORKER_APP`.

Google Drive, LangSmith và LLM key chỉ cần khi bật các tích hợp tương ứng. Không commit `.env`; không đưa secret server-side vào biến `NEXT_PUBLIC_*`.

## Endpoint kiểm tra

- API: `https://vdaagent-api.azurewebsites.net/health`
- Frontend: `https://vdaagent.azurewebsites.net/health`
- Worker: `https://<AZURE_PROFILING_WORKER_APP>.azurewebsites.net/health`

Nếu cần rollback, chọn lại image commit SHA tương thích cho cả API/worker/frontend và tuân thủ migration restore plan. Không dùng tên resource/app cũ trong các tài liệu lịch sử.
