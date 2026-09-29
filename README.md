# VDaAgent

VDaAgent là workspace phân tích tồn kho bất động sản. Người dùng nhập dữ liệu CSV, chọn phạm vi và ngày dữ liệu, đặt câu hỏi, rồi xem kết quả tính toán, bằng chứng và báo cáo trong cùng một giao diện. Các công thức `mvp-inventory-v0.1` là **giả định MVP**, chưa phải chuẩn nghiệp vụ đã được xác nhận.

## Khả năng hiện có

- Đăng nhập qua Supabase Auth; phân quyền theo tổ chức với vai trò `owner`, `analyst`, `viewer`.
- Nhập snapshot tồn kho CSV; phân tích chỉ dùng dữ liệu thuộc tổ chức và được chốt tại thời điểm tạo run.
- Hội thoại trong workspace, chạy nhóm agent phân tích, xem tiến độ, bằng chứng, báo cáo và xuất JSON/CSV.
- Tạo định nghĩa báo cáo định kỳ; worker xử lý lịch và run đã xếp hàng.

## Hệ thống hoạt động thế nào

```mermaid
flowchart LR
  U[Người dùng] --> W[Next.js workspace]
  W --> API[/api]
  API --> DB[(Supabase PostgreSQL)]
  DB --> WK[Worker]
  WK --> AG[Agent workflow]
  AG --> DB
  API --> ST[Supabase Storage]
  API --> W
```

API tạo hội thoại/run và đọc trạng thái. Worker nhận run từ PostgreSQL, thực thi các stage agent và lưu artifact; UI đọc lại kết quả qua API và event stream. Chat ngắn có thể chạy trực tiếp trong API tùy loại yêu cầu và cờ cấu hình.

## Cấu trúc repo

| Đường dẫn                                                               | Vai trò                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/frontend`                                                          | Next.js UI và API route                                    |
| `src/backend/worker`                                                    | Worker cho run, agent turn và lịch                         |
| `src/contracts`, `src/backend/{agents,config,database,domain,semantic}` | Contracts, domain, tính toán, agents, repository và config |
| `src/backend/supabase`                                                  | Migration, seed và chính sách dữ liệu                      |
| `scripts`, `tests`                                                      | Công cụ phát triển và bộ kiểm thử ở root                   |
| `docs`                                                                  | Tài liệu sản phẩm và kỹ thuật                              |

## Chạy local

Cần Node.js 24+, pnpm 11.0.8 và Docker hoặc container runtime tương thích; Supabase CLI được cài qua workspace. Tạo `.env` từ `.env.example`, điền cấu hình Supabase và provider cho **web lẫn worker**; không đưa secret vào Git.

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
pnpm dev
```

`pnpm dev:web` chỉ chạy Next.js; `pnpm dev:worker` chỉ chạy worker. Chỉ chạy một worker cho
cùng cơ sở dữ liệu local. Worker chạy ổn định trong một phiên; sau khi sửa code backend, hãy khởi
động lại worker khi không có lượt phân tích đang chạy để tránh tiêu hao lượt khôi phục do watch
restart. `pnpm db:start` và
`pnpm db:reset` gọi Supabase từ `src/backend`. Sau khi Supabase local đã chạy và migration
đã được áp dụng, `pnpm test:db` chạy pgTAP ở root `tests/db`. `pnpm test:e2e` và
`pnpm test:e2e:durable` tự build web riêng, mở web/worker với provider giả lập và dừng
chúng sau khi kiểm tra. Runner lấy DB và API từ Supabase local, từ chối URL từ xa.

Chạy `pnpm llm:check` để kiểm tra riêng Gemini và OpenAI bằng đúng adapter Insight và
cấu hình `.env` của worker. Lệnh gửi một yêu cầu với dữ liệu kiểm tra giả lập cho mỗi
provider, không truy cập database hoặc tạo báo cáo. Kết quả chỉ chứa tên provider,
model, trạng thái và mã lỗi an toàn; không in khóa hoặc nội dung phản hồi lỗi.
Exit code là `1` nếu có provider thất bại. `invalid_credentials` nghĩa là API báo khóa
không hợp lệ; `unsupported_credentials` nghĩa là Gemini từ chối loại thông tin xác thực.
Sau khi cập nhật cấu hình, chạy lại lệnh này và khởi động lại web/worker để dùng giá trị mới.

Repo dùng một pnpm workspace và một `pnpm-lock.yaml` ở root. Dependency của ứng dụng web nằm
trong `src/frontend/package.json`; công cụ Supabase, Playwright và dữ liệu mock nằm trong
`package.json` ở root. pnpm dùng virtual store chung `node_modules/.pnpm` ở root và tạo
liên kết `node_modules` theo từng workspace để Node phân giải đúng dependency. Turbo dùng cache
ở root `.turbo/cache`;
`.next` của Next.js nằm trong `src/frontend`.

Mở `http://localhost:3000`. Cấu hình local có thể bật `DEVELOPMENT_ROLE_BYPASS`; production dùng Supabase Auth và không cho phép cờ này. Xem [kiến trúc tổng quan](ARCHITECTURE.md) và [lộ trình đọc tài liệu](docs/README.md).
