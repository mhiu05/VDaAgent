# Plan

Triển khai VDaAgent lên Azure App Service bằng hai Linux container độc lập (FastAPI và Next.js), lưu image trong Azure Container Registry (ACR), còn PostgreSQL/Auth/Storage dùng Supabase. Kế hoạch ưu tiên một đường phát hành có migration, smoke test và rollback rõ ràng; các image luôn được gắn tag bất biến theo Git SHA.

## Scope

- In: chuẩn hóa Dockerfile/requirements, cấu hình Azure App Service và ACR, GitHub Actions OIDC, migration Alembic, biến môi trường production, kiểm tra sau deploy và rollback.
- Out: custom domain, Azure Front Door/WAF, autoscaling nhiều region, backup/DR và chuyển toàn bộ hạ tầng sang Bicep/Terraform. Các phần này nên làm sau khi bản phát hành đầu tiên ổn định.

## Kiến trúc đích

```text
Browser
  -> p170-web-*.azurewebsites.net (Next.js container :8080)
       -> public API calls
  -> p170-api-*.azurewebsites.net (FastAPI container :8000)
       -> Supabase PostgreSQL/Auth/Storage

GitHub Actions (OIDC)
  -> build + push backend/frontend:<git-sha> vào ACR
  -> chạy Alembic upgrade head
  -> cập nhật backend image -> smoke test
  -> cập nhật frontend image -> smoke test
```

## Hiện trạng cần sửa trước khi deploy

1. Repository có `Dockerfile.backend.azura`, `Dockerfile.frontend.azura`, `requirements.azura.txt`, nhưng workflow lại gọi các file đuôi `.azure`; backend Dockerfile còn copy `requirements.azure.txt`. Build hiện tại sẽ không tìm thấy file.
2. `requirements.azura.txt` chưa đồng bộ runtime dependency: ít nhất thiếu `charset-normalizer`, trong khi `backend/src/services/tabular_source.py` import trực tiếp package này. Cần quyết định rõ dependency production nào bắt buộc và loại dev-only packages khỏi image.
3. Workflow mới chỉ đặt port cho backend; các biến bắt buộc như database, Supabase, auth, storage, CORS và LLM chưa được cấp cho App Service nên backend production không thể khởi động đúng contract hiện tại.
4. Workflow chưa chạy `alembic upgrade head`. App có một số bootstrap tương thích trong repository, nhưng release production vẫn phải chạy migration versioned trước khi chuyển image.
5. Frontend chưa truyền `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` khi build, nên giao diện sản phẩm chính có thể vẫn bị tắt. `NEXT_PUBLIC_*` là build-time; đặt lại ở App Service sau build không sửa bundle đã tạo.
6. Route render PDF chạy trong Next.js cần gọi backend server-to-server. Nên đặt `INTERNAL_API_URL`; chỉ dựa vào `NEXT_PUBLIC_API_URL` làm fallback khiến cấu hình public và internal bị trộn.
7. Workflow dùng OIDC thủ công qua `curl`/`sed`, hard-code tài nguyên, đẩy cả `latest`, không có concurrency lock, migration gate, health gate hay rollback tự động.
8. Chưa thấy bước cấu hình managed identity của hai Web App với quyền `AcrPull`. Nếu ACR tắt admin credentials, Web App có thể cập nhật image reference nhưng không pull được image.

## Ma trận biến môi trường production

`.env.example` là tài liệu contract cho local và production; không upload file `.env` thật lên Azure. Trong Azure, backend secrets/non-secrets được lưu dưới App Service Application settings (hoặc Key Vault references), còn giá trị public của frontend được truyền vào lúc build.

