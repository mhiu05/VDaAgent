# 14g · Phát triển frontend

**Phụ thuộc:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [14c](14c-frontend-adapters.md), [16](16-configuration-and-deployment.md)

**Trạng thái:** Đã có (mock)

Các lệnh dưới đây chạy từ thư mục `frontend` bằng `npm`. Ví dụ dùng POSIX shell (macOS/Linux); lệnh PowerShell tương đương được ghi kèm khi cần đặt biến môi trường.

> Mẹo cho Windows PowerShell: nếu execution policy chặn shim `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

## Cài đặt và chạy local

[`package.json`](../../frontend/package.json) khai báo Node.js `>=24.0.0` và package manager `npm@11.6.2`. CI và `infra/docker/frontend.Dockerfile` cũng dùng Node 24 ([16](16-configuration-and-deployment.md)). Cài dependency theo lockfile của frontend:

```sh
cd frontend
npm ci
npm run dev
```

Mở URL do Vite in ra; cổng mặc định thường là `http://127.0.0.1:5173`. Để cố định cổng và báo lỗi nếu cổng đang bận:

```sh
npm run dev -- --port 5173 --strictPort
```

Mock frontend chạy độc lập với backend. Nếu `VITE_SERVICE_MODE` là `api` hoặc `hybrid` mà chưa đăng ký factory, ứng dụng sẽ báo lỗi cấu hình. Chạy mock một cách tường minh:

```sh
VITE_SERVICE_MODE=mock npm run dev
```

```powershell
$env:VITE_SERVICE_MODE = 'mock'; npm run dev
```

## Chạy với API

**Trạng thái:** Đã có (API) cho mọi port trừ chat, chat vẫn là mock tới khi có adapter (S12b).

- `VITE_SERVICE_MODE=hybrid` chọn các API adapter trong [`src/adapters/api/`](../../frontend/src/adapters/api/) cho auth, preferences, notifications, reports, dashboard, admin users, agent chat, agent builder và admin console; service nào chưa có adapter vẫn dùng mock.
- `npm run dev` proxy `/api` tới `VITE_API_PROXY` (mặc định `http://127.0.0.1:8010`, cổng `make up` local). `VITE_API_BASE` thêm tiền tố cho mọi request khi API ở origin khác.
- Image `frontend` của compose được build với `VITE_SERVICE_MODE` (mặc định `hybrid`) và truy cập qua proxy Caddy (do `make up` khởi động, cổng 8080), để SPA và `/api` chung một origin và cookie `contoso_session`.
- Đăng nhập bằng username thật (đặt `DEMO_PASSWORD` trong `.env` thì `make up` tạo `alice` và `bob`); form đăng nhập hỏi tên đăng nhập, tài khoản mock thì gõ email vào đó.

## Tài khoản demo

| Vai trò | Email | Mật khẩu mẫu |
| --- | --- | --- |
| `USER` | `user@vdaagent.test` | `DemoUser!2026` |
| `ADMIN` | nút truy cập nhanh | Không có mật khẩu trong bundle frontend |

Thông tin tài khoản USER cố định trong [`mocks/auth/fixtures.ts`](../../frontend/src/mocks/auth/fixtures.ts). Nút quản trị mock mô phỏng lối vào demo phía server và không chứa mật khẩu đặc quyền. Session mock tồn tại tám giờ và được lưu trong sessionStorage. Với API thật, đặt `DEMO_MODE=true` và `DEMO_ADMIN_PASSWORD` trong môi trường backend riêng tư, rồi chạy `make seed-demo`. Nút demo quản trị tạo session cookie thông thường cho tài khoản riêng `admin-demo`.

## Build và preview

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Build chạy TypeScript check rồi Vite, tạo `frontend/dist`. Preview phục vụ bản đã build để kiểm tra production bundle tại `http://127.0.0.1:4173`. Triển khai SPA cần history fallback về `index.html` để refresh/deep link như `/reports/R010` hoạt động.

## Script kiểm tra

| Lệnh | Phạm vi hiện tại |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint, không chấp nhận warning. |
| `npm test` | Vitest TS/TSX trong `src` và `tests`, môi trường jsdom. |
| `npm run test:watch` | Vitest watch. |
| `npm run test:domain` | Chỉ các suite legacy `.test.mjs` theo feature; test TS/TSX chạy qua `npm test`. |
| `npm run test:browser` | Các file `tests/**/*.spec.ts` qua Playwright. |
| `npm run build` | Typecheck và production build. |

[`vite.config.ts`](../../frontend/vite.config.ts) chứa cấu hình Vitest chính; [`vitest.legacy.config.ts`](../../frontend/vitest.legacy.config.ts) thêm glob `.test.mjs`. Các `.test.ts` trong `tests` là Vitest; các `.spec.ts` là Playwright. Không suy ra một nhóm test đã chạy chỉ từ tên thư mục.

Chạy nhóm phù hợp với thay đổi, ví dụ:

```sh
npm test -- src/features/chat/tests/riverside-fleet.test.ts
npm test -- src/features/reports/tests/schema.test.ts
npm run test:browser -- tests/riverside.spec.ts tests/reports-viewer.spec.ts
```

Các lệnh này là hướng dẫn sử dụng, không phải bản ghi mọi suite đã pass trên môi trường hiện tại.

## Browser và server cho Playwright

[`playwright.config.ts`](../../frontend/playwright.config.ts) chạy tuần tự với một worker. Đường dẫn Chrome mặc định dành riêng cho Windows: `C:/Program Files/Google/Chrome/Application/chrome.exe`. Trên macOS/Linux, hoặc khi Chrome ở nơi khác, đặt `CHROME_PATH` tới executable thực tế:

