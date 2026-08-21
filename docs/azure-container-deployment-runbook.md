# Runbook triển khai Azure Container

Workflow [azure-container-deploy.yml](../.github/workflows/azure-container-deploy.yml) là đường phát hành production duy nhất. Workflow triển khai image bất biến `backend:<git-sha>` và `frontend:<git-sha>`; App Service tuyệt đối không được trỏ tới tag `latest`.

## 1. Tạo và kết nối tài nguyên Azure một lần

Chạy các lệnh sau trong phiên Azure CLI đã đăng nhập, sau khi chọn tên tài nguyên không trùng lặp. App Service plan phải là Linux và hỗ trợ Always On cho production.

```bash
# 1. Tạo Resource Group
az group create \
  --name p170-prod-rg \
  --location southeastasia

# 2. Tạo Azure Container Registry (ACR)
az acr create \
  --resource-group p170-prod-rg \
  --name p170prodacr \
  --sku Basic

# 3. Tạo Linux App Service Plan
az appservice plan create \
  --resource-group p170-prod-rg \
  --name p170-prod-plan \
  --is-linux \
  --sku B1

# 4. Tạo Backend Web App
az webapp create \
  --resource-group p170-prod-rg \
  --plan p170-prod-plan \
  --name p170-prod-backend \
  --deployment-container-image-name mcr.microsoft.com/hello-world

# 5. Tạo Frontend Web App
az webapp create \
  --resource-group p170-prod-rg \
  --plan p170-prod-plan \
  --name p170-prod-frontend \
  --deployment-container-image-name mcr.microsoft.com/hello-world
```

Cấp system-assigned managed identity cho mỗi Web App và chỉ cấp vai trò `AcrPull` trên đúng ACR này. Không bật ACR admin credentials.

```bash
for app in <backend-app> <frontend-app>; do
  principal_id="$(az webapp identity assign --resource-group <resource-group> --name "$app" --query principalId --output tsv)"
  az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type ServicePrincipal --role AcrPull --scope "$(az acr show --resource-group <resource-group> --name <acr-name> --query id --output tsv)"
  az webapp config set --resource-group <resource-group> --name "$app" --generic-configurations '{"acrUseManagedIdentityCreds": true}'
done
```

Tạo Azure Entra application/service principal có GitHub federated credential giới hạn cho repository này, nhánh `main` và environment `production`. Identity đó chỉ cần quyền push vào ACR, cập nhật và đọc trạng thái hai Web App. Lưu client ID, tenant ID và subscription ID vào GitHub Environment secrets.

## 2. Cấu hình GitHub Environment `production`

Tạo GitHub Environment được bảo vệ tên `production` (khuyến nghị yêu cầu phê duyệt). Thêm các Environment variables:

```text
AZURE_RESOURCE_GROUP
AZURE_ACR_NAME
AZURE_ACR_LOGIN_SERVER
AZURE_BACKEND_APP
AZURE_FRONTEND_APP
AZURE_BACKEND_URL
AZURE_FRONTEND_URL
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
AUTH_ALLOW_SIGNUP=true
AUTH_ALLOW_GUEST=true
```

`AZURE_BACKEND_URL` và `AZURE_FRONTEND_URL` là HTTPS origin không có dấu `/` ở cuối. Hai cờ auth được đặt `true` theo quyết định phát hành hiện tại; chỉ thay đổi chúng cùng lúc sau khi đã rà soát lại policy auth/storage.

Thêm các Environment secrets:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
DATABASE_URL
DATABASE_MIGRATION_URL
DATABASE_CHECKPOINTER_URL
SUPABASE_SECRET_KEY
LLM_API_KEY
```

Chỉ để trống `DATABASE_MIGRATION_URL` khi `DATABASE_URL` an toàn để chạy DDL. `DATABASE_CHECKPOINTER_URL` là tùy chọn. Workflow không truyền secret qua Docker build arg và không ghi `.env` lên Azure.

## 3. Chuẩn bị Supabase trước lần phát hành đầu tiên

1. Tạo bucket private `p170-dataset` và cấu hình các storage policy cần thiết.
2. Đặt Supabase Auth Site URL bằng `AZURE_FRONTEND_URL` và thêm URL này vào redirect URLs.
3. Kiểm tra DSN production, tạo backup/restore point, và xác minh network từ backend có thể phân giải Supabase JWKS.
4. Chạy workflow thủ công một lần từ `main`; workflow chạy `alembic upgrade head` trước khi đổi backend image.

## 4. Kiểm tra, rollback và hoàn tất phát hành

Nếu `/health` (backend) hoặc `/login` (frontend) không healthy, workflow sẽ thất bại và khôi phục image trước đó. Workflow không rollback database: migration phải tương thích ngược theo chiến lược expand/contract cho đến khi backend SHA cũ không còn là mục tiêu rollback.

Sau workflow xanh, kiểm tra trong trình duyệt: đăng nhập Supabase và provisioning workspace, upload, Profile Run/review, Explorer preview/promote, Agent, report snapshot, xuất PDF và credentialed CORS. Ghi lại SHA đang chạy của mỗi Web App trước khi xác nhận hoàn tất release. Hãy thử rollback chỉ-image trên staging trước lần phát hành production đầu tiên.
