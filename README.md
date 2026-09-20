# VDaAgent MVP

Không gian phân tích tồn kho bất động sản theo chuỗi `Data → Analysis → Evidence → Insight → Report`.

VDaAgent chỉ chạy với Supabase: PostgreSQL, Auth và Storage. Không có SQLite, demo authentication
hoặc local-file runtime.

## Chạy local

Cần Node.js 24+, pnpm 11.0.8, Supabase CLI và Docker Desktop (hoặc một container runtime tương
thích Docker API). Khởi tạo Supabase local, sau đó tạo `.env` từ `.env.example`; điền URL, publishable
key, secret key và `SUPABASE_DB_URL` của local stack. Không commit hoặc in các giá trị này.

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
pnpm dev
```

Mở <http://localhost:3000> và đăng nhập bằng Supabase Auth. Web và worker cùng dùng
`SUPABASE_DB_URL`; Gemini là provider chính và OpenAI là fallback. Seed local tạo dữ liệu synthetic
và tài khoản chỉ phục vụ test local.

- [Cấu hình Supabase và local setup](docs/26_Infrastructure_And_Deployment/Local_Setup.md)
- [Yêu cầu MVP và nơi kiểm chứng](docs/REQUIREMENT_TRACEABILITY.md)
- [Bằng chứng validation](docs/23_Testing/MVP_Validation.md)
- [Các input chỉ cần khi bật tích hợp](docs/LOCAL_CONFIGURATION.md)

Mọi công thức thuộc `mvp-inventory-v0.1` là **Assumption / MVP provisional**, chưa phải business truth. Không có remote deployment hoặc external report delivery.