| Nhóm | Biến | Giá trị production / nơi cấu hình |
| --- | --- | --- |
| Backend runtime | `APP_ENV` | `production`; App Service setting |
| Backend runtime | `APP_LOG_LEVEL` | `INFO`; App Service setting |
| Backend runtime | `CORS_ORIGINS` | Chính xác origin HTTPS của frontend, không dùng `*` vì app gửi credentials |
| Database secret | `DATABASE_URL` | DSN `postgresql+psycopg://...`; App Service/Key Vault; không đưa vào frontend |
| Migration secret | `DATABASE_MIGRATION_URL` | DSN direct/session pooler có quyền DDL; GitHub production environment hoặc Key Vault. Nếu bỏ trống, Alembic dùng `DATABASE_URL` |
| Checkpointer secret | `DATABASE_CHECKPOINTER_URL` | Có thể bỏ trống để suy ra từ `DATABASE_URL`; điền DSN riêng nếu cần |
| Auth | `AUTH_MODE` | Bắt buộc `supabase` ở production |
| Auth policy | `AUTH_ALLOW_SIGNUP`, `AUTH_ALLOW_GUEST`, `AUTH_REQUIRE_EMAIL_CONFIRMED` | Khuyến nghị lần đầu: `false`, `false`, `true`; frontend public flags phải khớp hai giá trị đầu |
| Supabase public | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | App Service backend; publishable key không phải service secret nhưng vẫn quản lý tập trung |
| Supabase secret | `SUPABASE_SECRET_KEY` | App Service/Key Vault, backend-only; không bao giờ tạo biến `NEXT_PUBLIC_*` cho key này |
| Supabase auth | `SUPABASE_AUTH_ISSUER`, `SUPABASE_AUTH_AUDIENCE` | Issuer có thể bỏ trống để suy ra từ URL; audience mặc định `authenticated` |
| Storage | `STORAGE_PROVIDER`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_PREFIX` | Khuyến nghị `supabase`, `p170-dataset`, `datasets`; bucket phải tồn tại trước smoke test upload |
| LLM secret | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` hoặc provider key | App Service/Key Vault; thiếu key thì compute vẫn chạy nhưng narrative/Q&A không đầy đủ |
| Agent/UX | `AGENT_TRACE_MODE`, `UX_COMMAND_CENTER_ENABLED` | `shadow`, `true` sau khi migration và test staging đạt; giữ planner/jobs/memory chưa phát hành ở `false` |
| Frontend build public | `NEXT_PUBLIC_API_URL` | `https://<backend-app>.azurewebsites.net/api/v1` |
| Frontend build public | `NEXT_PUBLIC_SITE_URL` | `https://<frontend-app>.azurewebsites.net` |
| Frontend build public | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cùng project Supabase với backend; chỉ các giá trị public |
| Frontend build public | `NEXT_PUBLIC_AUTH_ALLOW_SIGNUP`, `NEXT_PUBLIC_AUTH_ALLOW_GUEST` | Phải khớp policy backend tại thời điểm build |
| Frontend build public | `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | `true` khi backend flag đã bật và migration đã thành công |
| Frontend server-only | `INTERNAL_API_URL` | `https://<backend-app>.azurewebsites.net/api/v1`; App Service runtime setting, không có prefix public |
| Frontend server-only | `PDF_FONT_PATH` | Tùy chọn; để trống dùng `public/fonts/arial.ttf` đã đóng gói |

