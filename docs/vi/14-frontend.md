# 14 · Frontend

App trên trình duyệt: chat với đội agent, builder, các trang workspace (dashboard nghiệp vụ, báo cáo, thông báo người dùng (user notification), cài đặt) và các trang admin. **Phụ thuộc:** [08](08-communication.md), [05](05-agent-builder.md), [13](13-observability.md), [15](15-api.md), [19](19-reports-dashboard-notifications.md).

**Giao diện** (token, component, kiểu chữ, icon, chuyển động, biểu đồ) lấy từ frontend đã xây trong [`frontend/`](../../frontend). **Hành vi** (route, luồng, bố cục chat, builder, admin, realtime) theo spec này ([quyết định 0022](decisions/0022-ui-from-refactor-ux-from-spec.md)). Chỗ nào frontend đã xây còn hành xử khác, [Hiện trạng so với mục tiêu](#hiện-trạng-so-với-mục-tiêu) liệt kê khoảng cách.

**Nhãn trạng thái.** Mỗi tính năng thuộc một trong các nhãn:

| Nhãn | Ý nghĩa |
|---|---|
| Đã có (mock) | Đã xây và kiểm thử trên trình duyệt với các service mock trong bộ nhớ. |
| Đã có (API) | Đã xây và nối với API thật qua một adapter ([14c](14c-frontend-adapters.md)). |
| Dự kiến | Đã đặc tả ở đây; chưa xây. |

## Tài liệu con

| Tài liệu | Nội dung |
|---|---|
| [14a-frontend-architecture.md](14a-frontend-architecture.md) | Bố cục source, đăng ký feature, provider, quyền sở hữu state, lưu trữ, hệ thống giao diện và chuyển động |
| [14b-frontend-pages.md](14b-frontend-pages.md) | Mọi route như đang xây hôm nay: quy tắc truy cập, hành vi, query parameter |
| [14c-frontend-adapters.md](14c-frontend-adapters.md) | Service port, chế độ runtime (`mock`/`api`/`hybrid`), ánh xạ dữ liệu, cách adapter ánh xạ lên API |
| [14d-frontend-chat-mock.md](14d-frontend-chat-mock.md) | Chat mock hiện tại ("Agent Fleet") và mock scenario Riverside |
| [14e-report-viewer.md](14e-report-viewer.md) | Kho báo cáo và viewer: phiên bản báo cáo, lịch sử, focus, tải về |
| [14f-report-schema.md](14f-report-schema.md) | Schema báo cáo v1, decoder, block, chart registry |
| [14g-frontend-development.md](14g-frontend-development.md) | Cài đặt, chạy, tài khoản demo, mock scenario, lệnh kiểm thử |

## Stack

**Trạng thái:** Đã có (mock).

- React 19 + TypeScript + Vite; React Router; i18next cho tiếng Việt và tiếng Anh. Phiên bản chính xác được khoá trong [`frontend/package.json`](../../frontend/package.json) và `frontend/package-lock.json`.
- CSS thuần với design token ([`shared/styles/tokens.css`](../../frontend/src/shared/styles/tokens.css)); primitive Radix cho overlay; component dùng chung trong [`shared/ui`](../../frontend/src/shared/ui).
- Biểu đồ do renderer SVG riêng của app vẽ ([`shared/charts`](../../frontend/src/shared/charts), [14f](14f-report-schema.md)); chuyển động dùng GSAP qua `useAnalyticalMotion`.
- Không dùng thư viện query cache. Trang đọc dữ liệu qua service port của feature bằng `useServiceRead`, hook này huỷ các request cũ ([14a](14a-frontend-architecture.md)).
- **Dự kiến:** render Markdown cho tin nhắn agent và file Markdown, có bảng GFM và code tô màu cú pháp; dòng thời gian ảo hoá cho hội thoại dài. Thư viện sẽ được chọn khi chat được nối với API.
- **Phục vụ.** Frontend là một container riêng: `infra/docker/frontend.Dockerfile` build `dist/` và phục vụ bằng nginx, fallback về `index.html` cho route phía client. Một reverse proxy chuyển `/api` tới `api` ở cổng 8000 ([16](16-configuration-and-deployment.md)). **Dự kiến:** khi phát triển, Vite proxy `/api` tới `http://localhost:8000`.

## Thiết kế giao diện

**Trạng thái:** Đã có (mock).

- **Token.** `tokens.css` định nghĩa màu, kiểu chữ, khoảng cách, bo góc, độ nổi và chuyển động; `globals.css` áp dụng quy tắc theme, mật độ và focus. Theme gồm `light`, `dark` và `system` (theo `prefers-color-scheme`).
- **Chữ và icon.** Be Vietnam Pro (đóng gói qua `@fontsource`), icon Lucide, tài nguyên thương hiệu trong `frontend/public/icon`.
- **Mật độ và chuyển động.** Mật độ `comfortable`/`compact`; giảm chuyển động theo hệ điều hành hoặc tuỳ chọn trong app và bỏ qua mọi hiệu ứng hiện ra.
- **Avatar agent** là một emoji trên màu `avatar.color` của agent ([10](10-data-model.md#agents)); avatar của lead là ★. **Dự kiến:** bảng màu avatar mặc định được định nghĩa thành token để dùng được ở cả hai theme.

Chi tiết: [14a](14a-frontend-architecture.md#giao-diện-và-chuyển-động).

## Route

| Route | Vai trò | Màn hình | Trạng thái |
|---|---|---|---|
| `/login` | ẩn danh | desktop trước đăng nhập với cửa sổ đăng nhập ([19](19-reports-dashboard-notifications.md#desktop-trước-đăng-nhập)) | Đã có (mock) |
| `/chat/:threadId?` | người dùng | app chat ([bố cục](#bố-cục-app-chat-ba-khung)) | Dự kiến (mock tại `/chat?conversation=`) |
| `/` | người dùng | dashboard nghiệp vụ | Đã có (mock) |
| `/reports` | người dùng | kho báo cáo và viewer ([14e](14e-report-viewer.md)) | Đã có (mock) |
| `/reports/:id` | người dùng | deep link tương thích vào viewer | Đã có (mock) |
| `/notifications` | người dùng | hộp thư thông báo người dùng (user notification) | Đã có (mock) |
| `/setting` | người dùng | tuỳ chọn cá nhân | Đã có (mock) |
| `/agents` | người dùng | danh sách agent kèm trạng thái và "Tạo agent mới" | Đã có (API) |
| `/agents/new` | người dùng | hộp thoại tạo agent ([05](05-agent-builder.md)) | Đã có (API) |
| `/agents/:id/:tab` | người dùng | builder: `info`, `role`, `skills`, `libraries`, `routines`, `data`, `folder` | Đã có (API) |
| `/admin` | admin | trang tổng quan admin ([13](13-observability.md#chế-độ-xem-trace-dạng-chat)) | Đã có (API) |
| `/admin/users` | admin | quản lý người dùng ([12](12-auth-and-domains.md#quản-lý-người-dùng-trang-admin-người-dùng)) | Đã có (API); trang mock ở chế độ mock |
| `/admin/trace/:agentId` | admin | dòng thời gian trace dạng chat | Đã có (API) |
| `/admin/threads/:threadId` | admin | chế độ hội thoại | Đã có (API) |

- **Trang đích.** Sau khi đăng nhập, người dùng vào `/chat` (hội thoại trực tiếp với lead), còn admin vào `/admin`; chế độ mock giữ trang đích demo đã ghi nhận (`/` và `/admin/users`). Khách ẩn danh mở route được bảo vệ sẽ bị chuyển tới `/login`; người đã đăng nhập mở `/login` sẽ được chuyển tới trang đích của mình.
- **Sai vai trò.** Route của người dùng bị ẩn với admin, và route admin bị ẩn với người dùng. Mở một route như vậy hiện trạng thái "không có quyền" bên trong shell. Route guard chỉ định hình UI; `api` kiểm tra mọi request ([12](12-auth-and-domains.md#vai-trò-và-phân-quyền)).
- **Đường dẫn không tồn tại** hiện màn hình not-found.

## Shell

**Trạng thái:** Đã có (mock) cho điều hướng và bố cục; Đã có (API) cho nút đổi theme trên header và banner miền.

- **Điều hướng theo vai trò.** Người dùng: Chat, Dashboard (`/`), Báo cáo, Thông báo (kèm số chưa đọc), Agent, Cài đặt. Admin: Tổng quan, Người dùng. Thanh rail trên màn hình rộng, drawer trên màn hình hẹp.
- **Header.** Menu tài khoản (tên hiển thị, đăng xuất) và một **nút đổi theme** nhanh (sáng → tối → hệ thống), lưu cùng tuỳ chọn `theme` với `/setting` ([19](19-reports-dashboard-notifications.md#tùy-chọn-cá-nhân)).
- **Banner miền.** Khi miền của người dùng là `unavailable`, mọi trang người dùng hiện "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên" và ô soạn tin bị tắt ([12](12-auth-and-domains.md#kiểm-tra-khi-khởi-động)).
- **Khung trang.** Trang thông thường cuộn bên trong một page frame; chat dùng frame `viewport` để các khung của nó tự cuộn riêng.

## Bố cục app chat: ba khung

**Trạng thái:** Đã có (API) ở chế độ `hybrid`/`api`: [`AgentChatPage`](../../frontend/src/features/chat/pages/AgentChatPage.tsx) trên port `agent-chat` ([14c](14c-frontend-adapters.md#port-chat-mục-tiêu)), route `/chat` và `/chat/:threadId`. Chế độ mock giữ chat kịch bản của [14d](14d-frontend-chat-mock.md) ([bảng khoảng cách](#hiện-trạng-so-với-mục-tiêu)). Trạng thái miền không khả dụng của ô soạn tin lấy từ `Me.domain` (`Session.domain`), và lối tắt **Lịch** trong khung thông tin dẫn tới `/agents/:id/routines` kèm giờ chạy kế tiếp bên dưới. Mốc đã đọc được gửi khi hội thoại đang mở trong tab hiển thị và có tin mới hơn đã tải.

```text
┌──────────────┬───────────────────────────────────┬──────────────┐
│ 🔍 Tìm kiếm  │ ★ Điều phối  [Trưởng nhóm]   ⓘ  │   ★          │
│ ★ Điều phối📌│                                   │ Điều phối    │
│ D Data       │        [user bubble, right]       │ ● đang làm   │
│ I Insight    │ [agent bubble, left]              │ 📋 T42        │
│ C Chart      │ [report card R7-v1]               │ 📁 Thư mục    │
│ 👥 Nhóm Q3   │ [choices: PDF | Excel]            │ ⚙️ Tùy chỉnh  │
│ + Nhóm mới   │ [ Nhập tin nhắn…          📎 ➤ ]  │ ⏰ Lịch (2)   │
└──────────────┴───────────────────────────────────┴──────────────┘
```

### Khung trái: danh sách chat
- **Tìm liên hệ** lọc danh sách theo tên; không tìm trong nội dung tin nhắn.
- **Lead** được ghim đầu tiên. Sau đó là các hội thoại trực tiếp và nhóm, xếp theo `last_message_at`. Mỗi dòng có avatar, tên, xem trước tin cuối (có tiền tố người gửi trong nhóm), thời gian, và huy hiệu chưa đọc (các tin sau `last_read_message_id`).
- **Hội thoại của agent đã xoá** bị làm mờ và chỉ đọc.
- **"Nhóm mới"** mở hộp thoại: tên nhóm, rồi chọn từ hai agent trở lên (lead là tuỳ chọn). Hộp thoại gọi `POST /api/threads`.

### Khung giữa: cuộc trò chuyện
- **Header:** avatar, tên, tag "Trưởng nhóm" cho lead, và **trạng thái** của agent lấy từ `agent.status`: "đang làm việc…", "đang chạy lịch <name>", "đang sắp xếp trí nhớ…" (compaction) hoặc không có gì khi rảnh. Agent im lặng là mặc định, nên trạng thái là thứ duy nhất người dùng thấy về công việc của nó; không có streaming token. Header của nhóm hiện avatar các thành viên và trạng thái từng người khi rê chuột.
- **Banner task** (chỉ ở hội thoại trực tiếp với lead): mô tả và thời gian đã chạy của task đang chạy, số task đang xếp hàng, và nút **Hủy** (`POST /api/tasks/{id}/cancel`, có xác nhận).
- **Tin nhắn:** tin của người dùng bên phải, tin của agent bên trái, dùng kiểu bong bóng của các component chat hiện có. Tin trong nhóm hiện avatar và tên người gửi. Tin hệ thống (vd vượt giới hạn context) nằm giữa và màu nhạt. Có vạch phân cách giữa các ngày.
  - Text được render thành Markdown (bảng GFM, code).
  - Tệp đính kèm: ảnh hiện ngay (bấm để xem cỡ đầy đủ); CSV hiện bảng xem trước 50 dòng với nút tải; file khác hiện dạng thẻ (biểu tượng, tên, dung lượng, tải về).
  - **Tham chiếu báo cáo** (`report_refs`, [19](19-reports-dashboard-notifications.md#trong-chat)) được render bằng thẻ tham chiếu báo cáo hiện có; thẻ đọc trạng thái báo cáo và mở phiên bản báo cáo đã lưu trong viewer. Đóng viewer thì quay lại tin nhắn ([14e](14e-report-viewer.md)).
  - Lựa chọn là các chip dưới bong bóng. Bấm một chip đăng trả lời với `choice_id`; khi tin đã có trả lời, các chip bị khoá và chip đã chọn được tô nổi.
- **Ô soạn tin:** textarea nhiều dòng (Enter để gửi, Shift+Enter xuống dòng), nút đính kèm (tối đa 10 file, mỗi file 20 MB, mọi loại) và nút gửi. Bị tắt khi hội thoại chỉ đọc hoặc miền không khả dụng. Không có mention và không có lệnh slash: trong nhóm, mọi thành viên nhận mọi tin nhắn ([08](08-communication.md#hội-thoại)).
- **Đã đọc và lịch sử:** `POST /api/threads/{id}/read` được gọi khi tin mới nhất hiện trên màn hình. Tin cũ hơn được tải khi cuộn lên (`before=`).

### Khung phải: thông tin (có thể ẩn)
- **Hội thoại với agent:** avatar lớn, tên, mô tả và trạng thái; task hiện tại (nếu đang tham gia); lối tắt tới **Thư mục** (`/agents/:id/folder`), **Tùy chỉnh** (`/agents/:id/role`) và **Lịch** (các lần chạy sắp tới).
- **Nhóm:** danh sách thành viên, kèm thêm/bớt (`PATCH /api/threads/{id}`) và đổi tên.

### Màn hình hẹp
Dưới 768 px, mỗi lúc chỉ hiện một khung (danh sách, rồi cuộc trò chuyện, rồi thông tin), có nút quay lại.

## Màn hình builder

**Trạng thái:** Đã có (API) trên port `agent-builder` ([14c](14c-frontend-adapters.md)); không có ở chế độ mock (feature chỉ đăng ký khi có port).

`/agents/:id/:tab` dùng cùng khung trái, nhưng hiện danh sách agent thay cho hội thoại. Khung chính có các tab ở phía trên ([05](05-agent-builder.md#các-tab)).
- **Kỹ năng:** lưới thẻ của kho (tiêu đề, mô tả, tag, "Đã cài"), có bộ lọc theo tag và tìm kiếm. Bấm thẻ mở phần xem trước với `SKILL.md` đã render, danh sách file, cảnh báo có code và nút cài. Dưới lưới: "Cài từ GitHub" (ô nhập URL) và "Kỹ năng hiện có" (mọi mục trong `skills/*`, có nút gỡ).
- **Thư viện:** thẻ preset với nút "Áp dụng", rồi bảng package đã cài có nút gỡ, và ô nhập để thêm một package.
- **Lịch:** danh sách lịch chạy (tên, lịch bằng lời, lần chạy tới, bật/tắt), và hộp thoại soạn thảo gồm prompt, bộ chọn lịch và "Nâng cao" cho cron thô.
- **Dữ liệu:** các bộ credentials của miền dạng dòng bật/tắt, hiện mô tả và tên key.
- **Thư mục:** cây thư mục bên trái, file hoặc thư mục đang xem bên phải, breadcrumb, bộ chọn "Phiên bản" (lịch sử commit) cho `at=`, và nút tải file nén ([04](04-agent-folder.md#trình-xem-thư-mục)).
- **Tiến trình job:** khi một job của builder đang chạy, một toast tiến trình theo dõi các event `builder.job` của nó. Khi job lỗi, toast hiện output lỗi.

## Trang workspace

Các trang này mở rộng PoC. UI và hành vi của chúng là những gì đã xây ([14b](14b-frontend-pages.md)); backend của chúng là [19](19-reports-dashboard-notifications.md).

| Trang | Trạng thái | Hành vi | Backend |
|---|---|---|---|
| Dashboard nghiệp vụ `/` | Đã có (mock) | KPI tồn kho, tỷ trọng tồn kho chậm và giao dịch; biểu đồ tuổi tồn và xu hướng; mục cần chú ý; ưu tiên dự án; báo cáo gần đây; số task; panel inspect ([14b](14b-frontend-pages.md#dashboard-nghiệp-vụ--)) | dataset do agent `data` publish, tính trong trình duyệt ([19](19-reports-dashboard-notifications.md#dashboard-nghiệp-vụ)) |
| Báo cáo `/reports` | Đã có (mock) | Kho dạng thẻ có tìm kiếm, bộ lọc, sắp xếp, phân trang; hộp thoại viewer với tổng quan báo cáo, tài liệu, phiên bản báo cáo, bằng chứng và tải về ([14e](14e-report-viewer.md)) | báo cáo do agent publish ([19](19-reports-dashboard-notifications.md#kho-báo-cáo)) |
| Thông báo người dùng (user notification) `/notifications` | Đã có (mock) | Tab tất cả/chưa đọc, bộ lọc loại, nhóm theo ngày, panel chi tiết, đánh dấu đã đọc, mở đích ([14b](14b-frontend-pages.md)) | [19](19-reports-dashboard-notifications.md#thông-báo-người-dùng) |
| Cài đặt `/setting` | Đã có (mock) | Tên hiển thị, theme, mật độ, ngôn ngữ, múi giờ, nhóm thông báo, chuyển động; xem trước, lưu, huỷ, chặn rời trang khi chưa lưu ([14b](14b-frontend-pages.md)) | [19](19-reports-dashboard-notifications.md#tùy-chọn-cá-nhân) |

## Màn hình admin

**Trạng thái:** Đã có (API) trên port `admin-console` ([14c](14c-frontend-adapters.md)); `/admin/users` giữ trang mock khi chưa cấu hình admin console.

- `/admin`, `/admin/trace/:agentId` và `/admin/threads/:threadId` được đặc tả trong [13](13-observability.md#chế-độ-xem-trace-dạng-chat).
- `/admin/users` theo [12](12-auth-and-domains.md#quản-lý-người-dùng-trang-admin-người-dùng): tạo (username, mật khẩu, miền, tên hiển thị tuỳ chọn), trạng thái provisioning kèm thử lại, tắt/bật, đặt lại mật khẩu, reset agent. Trang đã xây giữ danh sách, bộ lọc, panel chi tiết và hộp thoại xác nhận ([14b](14b-frontend-pages.md)).

## Realtime

**Trạng thái:** Đã có (API) cho `message.created`, `agent.status`, `task.updated`, `thread.updated`, `notification.*`, `builder.job`, `report.updated` và hiện diện; luồng trace admin được mở theo từng agent đang xem trên `/admin/trace/:agentId`. Khi kết nối lại, chat đọc lại agent, hội thoại, task và trang mới nhất của hội thoại đang mở.

- **Mỗi tab trình duyệt một kết nối SSE:** `GET /api/stream`, theo phạm vi người dùng đã đăng nhập.

| Event | Payload | Client làm gì |
|---|---|---|
| `message.created` | tin nhắn kèm tệp đính kèm và `report_refs` | nối vào hội thoại; đẩy lên đầu danh sách chat; huy hiệu chưa đọc |
| `agent.status` | `{agent_id, status, status_detail}` | trạng thái trên header và danh sách |
| `task.updated` | dòng task | banner task |
| `thread.updated` | dòng hội thoại | danh sách chat |
| `builder.job` | `{job_id, agent_id, kind, status, output_tail}` | toast tiến trình; khi xong, đọc lại dữ liệu builder của agent (trang người dùng admin poll khi có user đang khởi tạo, vì job provisioning phát trên kênh của user mới) |
| `report.updated` | `{report_id, status, version_id?}` | đọc lại danh sách báo cáo và mọi thẻ hoặc viewer đang mở của báo cáo đó |
| `notification.created` | thông báo người dùng (user notification) | thêm vào đầu hộp thư; số chưa đọc |
| `notification.read` | `{ids}` hoặc `{all: true}` | cập nhật trạng thái đã đọc |

- **Kết nối lại** dùng cơ chế tự thử lại của `EventSource`, không phát lại event. Khi kết nối lại, mọi lượt đọc service đang mount được gửi lại, để màn hình phản ánh server.
- **Hiện diện:** khi `window` được `focus` và khi tải trang, client gọi `POST /api/presence`; server tự giới hạn tần suất ([07](07-routing-and-queue.md#người-dùng-mở-app)).
- **Trace của admin:** chế độ xem trace mở `GET /api/admin/agents/{id}/stream` để nhận `event.appended` và `agent.status`.

## Ngôn ngữ

**Trạng thái:** Đã có (mock).

UI có tiếng Việt (mặc định) và tiếng Anh ([quyết định 0021](decisions/0021-bilingual-ui.md)). Đổi ngôn ngữ thay đổi nhãn và định dạng số, ngày, giờ. Tin nhắn agent, báo cáo đã lưu và nội dung Riverside giữ ngôn ngữ lúc được viết. Lỗi API mang `message` tiếng Việt, nhưng frontend hiện chữ riêng của nó theo mã lỗi và không bao giờ hiện nguyên văn message của server ([14c](14c-frontend-adapters.md)).

## Hiện trạng so với mục tiêu

Frontend đã xây làm gì hôm nay và mục tiêu ở trên đòi hỏi gì. Ở chế độ `hybrid`/`api`, các dòng về chat (route, agent, danh sách chat, nội dung tin nhắn, ô soạn tin, khung phải, chat màn hẹp), các dòng builder, trình xem thư mục, admin và trace, SSE và hiện diện đã theo mục tiêu; cột "Hiện tại" mô tả chế độ mock.

| Khía cạnh | Hiện tại (mock) | Mục tiêu |
|---|---|---|
| Đăng nhập | Email + mật khẩu; phiên mock 8 giờ trong `sessionStorage` | Username + mật khẩu qua `POST /api/auth/login`; cookie `contoso_session` ([12](12-auth-and-domains.md)). Desktop và cửa sổ đăng nhập được giữ. |
| Trang đích | Người dùng → `/`; admin → `/admin/users` | Người dùng → `/chat`; admin → `/admin` |
| Vai trò | `USER` / `ADMIN` trong contract frontend | API gửi `user` / `admin`; adapter ánh xạ |
| Route chat | `/chat?conversation=<id>` | `/chat/:threadId?` |
| Agent | Sáu agent cố định (`orchestrator`, `data`, `compare`, `chart`, `insight`, `report`) với mô hình capability | `lead` có sẵn ("Điều phối") + agent khởi đầu của miền + agent người dùng tạo (tối đa 12) |
| Danh sách chat | Catalog agent, nhóm demo, lịch sử | Lead được ghim, hội thoại theo `last_message_at`, huy hiệu chưa đọc, hội thoại chỉ đọc bị làm mờ |
| Nội dung tin nhắn | Block có cấu trúc (KPI, chart, tham chiếu báo cáo, chi tiết, hành động); trạng thái `pending`/`responding`/`interrupted` | Markdown, tệp đính kèm, chip lựa chọn, thẻ tham chiếu báo cáo; tin nhắn đến nguyên khối; dòng trạng thái agent và banner task |
| Ô soạn tin | 5 file × 10 MiB CSV/XLSX/PDF/PNG/JPEG, chỉ metadata; mention `@`; lệnh `/report` | 10 file × 20 MB mọi loại, được upload; không mention hay lệnh |
| Khung phải | Inspector: kỹ năng, tool, MCP, nguyên tắc công khai, capability | Khung thông tin: trạng thái, task hiện tại, lối tắt Thư mục / Tùy chỉnh / Lịch; thành viên nhóm |
| Chat trên màn hình hẹp | Vùng bên thành drawer | Mỗi lúc một khung, có nút quay lại |
| Nút đổi theme | Trang cài đặt và desktop trước đăng nhập | Thêm vào header của app |
| Admin người dùng | Liệt kê tài khoản `USER`; tắt/bật với `expectedRevision` + `operationId` | Tạo kèm miền, provisioning và thử lại, đặt lại mật khẩu, reset agent ([12](12-auth-and-domains.md)) |
| Tải báo cáo | HTML và CSV dạng text | HTML, CSV, DOCX, PDF và XLSX dạng file nhị phân |
| Đích của thông báo người dùng | Đích chat trỏ tới `?conversation=` | Đích chat trỏ tới `/chat/:threadId` |
| Builder, trình xem thư mục, trang tổng quan admin và trace, SSE, hiện diện | Chưa xây | Như đặc tả ở trên |

## Đi qua bản mock

Với runtime mock ([14g](14g-frontend-development.md)):

1. Mở `/login` và đăng nhập bằng tài khoản demo `USER`.
2. Mở `/` để xem dashboard nghiệp vụ theo khoảng ngày, thị trường và dự án.
3. Mở `/chat?conversation=riverside-r010-group` để xem nhóm Riverside với phân tích đã xong ([14d](14d-frontend-chat-mock.md)).
4. Từ thẻ báo cáo trong chat, mở phiên bản báo cáo đã lưu `/reports?report=R010&version=R010-v2&view=dashboard`.
5. Chuyển sang tài liệu, chọn một phiên bản báo cáo, hoặc tải một artifact của phiên bản đang hiện.

Desktop tại `/login` chỉ xem trước nội dung fixture công khai. Hội thoại Riverside được viết sẵn; câu hỏi mới trong đó không gọi model, và trả lời trong các hội thoại demo khác là text cố định. Tệp đính kèm không được upload hay phân tích.

## Ngoài phạm vi PoC

Nhập bằng giọng nói, thông báo đẩy, sửa/xoá tin nhắn, tìm kiếm tin nhắn, sửa file trong trình xem thư mục. Xem [99](99-risks-and-future-work.md).

## Nguồn cần kiểm tra

Khi sửa các tài liệu này, đọc [`package.json`](../../frontend/package.json), [`App.tsx`](../../frontend/src/app/App.tsx), [`feature-registry.ts`](../../frontend/src/app/feature-registry.ts), các interface `features/*/services` và các test cạnh mỗi feature. Chỉ link tới source có thật, tách mock scenario (URL) khỏi fixture chỉ dùng cho test, và tách dashboard nghiệp vụ khỏi tổng quan báo cáo của một báo cáo đã lưu.
