# 14b · Các trang frontend

**Phụ thuộc:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [19](19-reports-dashboard-notifications.md)

Route lấy từ [`App.tsx`](../../frontend/src/app/App.tsx), [`feature-registry.ts`](../../frontend/src/app/feature-registry.ts) và các `features/*/entry.ts`. Trang này mô tả UI đang triển khai cùng các route mục tiêu từ spec; giới hạn dữ liệu mock xem tại [14g](14g-frontend-development.md). Chỗ mock khác UX mục tiêu, xem [14](14-frontend.md#hiện-trạng-so-với-mục-tiêu).

## Route và quyền truy cập

| Route | Quyền | Nội dung | Trạng thái |
| --- | --- | --- | --- |
| `/login` | Chưa đăng nhập | Desktop giới thiệu và cửa sổ đăng nhập. | Đã có (mock) |
| `/` | `USER` | Dashboard nghiệp vụ. | Đã có (mock) |
| `/reports` | `USER` | Kho báo cáo và viewer theo query. | Đã có (mock) |
| `/reports/:id` | `USER` | Deep link tương thích, mở viewer trên kho báo cáo. | Đã có (mock) |
| `/chat` | `USER` | Agent Fleet và hội thoại (`?conversation=`). | Đã có (mock) |
| `/chat/:threadId?` | user | Route chat mục tiêu (spec 14). | Đã có (API) |
| `/agents` | user | Danh sách đội agent. | Đã có (API) |
| `/agents/new` | user | Builder, tạo agent mới. | Đã có (API) |
| `/agents/:id/:tab` | user | Các tab builder / folder viewer. | Đã có (API) |
| `/notifications` | `USER` | Hộp thông báo người dùng. | Đã có (mock) |
| `/setting` | `USER` | Tùy chọn cá nhân và dữ liệu demo. | Đã có (mock) |
| `/admin/users` | `ADMIN` | Danh sách, chi tiết và trạng thái người dùng. | Đã có (API); trang mock ở chế độ mock |
| `/admin` | admin | Tổng quan admin (spec 13). | Đã có (API) |
| `/admin/trace/:agentId` | admin | Trace của agent. | Đã có (API) |
| `/admin/threads/:threadId` | admin | Xem thread. | Đã có (API) |

Path cài đặt là `/setting`. Người chưa đăng nhập mở route được bảo vệ sẽ chuyển về `/login`. Người đã đăng nhập vào `/login` được chuyển về trang chủ theo role. Truy cập route của role khác hiển thị trạng thái không có quyền trong shell hiện tại. Path không được đăng ký có màn hình không tìm thấy.

Trang đích: trên API, user → `/chat` (hội thoại trực tiếp với lead) và admin → `/admin`; chế độ mock giữ `USER` → `/`, `ADMIN` → `/admin/users`. `/` vẫn là dashboard nghiệp vụ trong navigation.

Session đang restore hoặc restore lỗi có màn hình chờ/lỗi trước khi page được mount. Các kiểm tra này không thay quyền truy cập tại service/backend.

## Khung giao diện dùng chung

**Trạng thái:** Đã có (mock)

Shell hiển thị navigation theo role, tài khoản, đăng xuất và số thông báo người dùng chưa đọc. Rail desktop mở rộng theo tương tác; màn hình hẹp dùng drawer. Page thông thường dùng frame có vùng cuộn; chat khai báo frame `viewport` để timeline và vùng phụ quản lý cuộn riêng.

UI có tiếng Việt/Anh, theme light/dark/system, timezone, density comfortable/compact và tùy chọn giảm chuyển động. Nhãn điều khiển và định dạng thay theo preferences; nội dung báo cáo/tin nhắn giữ ngôn ngữ đã lưu. Các overlay dùng primitive Radix, có cơ chế focus và Escape theo từng loại.

## Desktop và đăng nhập — `/login`

**Trạng thái:** Đã có (mock). Backend theo [19](19-reports-dashboard-notifications.md#desktop-trước-đăng-nhập).

[`PreAuthDesktop`](../../frontend/src/features/auth/desktop/PreAuthDesktop.tsx) dựng wallpaper, thanh hệ thống, shortcut, dock và bảy cửa sổ: `login`, `workspace`, `reports`, `data`, `skills`, `automations`, `about`. Có mở, đóng, thu nhỏ, đưa lên trước, di chuyển cửa sổ và reset bố cục. Vị trí và thứ tự cửa sổ nằm trong reducer, không phải trạng thái tài khoản lưu lâu dài.

Ở chiều rộng từ 1200px, login, workspace và reports mở ban đầu. Chế độ compact ưu tiên login, các preview khác mở theo thao tác; mở preview mới thu nhỏ preview trước. Khi chiều rộng viewport thay đổi, bố cục được reset theo kích thước mới.

Workspace/report preview dùng dữ liệu công khai trong fixture Riverside; chúng không cấp quyền xem kho báo cáo. Preview năng lực mô tả khả năng mô phỏng của sản phẩm. Người dùng có thể đổi locale/theme trước đăng nhập và mở cửa sổ login từ dock hoặc các nút đăng nhập.

[`LoginForm`](../../frontend/src/features/auth/desktop/LoginForm.tsx) nhập email/mật khẩu, hỗ trợ tài khoản demo và báo lỗi đăng nhập. Auth service chuẩn hóa email bằng trim/lowercase và tạo session demo tám giờ. Đăng nhập thành công đưa `USER` về `/`, `ADMIN` về `/admin/users`. Mục tiêu: cửa sổ login hỏi **username** + mật khẩu qua `POST /api/auth/login` với cookie session, trang đích theo bảng mục tiêu ở trên.

## Dashboard nghiệp vụ — `/`

**Trạng thái:** Đã có (mock). Backend theo [19](19-reports-dashboard-notifications.md#dashboard-nghiệp-vụ); API [15](15-api.md#dashboard-nghiệp-vụ).

[`DashboardPage`](../../frontend/src/features/dashboard/pages/DashboardPage.tsx) đọc catalog rồi tải overview cho phạm vi ngày, thị trường và dự án. Nội dung gồm KPI tồn kho, tỷ lệ tồn lâu, giao dịch; biểu đồ tuổi tồn và xu hướng giao dịch; điểm cần chú ý, ưu tiên dự án, báo cáo gần đây và thống kê tác vụ.

KPI có giá trị, baseline/delta khi có, định nghĩa, source, cutoff, policy và chất lượng. Dữ liệu thiếu hiển thị trạng thái tương ứng. Các khối dữ liệu có thể phản ánh lỗi hoặc độ đầy đủ riêng thay vì suy ra mọi nguồn đều hoàn chỉnh.

Thao tác xem chi tiết mở vùng inspect trên cùng trang, cho tồn kho, tồn lâu, giao dịch, dự án hoặc tác vụ. Vùng này có pagination và focus heading. Liên kết báo cáo gần đây mang phiên bản đã chọn; liên kết kho báo cáo mang scope nghiệp vụ.

| Query | Ý nghĩa |
| --- | --- |
| `from`, `to`, `timezone` | Khoảng ngày nghiệp vụ `[from, to)`; dashboard yêu cầu hai mốc, tối đa 366 ngày. |
| `market`, `project` | Scope theo catalog; project phải khớp market nếu có. |
| `inspect` | `inventory`, `slow`, `transactions`, `project`, `tasks`. |
| `target` | Đối tượng trong inspect, tùy loại. |
| `taskState` | `active`, `failed`, `all` cho tác vụ. |
| `inspectPage` | Trang dữ liệu inspect. |

Query ngày không hợp lệ trở về default scope và có warning; market/project được kiểm tra theo catalog.

## Kho báo cáo và viewer — `/reports`, `/reports/:id`

**Trạng thái:** Đã có (mock). Backend theo [19](19-reports-dashboard-notifications.md#kho-báo-cáo); API [15](15-api.md#báo-cáo).

[`ReportsPage`](../../frontend/src/features/reports/pages/ReportsPage.tsx) hiển thị card grid, tìm kiếm, bộ lọc, sort và pagination. Tìm kiếm mock bỏ dấu và chuẩn hóa hoa/thường; tìm trong mã, tiêu đề, dự án và tác giả. Bộ lọc cùng trường dùng logic khớp một giá trị; các nhóm lọc được kết hợp.

| Query | Giá trị hoặc mục đích |
| --- | --- |
| `q` | Từ khóa, tối đa 500 ký tự sau chuẩn hóa đầu vào. |
| `type`, `status`, `market`, `project`, `author`, `agent` | Có thể lặp lại key để lọc nhiều giá trị. |
| `status` | `completed`, `generating`, `failed`, `draft`, `unsupported`. |
| `dateField` | `createdAt` hoặc `completedAt`. |
| `from`, `to`, `timezone` | Khoảng ngày `[from, to)` theo business timezone. |
| `sort`, `direction` | Sort theo `createdAt`, `completedAt`, `title`, `status`; `asc`/`desc`. |
| `page`, `pageSize` | Trang từ 1; kích thước 25, 50 hoặc 100. |
| `report`, `version`, `view` | Mở báo cáo, pin phiên bản, chọn `dashboard` (tổng quan báo cáo) hoặc `detail`. |

Card mở tổng quan báo cáo của bản khớp bộ lọc ngày hoàn tất hoặc bản mới nhất phù hợp. Card có link thật để mở tab mới. Viewer là một dialog trên danh sách, có tổng quan phân tích, tài liệu, chọn phiên bản, evidence và tải artifact. `/reports/:id` mặc định mở tài liệu; query link mặc định mở tổng quan báo cáo.

Trạng thái record và lần generation mới nhất được phân biệt: có bản lưu thì vẫn xem được dù lần generation mới đang chạy hoặc thất bại. Chưa có bản lưu thì không tạo tài liệu giả. Quy tắc history, focus, lỗi và download nằm trong [14e](14e-report-viewer.md). Download mục tiêu gồm file nhị phân DOCX/PDF/XLSX qua API (xem [14](14-frontend.md#hiện-trạng-so-với-mục-tiêu)).

## Agent Fleet (chat mock) — `/chat`

**Trạng thái:** Đã có (mock). Khác UX chat mục tiêu (spec [14](14-frontend.md), [12](12-auth-and-domains.md), [13](13-observability.md)); xem [14](14-frontend.md#hiện-trạng-so-với-mục-tiêu).

[`ChatPage`](../../frontend/src/features/chat/pages/ChatPage.tsx) gồm danh mục sáu agent, nhóm/lịch sử, timeline, composer và inspector. Chọn agent mở hội thoại riêng; tạo nhóm demo cần ít nhất hai thành viên. Query `conversation` chọn thread; ID không hợp lệ có thông báo và dùng hội thoại khả dụng.

Timeline hiển thị Markdown, evidence, bảng, biểu đồ và report reference. Có tải thêm tin trước, về tin mới nhất, xử lý câu trả lời pending/interrupted và thông báo kết quả gửi. Inspector hiển thị mô tả, skill, tool, MCP và capability công khai của agent.

Composer hỗ trợ Enter gửi, Shift+Enter xuống dòng, mention và metadata đính kèm theo capability. Mention trong mock chỉ chèn văn bản. File tối đa năm tệp, mỗi tệp 10 MiB, nhận CSV/XLSX/PDF/PNG/JPEG; chưa có upload hoặc phân tích file.

Nhóm Riverside và sáu thread riêng là nội dung đã biên soạn từ `R010-v2`. `/report` dẫn người dùng đến report reference hiện có hoặc mở bản lưu; không tạo generation mới. Chi tiết và giới hạn tại [14d](14d-frontend-chat-mock.md).

Khác biệt mục tiêu (tóm tắt): route `/chat/:threadId?`; lead + agent khởi đầu theo domain + agent do người dùng tạo (tối đa 12); tin nhắn đến trọn vẹn qua SSE với status line thay cho streaming; 10 tệp × 20 MB mọi loại, không mention, không slash command; info pane thay cho inspector; mỗi lần một pane dưới 768 px.

## Thông báo người dùng — `/notifications`

**Trạng thái:** Đã có (mock). Backend theo [19](19-reports-dashboard-notifications.md#thông-báo-người-dùng); API [15](15-api.md#thông-báo-người-dùng).

[`NotificationsPage`](../../frontend/src/features/notifications/pages/NotificationsPage.tsx) có tab tất cả/chưa đọc và bộ lọc loại: tài khoản, hệ thống, báo cáo sẵn sàng, tác vụ thất bại, hành động cần xem. Nhóm hôm nay/hôm qua/trước đó dựa trên clock và timezone đang chọn. Bộ lọc và panel chi tiết là state trong trang, không được serialize lên URL.

Mở chi tiết đánh dấu thông báo người dùng đã đọc và chuyển focus vào nội dung. Lỗi cập nhật có phản hồi; trạng thái đọc optimistic được xử lý qua provider/service. Đánh dấu tất cả áp dụng cho mọi mục chưa đọc, kể cả ngoài bộ lọc hiện tại.

Mở nội dung liên quan kiểm tra `access`, role, conversation ID hoặc report target trước khi điều hướng. Đích thiếu hoặc bị hạn chế có trạng thái không khả dụng. Khi đóng chi tiết, focus về trigger còn tồn tại hoặc bộ lọc nếu trigger đã biến mất khỏi danh sách chưa đọc.

## Cài đặt — `/setting`

**Trạng thái:** Đã có (mock). Backend theo [19](19-reports-dashboard-notifications.md#tùy-chọn-cá-nhân); API [15](15-api.md#tuỳ-chọn).

[`SettingsPage`](../../frontend/src/features/settings/pages/SettingsPage.tsx) chỉnh tên hiển thị, theme, density, locale, IANA timezone, nhóm thông báo người dùng và motion. Email/role chỉ đọc. Tên phải có 1–100 ký tự; timezone được kiểm tra bằng `Intl.DateTimeFormat`.

Thay đổi được xem trước trên ứng dụng. Lưu ghi preferences qua service; hủy khôi phục bản đã lưu. Có chặn navigation khi dirty và cảnh báo `beforeunload` khi rời tab. Lỗi lưu giữ draft để người dùng xử lý.

Reset demo có dialog xác nhận, chỉ reset chat/draft và trạng thái đọc thông báo người dùng của tài khoản đang dùng. Preferences và dữ liệu tài khoản khác được giữ.

## Quản lý người dùng — `/admin/users`

**Trạng thái:** Đã có (API) trên port `admin-console` (spec [12](12-auth-and-domains.md)); trang mock bên dưới chỉ hiện ở chế độ mock.

[`AdminUsersPage`](../../frontend/src/features/admin-users/pages/AdminUsersPage.tsx) chỉ hiển thị tài khoản `USER`, có tìm theo tên/email, lọc active/disabled, sort, pagination và chi tiết/audit. Query gồm `q`, `status` lặp, `sort` (`name`, `createdAt`, `lastActiveAt`), `direction`, `page`, `pageSize`, `user` để mở detail.

Đổi trạng thái cần xác nhận và gửi `expectedRevision` cùng `operationId`. Khi pending, controller chống submit trùng. Nếu mất phản hồi, controller đọc lại audit để đối chiếu; retry giữ nguyên operation ID. Conflict cần xem trạng thái mới và xác nhận lại. Mutation và audit hiện là mô phỏng, chưa quản lý tài khoản thật của backend.

Trang admin trên API có thêm tạo/provision/retry/đặt lại mật khẩu/reset agent, `/admin`, trace và threads; trang mock giữ hành vi status/audit của nó ở chế độ mock.

## Nguồn và kiểm tra

Các test hành trình nằm trong [`frontend/tests`](../../frontend/tests), đặc biệt `preauth-desktop.spec.ts`, `workspace-ux.spec.ts`, `shell-settings.spec.ts`, `reports-viewer.spec.ts`, `agent-fleet.spec.ts` và `riverside.spec.ts`. Xem [14g](14g-frontend-development.md) để chạy đúng nhóm test và cấu hình browser.
