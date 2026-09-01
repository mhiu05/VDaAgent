# Triển khai Azure

Production dùng ba Azure App Service container và Azure Container Registry:

| Thành phần | App hiện tại | Image |
| --- | --- | --- |
| API | `p170-api-08140037` | `backend:<git-sha>` |
| Profiling worker | biến repo `AZURE_PROFILING_WORKER_APP` | cùng backend image |
| Frontend | `p170-web-08140019` | `frontend:<git-sha>` |

Resource group là `rg-p170-hieu`; registry là `p170acr08140037.azurecr.io`.

## Workflow

Nguồn sự thật là `.github/workflows/azure-container-deploy.yml`.

- Pull request và workflow thủ công chạy quality gate trừ khi manual input `skip_quality` được bật.
- Push trực tiếp lên `main` hiện bỏ qua hai quality job theo điều kiện workflow và đi tới release.
- Pull request không deploy.
- Release dùng hosted Ubuntu runner, đăng nhập Azure bằng GitHub OIDC và tag image bằng immutable commit SHA cùng `latest`.

Vì push `main` không tự chạy quality job, branch protection/PR gate phải là lớp bắt buộc nếu muốn đảm bảo test trước mọi release.

## Quality gate

Backend:

- Ruff;
- migration smoke với PostgreSQL 16;
- pytest;
- evaluation contract dry-run/offline.

Frontend:

- pnpm install khóa bằng lockfile;
- Vitest;
- typecheck;
- ESLint;
- production build;
- Playwright Chromium.

## Thứ tự release

1. validate secret/variable production;
2. build và push backend image;
3. build và push frontend image;
4. chạy Alembic tới head bằng backend image cùng SHA;
5. cấu hình/deploy API;
6. cấu hình/deploy worker với startup `python -m src.workers.profiling_worker --health-port 8000`;
7. cấu hình/deploy frontend với `node server.js`;
8. restart cả ba app;
9. chờ `/health` của API, worker và frontend trả 200.

Migration lỗi sẽ chặn deployment. API và worker luôn phải dùng cùng backend SHA.

## Secret và variable

Bắt buộc gồm Azure OIDC, ACR pull credential, database URL, Supabase secret/public config, `CANONICAL_STORAGE_PROVIDER=supabase`, bucket và datasource encryption key. Drive client ID, secret, folder và token encryption key chỉ cần khi bật connector Google Drive; thiếu Drive không làm API/worker unhealthy. Worker app name là repository variable, không phải secret.

LLM key là bắt buộc về mặt chức năng khi provider cần nó, dù bước validate hiện không đưa `LLM_API_KEY` vào danh sách hard-required. Hãy kiểm tra trước release.

Workflow hiện còn thông báo lỗi trỏ tới file đã xóa `docs/azure-deploy-cicd.md`; tài liệu hiện hành là trang này.

## Rollback

- Chọn SHA image đã chạy ổn trước đó cho cả API và worker; chọn frontend SHA tương thích.
- Không dùng force-push hay sửa lịch sử Git để rollback.
- Nếu schema backward-compatible, rollback container trước.
- Nếu schema không backward-compatible, thực hiện restore/downgrade theo runbook migration đã review.
- Sau rollback, kiểm tra ba health endpoint, login, queue/worker và một truy vấn workspace-scoped.

## Kiểm tra sau deploy

Ngoài health, nên xác minh:

- `GET /api/v1/status` không lộ secret;
- auth Supabase và email confirmation;
- tạo/upload một synthetic dataset;
- finalize upload hai lần và xác nhận chỉ có một dataset/artifact;
- worker claim và hoàn tất job;
- SSE terminal event;
- QA abstain/verified đúng contract;
- browser role không đọc được bảng domain qua Data API.
- chạy `python scripts/reconcile_storage.py --workspace-id <synthetic-workspace>` ở chế độ báo cáo.