Các setting của nền tảng Azure không cần đặt trong `.env.example`: backend dùng `WEBSITES_PORT=8000`; frontend dùng `WEBSITES_PORT=8080`, `PORT=8080`, `NODE_ENV=production`. GitHub OIDC cần ba secret `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Tên tài nguyên nên chuyển thành GitHub Environment variables: `AZURE_RESOURCE_GROUP`, `AZURE_ACR_NAME`, `AZURE_ACR_LOGIN_SERVER`, `AZURE_BACKEND_APP`, `AZURE_FRONTEND_APP`, `AZURE_BACKEND_URL`, `AZURE_FRONTEND_URL`.

## Action items

- [ ] **Chuẩn hóa tên và contract build.** Đổi ba file `*.azura` thành `Dockerfile.backend.azure`, `Dockerfile.frontend.azure`, `requirements.azure.txt` và sửa toàn bộ reference trong `.github/workflows/azura-container-deploy.yml` (nên đổi luôn workflow thành `azure-container-deploy.yml`). Chỉ làm một lần để tránh duy trì alias sai chính tả.

- [ ] **Chốt dependency image backend.** Tạo `requirements.azure.txt` từ dependency runtime thực tế, thêm ít nhất `charset-normalizer`, xác minh các nhánh retrieval cần `sentence-transformers` hay chỉ dùng Voyage trong production, và loại `pytest`, `ruff`, `httpx` nếu không được dùng lúc runtime. Build image từ repository root để `COPY backend ./backend`, `COPY config.yaml ./` và Alembic assets có cùng ngữ cảnh. Thêm `HEALTHCHECK` gọi `/health`, chạy process bằng user không phải root nếu không có dependency ghi vào system path, và giữ port container là `8000`.

- [ ] **Tối ưu image frontend và đóng gói PDF assets.** Giữ build context là `frontend/`; đảm bảo các lệnh `COPY` chỉ tham chiếu file trong context này. Bổ sung build arg `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED`, đặt `output: standalone` trong `frontend/next.config.ts`, rồi chỉ copy `.next/standalone`, `.next/static`, `public` và font Arial vào runner image. Runner lắng nghe `0.0.0.0:8080`; `INTERNAL_API_URL` chỉ được cấp lúc chạy container, không truyền thành public build arg.

- [ ] **Tạo gate kiểm tra trước khi push image.** Chạy backend compile/lint và frontend `pnpm typecheck`, `pnpm lint`, unit/E2E phù hợp. Sau đó build local bằng `docker build -f Dockerfile.backend.azure -t p170-backend:local .` và `docker build -f Dockerfile.frontend.azure ... -t p170-frontend:local frontend`. Chạy backend với `--env-file .env`, frontend với các build args production-like, rồi kiểm tra `/health`, trang login, upload nhỏ, Profile Run, Command Center và export PDF.

- [ ] **Chuẩn bị Azure và quyền tối thiểu.** Xác minh resource group, ACR, Linux App Service plan và hai Web App hiện có trước khi tạo mới. Bật system-assigned managed identity cho mỗi Web App, gán `AcrPull` trên đúng ACR và bật `acrUseManagedIdentityCreds=true`. Identity dùng bởi GitHub OIDC chỉ cần quyền push ACR, cập nhật hai Web App/app settings và đọc trạng thái deployment; không dùng ACR admin password.

- [ ] **Chuẩn bị Supabase cho production.** Xác minh PostgreSQL DSN, tạo bucket `p170-dataset`, cấu hình Auth Site URL/redirect URL theo frontend HTTPS và kiểm tra JWKS từ backend network. Chạy `alembic -c alembic.ini current` trên database đã xác nhận, sao lưu hoặc tạo restore point, rồi chạy `alembic -c alembic.ini upgrade head` bằng `DATABASE_MIGRATION_URL`. Không chạy migration từ startup của từng web replica.

- [ ] **Tách GitHub Environment và secret.** Tạo environment `production`, thêm approval nếu cần, đặt các Azure resource names/URLs và public frontend config ở Environment variables; đặt OIDC IDs, database DSN, Supabase secret và LLM key ở Environment secrets. Không ghi secret vào Docker build args, image layer, workflow `env` cấp toàn job hoặc log CLI. Mặc định giữ signup/guest tắt cho lần phát hành đầu.

- [ ] **Viết lại pipeline theo các gate tuần tự.** Workflow chạy trên push `main` và `workflow_dispatch`, dùng `permissions: contents: read, id-token: write`, `azure/login` qua OIDC, đăng nhập ACR, build/push hai image với tag `${GITHUB_SHA}` và cache hợp lệ. Thêm `concurrency` để chỉ một release production chạy, chạy migration một lần, cập nhật backend bằng tag SHA, chờ `/health`, sau đó cập nhật frontend và chờ HTTP 200. Không deploy tag `latest`; có thể push `latest` chỉ như alias quan sát, nhưng App Service phải ghim SHA.

- [ ] **Cấp App Service settings đúng thời điểm.** Backend nhận toàn bộ backend runtime settings và secrets trước lần restart; frontend nhận `INTERNAL_API_URL`, `WEBSITES_PORT`, `PORT`, `NODE_ENV`. Các `NEXT_PUBLIC_*` phải được chốt trước `pnpm build`. Bật HTTPS-only, cấu hình health check backend `/health`, health check frontend `/login` hoặc `/`, Always On nếu plan hỗ trợ, và tăng container startup limit chỉ khi log cho thấy dependency/import cần thêm thời gian.

- [ ] **Thực hiện canary/smoke và rollback.** Sau deploy, kiểm tra backend health/env/LLM status, frontend tải bundle mới, login Supabase, workspace provisioning, upload, profile/review, Explorer preview/promote, Agent, report snapshot và PDF. Kiểm tra CORS trên browser, không chỉ `curl`. Nếu backend smoke thất bại, đổi App Service về backend SHA trước; nếu frontend thất bại, rollback riêng frontend SHA. Migration phá vỡ tương thích phải có kế hoạch downgrade hoặc dùng expand/contract để image cũ vẫn chạy được.

- [ ] **Ghi nhận Definition of Done.** Release hoàn tất khi workflow xanh, hai App Service chạy đúng SHA, Alembic ở `head`, không có secret trong build log/image history, upload và PDF chạy qua Supabase production, và rollback thử nghiệm thành công ở staging. Sau đó mới cân nhắc custom domain, Key Vault references toàn bộ, deployment slots/traffic swap và IaC.

## Thứ tự triển khai đề xuất

1. Làm trên staging hoặc một cặp Web App tạm trước; không thử migration đầu tiên trên production.
2. Sửa Dockerfile/requirements và đạt local container smoke test.
3. Chuẩn bị Supabase bucket/auth URLs/database backup.
4. Cấu hình managed identity + `AcrPull` và GitHub OIDC/environment.
5. Chạy pipeline bằng `workflow_dispatch` với signup/guest tắt.
6. Xác minh end-to-end, sau đó mới cho phép push `main` tự phát hành.

## Open questions

- Các resource `rg-p170-hieu`, `p170acr08140037`, `p170-api-08140037`, `p170-web-08140019` đã tồn tại và có thể tiếp tục dùng, hay kế hoạch triển khai cần tạo mới toàn bộ bằng IaC? Câu trả lời: Mới toàn bộ
- Nhánh phát hành chính sẽ là `main` hay nhánh hiện tại `Hieu-01154`? Khuyến nghị chỉ production từ `main`, còn nhánh khác deploy staging thủ công. Câu trả lời: Nhánh `main`
- Production có thật sự mở guest/signup không? Khuyến nghị giữ cả hai `false` ở lần đầu vì workflow hiện tại đang mặc định `true`, trái với `.env.example` và làm tăng phạm vi storage/auth cần bảo vệ. Câu trả lời: Có mở guest/signup

## Tài liệu tham chiếu

- [Azure App Service: Configure a custom container](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container)
- [Azure App Service: Deploy with GitHub Actions](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions)
- [GitHub: Configure OIDC in Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure)
- [Next.js: Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js: Standalone output](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output)
