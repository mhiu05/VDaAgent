# Triển khai Azure

## Quy trình hiện tại

Source of truth là [`.github/workflows/azure-container-deploy.yml`](../../.github/workflows/azure-container-deploy.yml). Pull request vào `main` chạy quality job trừ khi `workflow_dispatch` đặt `skip_quality`; push vào `main` build/deploy và bỏ qua quality job theo condition hiện tại. Workflow dùng self-hosted runner, PostgreSQL 16 cho kiểm tra, Python 3.11, Node 22, pnpm 11, Vitest, Playwright, Ruff, pytest, typecheck, lint, build, e2e và offline/dry-run evaluation.

## Cấu trúc triển khai Azure

Tên hiện có trong workflow:

- resource group `rg-p170-hieu`;
- ACR `p170acr08140037.azurecr.io`;
- backend App Service `p170-api-08140037`;
- frontend App Service `p170-web-08140019`;
- worker app lấy từ repository variable `AZURE_PROFILING_WORKER_APP`.

Image được tag bằng commit SHA và `latest`. Backend image được dùng lại cho worker với startup command `python -m src.workers.profiling_worker --health-port 8000`. Frontend chạy standalone Next server ở port 8080 và chứa Chromium/font cho PDF export. Backend và worker đặt always-on rồi restart sau deployment.

## Trình tự release

1. Validate production configuration và Azure/OIDC/ACR credential cần thiết.
2. Login Azure và ACR.
3. Build/push backend/frontend image theo SHA bất biến và `latest`.
4. Chạy Alembic migration từ backend image.
5. Deploy container backend, worker và frontend.
6. Restart app rồi poll backend `/health`, worker `/health` và frontend `/health`.

Migration chỉ bị bỏ qua khi cả migration/database URL đều rỗng; production configuration đúng phải khiến điều kiện này không xảy ra. Secret theo provider (Supabase, encryption, Google Drive khi chọn) được validate trước deployment.

## Lưu ý rollback

Workflow không thực hiện database rollback phá hủy hoặc force-push. Khi image lỗi, có thể deploy lại SHA đã build trước sau khi kiểm tra migration compatibility và health. Migration là thay đổi forward-compatible cần xem lại trong `backend/migrations/` trước rollback.

## Vị trí source code và kiểm chứng

- Workflow: [`.github/workflows/azure-container-deploy.yml`](../../.github/workflows/azure-container-deploy.yml).
- Image: [`Dockerfile.backend.azure`](../../Dockerfile.backend.azure), [`Dockerfile.frontend.azure`](../../Dockerfile.frontend.azure).
- Kiểm tra local: [phát triển và kiểm thử local](../development/local-development-and-testing.md).