```sh
# macOS
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
# Linux
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
```

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'; npm run test:browser
```

Nếu không đặt `WORKSPACE_BASE_URL`, Playwright chạy Vite riêng trên cổng 5179 với `--strictPort` và không dùng lại server sẵn có. Nếu đặt URL, test dùng server đó và không tự khởi động server:

```sh
WORKSPACE_BASE_URL=http://127.0.0.1:4173 npm run test:browser -- tests/report-schema.spec.ts
```

```powershell
$env:WORKSPACE_BASE_URL = 'http://127.0.0.1:4173'; npm run test:browser -- tests/report-schema.spec.ts
```

Server preview phải đang chạy ở terminal khác trước lệnh này. Screenshot khi lỗi và HTML reporter theo cấu hình Playwright; kiểm tra artifact test trước khi thêm vào Git.

## Mock scenario

[`mocks/core/scenarios.ts`](../../frontend/src/mocks/core/scenarios.ts) là danh sách được bootstrap chấp nhận. Scenario được đọc khi tạo mock services; khi đổi scenario cần điều hướng toàn trang/reload. Giá trị không hợp lệ trở về `success`. Từng feature áp dụng scenario theo implementation riêng, không phải mọi page đều có cùng hiệu ứng.

| Nhóm | Giá trị |
| --- | --- |
| Cơ bản | `success`, `loading`, `empty`, `error`, `offline`, `expired-session`, `storage-unavailable`. |
| Chat delivery | `demo-replay`, `duplicate-delivery`, `out-of-order`, `interrupted`, `unknown-ack`, `unsupported-capability`. |
| Dữ liệu dài/stress | `long-conversation`, `performance`. |
| Thành phần báo cáo | `report-no-chart`, `report-no-kpi`, `report-multiple-charts`, `report-partial`. |
| Schema và fallback báo cáo | `report-showcase`, `report-unknown-chart`, `report-invalid-chart`, `report-unknown-schema`, `report-unknown-type`, `report-empty-schema`, `report-large-table`. |

Ví dụ URL sau khi đã đăng nhập:

```text
/chat?scenario=demo-replay
/reports?scenario=report-no-chart&report=R001&version=R001-v2
/reports?scenario=report-showcase&report=R019&version=R019-v2
/reports?scenario=report-large-table&report=R019&version=R019-v2&view=detail
/chat?conversation=riverside-r010-group
/reports?report=R010&version=R010-v2&view=dashboard
```

Riverside có sẵn trong scenario mặc định `success`, không có URL scenario tên `riverside`. Các mã `S01`, `S08`, `S18` trong `mocks/reports/scenarios.ts` là factory fixture cho test; chúng không phải giá trị hợp lệ của query `scenario`.

Chat được lưu theo principal trong IndexedDB và không tách theo query `scenario`. Khi cần demo sạch, dùng reset trong `/setting` hoặc browser context mới của test. Xem [14a](14a-frontend-architecture.md) để biết chính xác phạm vi reset/lưu trữ.

## Evidence và profiling bổ sung

Repo còn có các script chạy trực tiếp bằng Node, ngoài `test:browser`:

| Script | Server mặc định | Đầu ra |
| --- | --- | --- |
| `scripts/dashboard-evidence.mjs` | `http://127.0.0.1:5186` | Ảnh và `measurements.json` trong `docs/plan/evidence/compact-dashboard/<stage>`. |
| `scripts/dashboard-profile.mjs` | `http://127.0.0.1:4186` | `performance.json` và trace khi script ghi nhận, cùng thư mục theo stage. |
| `src/features/reports/tests/browser-workspace.mjs` | `http://127.0.0.1:5173` | Evidence trong `docs/implementation/frontend/workspace-artifacts`. |
| `src/features/reports/tests/browser-profile.mjs` | `http://127.0.0.1:4173` | `production-profile.json` trong thư mục workspace-artifacts. |

Các script trên yêu cầu server chạy sẵn; `WORKSPACE_BASE_URL` thay URL mặc định. Hai script `browser-*.mjs` yêu cầu đặt `CHROME_PATH`. Hai script dashboard nhận đối số stage, mặc định `after`.

Ví dụ khi preview đã chạy cổng 4173, từ thư mục `frontend`:

```sh
WORKSPACE_BASE_URL=http://127.0.0.1:4173 \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node scripts/dashboard-profile.mjs after
```

```powershell
$env:WORKSPACE_BASE_URL = 'http://127.0.0.1:4173'
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/dashboard-profile.mjs after
```

Các thư mục đầu ra có thể được tạo khi chạy; chúng không phải tài liệu tham chiếu bắt buộc phải tồn tại sẵn. Ghi lại môi trường, command, output và giới hạn phép đo khi báo cáo kết quả. Không dùng số đo từ lần chạy cũ để khẳng định hiệu năng sau thay đổi mới.

## Lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Lỗi startup service | `VITE_SERVICE_MODE` và factory đã truyền ở `main.tsx`. |
| Scenario không thay đổi | Reload sau khi đổi query; kiểm tra giá trị trong `scenarios.ts` và dữ liệu chat đã lưu. |
| Test browser không mở được Chrome | `CHROME_PATH` phải trỏ tới executable tồn tại (mặc định là đường dẫn Windows). |
| Cổng 5173 đang bận | Dùng đúng server đã chạy hoặc đặt `WORKSPACE_BASE_URL` tới server khác. |
| Gọi preview nhưng chưa có ứng dụng | Chạy build trước; preview không biên dịch source đang sửa. |
| Reload route sâu bị 404 khi hosting | Cấu hình SPA history fallback tại hosting. |
| Storage degraded, draft cần đính kèm lại | Kiểm tra quyền storage; attachment byte không được lưu lâu dài. |
