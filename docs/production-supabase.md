# Production setup: Azure + Supabase

Tài liệu này là checklist triển khai production cho P-170. Mô hình khuyến nghị
là frontend Next.js và API/worker trên Azure App Service, còn Supabase giữ Auth,
PostgreSQL và Storage.

## 1. Cấu hình Supabase Dashboard

Trong Supabase project đang dùng (`https://zuorlwuxxgmjwvwqrizm.supabase.co`):

### Auth > Providers > Email

- Bật **Email**.
- Bật **Confirm email** nếu production giữ `AUTH_REQUIRE_EMAIL_CONFIRMED=true`.
- Cấu hình SMTP riêng (SendGrid, Resend hoặc SES) thay vì SMTP mặc định để tránh
  giới hạn gửi email khi có người dùng thật.
- Email confirmation template phải dùng `{{ .ConfirmationURL }}`.

### Auth > URL Configuration

Đặt:

```text
Site URL:
https://p170-web-08140019.azurewebsites.net

Redirect URLs:
https://p170-web-08140019.azurewebsites.net/auth/callback
https://p170-web-08140019.azurewebsites.net/account/update-password
http://localhost:3000/auth/callback
http://localhost:3000/account/update-password
```

Chỉ thêm callback local khi đang test local; không thêm wildcard cho domain
production. Ứng dụng hiện không có route `/auth/confirm`; chỉ cần thêm route đó
nếu sau này triển khai custom token-hash confirmation flow riêng.

### Auth > Settings (session)

- Giữ JWT expiry khoảng 1 giờ (3600 giây) để cân bằng an toàn và trải nghiệm.
- Bật refresh-token rotation và không tắt reuse detection. Ứng dụng chỉ nên có
  một Supabase browser client singleton; tránh tự lưu hoặc tự refresh token ở
  nhiều nơi.
- Khi đổi redirect URL, email template hoặc session policy, đăng xuất các tab
  đang mở rồi kiểm tra lại một phiên đăng nhập mới.

### Storage

Nếu dùng Supabase Storage, tạo bucket private:

```text
Bucket: p170-dataset
Public: false
```

Đặt repository variable `STORAGE_PROVIDER=supabase`. Backend dùng
`SUPABASE_SECRET_KEY`; key này chỉ được đặt trong Azure App Settings/GitHub
Secrets, tuyệt đối không đưa vào `NEXT_PUBLIC_*`.

## 2. GitHub Actions secrets và variables

Workflow `.github/workflows/azure-container-deploy.yml` sẽ dừng trước khi build
nếu thiếu các giá trị bắt buộc.

### Secrets

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
ACR_PULL_USERNAME
ACR_PULL_PASSWORD
DATABASE_URL
DATABASE_MIGRATION_URL                 # khuyến nghị: session/direct pooler
DATABASE_CHECKPOINTER_URL              # nếu khác DATABASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY                    # backend-only key
DATASOURCE_ENCRYPTION_KEY              # Fernet key, bắt buộc production
LLM_API_KEY
```

Sinh `DATASOURCE_ENCRYPTION_KEY` một lần và lưu cố định:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Không tạo lại khóa này sau khi đã lưu connector credentials; đổi khóa sẽ làm
credential cũ không giải mã được.

### Variables

```text
AZURE_PROFILING_WORKER_APP
STORAGE_PROVIDER=supabase
GUEST_STORAGE_PROVIDER=supabase
NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true
NEXT_PUBLIC_AUTH_ALLOW_GUEST=false       # bật true chỉ khi thật sự cần trial
LANGSMITH_TRACING=false
```

`SUPABASE_AUTH_ISSUER` được workflow suy ra an toàn từ
`NEXT_PUBLIC_SUPABASE_URL` thành `<url>/auth/v1`, còn audience cố định là
`authenticated`.

## 3. Database connection nên dùng

- `DATABASE_URL`: transaction pooler (thường port `6543`) cho API và worker để
  không cạn connection khi scale.
- `DATABASE_MIGRATION_URL`: direct/session connection (thường port `5432`) cho
  Alembic migration.
- Bật SSL (`sslmode=require`) và không dùng database password trong frontend.

Sau khi tạo secrets, chạy workflow từ branch `main`. Frontend Supabase URL/key
là build-time values nên thay đổi chúng luôn cần build image frontend mới.

## 4. Smoke test sau deploy

```bash
curl -fsS https://p170-api-08140037.azurewebsites.net/health
```

Kiểm tra tiếp:

1. Mở frontend production ở tab ẩn danh.
2. Đăng ký bằng email thật, mở link confirmation và quay lại `/auth/callback`.
3. Đăng nhập lại trong một tab duy nhất.
4. Kiểm tra DevTools: request `POST /token` của Supabase phải `200`, sau đó
   `GET /api/v1/workspace-bootstrap` phải `200`.
5. Nếu `/token` là `200` nhưng bootstrap là `401`, xem Azure Log Stream của API:
   issuer phải là `https://zuorlwuxxgmjwvwqrizm.supabase.co/auth/v1` và audience
   phải là `authenticated`.

Supabase password login thành công không đồng nghĩa frontend đã bootstrap được
workspace; cả hai bước đều phải pass. Refresh token là one-time-use, vì vậy
không nên mở nhiều tab cũ trong lúc kiểm tra.

## 5. Bảo mật vận hành

- Chỉ publishable key xuất hiện trong browser bundle.
- Secret/service-role key, database URL, OAuth secret và Fernet key chỉ nằm ở
  GitHub Secrets hoặc Azure App Settings.
- Giữ bucket private và kiểm tra RLS/policy trước khi mở truy cập trực tiếp từ
  client.
- Bật Azure App Service **Always On** cho API và profiling worker; giữ worker
  concurrency thấp (mặc định `1`) nếu chưa đo tải thực tế.
