# Triển khai Azure và CI/CD

## Tổng quan

Dự án được triển khai lên Azure theo mô hình container. Backend và frontend được build thành Docker image riêng, push lên Azure Container Registry, sau đó Azure App Service sẽ pull image tương ứng để chạy ứng dụng.

CI/CD được cấu hình bằng GitHub Actions trên nhánh `main`. Khi có code mới được push lên `main`, workflow sẽ tự động build lại image backend/frontend, push image mới lên Azure Container Registry, cập nhật Azure Web App và restart ứng dụng.

## Azure services đang sử dụng

- Resource Group: `rg-p170-hieu`
- App Service Plan: `asp-p170-hieu`
- Azure Container Registry: `p170acr08140037`
- Backend Web App: `p170-api-08140037`
- Profiling Worker Web App: cấu hình qua repository variable `AZURE_PROFILING_WORKER_APP`
- Frontend Web App: `p170-web-08140019`

## Endpoint truy cập

- Frontend: `https://p170-web-08140019.azurewebsites.net`
- Backend: `https://p170-api-08140037.azurewebsites.net`
- Backend health check: `https://p170-api-08140037.azurewebsites.net/health`

Frontend gọi backend thông qua:

```text
https://p170-api-08140037.azurewebsites.net/api/v1
```

## Docker image

Backend image:

```text
p170acr08140037.azurecr.io/backend:<tag>
```

Frontend image:

```text
p170acr08140037.azurecr.io/frontend:<tag>
```

Trong CI/CD, mỗi lần chạy workflow sẽ tạo image với tag là commit SHA hiện tại. Ngoài ra workflow cũng push thêm tag `latest` để dễ kiểm tra thủ công.

Ví dụ:

```text
p170acr08140037.azurecr.io/backend:<GITHUB_SHA>
p170acr08140037.azurecr.io/frontend:<GITHUB_SHA>
```

## File deploy trong repo

- `Dockerfile.backend.azure`: Dockerfile dùng để build backend image.
- `Dockerfile.frontend.azure`: Dockerfile dùng để build frontend image.
- `requirements.azure.txt`: danh sách thư viện Python runtime cho backend khi deploy.
- `.github/workflows/azure-container-deploy.yml`: workflow CI/CD deploy lên Azure.

## Cấu hình backend trên Azure

Backend chạy bằng Azure App Service for Containers.

Cấu hình chính:

- App Service: `p170-api-08140037`
- Image: `p170acr08140037.azurecr.io/backend:<GITHUB_SHA>`
- Port nội bộ: `8000`
- App setting:

```text
WEBSITES_PORT=8000
```

Backend được chạy bằng Uvicorn:

```text
python -m uvicorn src.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Profiling worker dùng cùng backend image nhưng là process role riêng:

```text
PYTHONPATH=/app/backend
python -m src.workers.profiling_worker --health-port 8000
```

Worker không phục vụ API nghiệp vụ. Cổng health chỉ dùng cho readiness của App
Service. `PROFILING_WORKER_CONCURRENCY` mặc định là `1`; PostgreSQL lưu queue,
lease và trạng thái nên deployment/restart không làm mất job.

## Cấu hình frontend trên Azure

Frontend chạy bằng Azure App Service for Containers.

Cấu hình chính:

- App Service: `p170-web-08140019`
- Image: `p170acr08140037.azurecr.io/frontend:<GITHUB_SHA>`
- Port nội bộ: `8080`
- App settings:

```text
WEBSITES_PORT=8080
PORT=8080
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://p170-api-08140037.azurewebsites.net/api/v1
NEXT_PUBLIC_SITE_URL=https://p170-web-08140019.azurewebsites.net
```

Frontend được chạy bằng Next.js:

```text
pnpm start -p 8080
```

## CI/CD bằng GitHub Actions

Workflow CI/CD nằm tại:

```text
.github/workflows/azure-container-deploy.yml
```

Workflow chạy khi:

- Có push mới vào branch `main`.
- Hoặc chạy thủ công bằng `workflow_dispatch` trong tab Actions của GitHub.

Runner đang dùng:

```yaml
runs-on: self-hosted
```

Self-hosted runners là runner dùng chung của BTC. Khi nhiều team cùng chạy workflow, các job sẽ được đưa vào hàng đợi và xử lý theo thứ tự.

## Cách CI/CD 

Khi push code lên `main`, workflow sẽ thực hiện các bước sau:

1. Checkout source code từ repo.
2. Đăng nhập Azure bằng OIDC.
3. Đăng nhập Azure Container Registry.
4. Build backend Docker image từ `Dockerfile.backend.azure`.
5. Push backend image lên ACR.
6. Build frontend Docker image từ `Dockerfile.frontend.azure`.
7. Push frontend image lên ACR.
8. Cập nhật backend Azure Web App sang backend image mới.
9. Cập nhật frontend Azure Web App sang frontend image mới.
10. Restart backend và frontend Web App.

Sau khi workflow chạy thành công, URL frontend và backend vẫn giữ nguyên. Azure chỉ đổi image đang chạy phía sau.

## Azure OIDC

CI/CD sử dụng Azure OIDC để GitHub Actions đăng nhập Azure mà không cần lưu Azure password lâu dài.

Azure identity đã tạo:

```text
p170-github-actions-oidc
```

Identity này được dùng cho repo:

```text
AI20K-Build-Phase-Cohort-3/P-170
```

Và branch:

```text
main
```

GitHub Actions chỉ lấy token tạm thời khi workflow chạy từ đúng repo và đúng branch này.

## GitHub Secrets cần có

Repo GitHub cần các secrets sau:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Ý nghĩa:

- `AZURE_CLIENT_ID`: client ID của Azure identity dùng cho GitHub Actions.
- `AZURE_TENANT_ID`: tenant ID của Azure.
- `AZURE_SUBSCRIPTION_ID`: subscription ID của Azure.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase URL dùng khi build frontend.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key dùng khi build frontend.

## Cách deploy thật bằng CI/CD

Quy trình deploy chuẩn:

1. Merge hoặc push code mới vào branch `main`.
2. Vào GitHub repo.
3. Mở tab `Actions`.
4. Chọn workflow `Deploy Azure Containers`.
5. Theo dõi run mới nhất.
6. Khi workflow thành công, kiểm tra:

```text
https://p170-web-08140019.azurewebsites.net
https://p170-api-08140037.azurewebsites.net/health
```

Nếu cần chạy deploy thủ công mà không push code mới:

1. Vào tab `Actions`.
2. Chọn `Deploy Azure Containers`.
3. Bấm `Run workflow`.
4. Chọn branch `main`.
5. Bấm chạy.

## Lưu ý vận hành

- Không cần từng thành viên trong team tự setup CI/CD.
- Chỉ cần repo có workflow và secrets đúng.
- Thành viên có quyền push/merge vào `main` là có thể kích hoạt deploy.
- Không commit file `.env` lên GitHub.
- Khi thay đổi biến môi trường frontend dạng `NEXT_PUBLIC_*`, cần chạy lại workflow để frontend được build lại với giá trị mới.
- Khi thay đổi biến môi trường backend, nên cập nhật App Settings trên Azure Web App và restart backend.
