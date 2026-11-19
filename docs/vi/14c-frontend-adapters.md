# 14c · Service và adapter frontend

**Phụ thuộc:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [15](15-api.md)

Frontend gọi các service interface thuộc feature. Implementation được chọn một lần ở bootstrap; React page không trực tiếp xử lý DTO backend hoặc frame SSE/WebSocket.

## Chọn runtime

**Trạng thái:** Đã có (mock)

[`readServiceMode`](../../frontend/src/app/services/create-services.ts) nhận cấu hình `VITE_SERVICE_MODE`:

| Giá trị | Hành vi |
| --- | --- |
| Không đặt, chuỗi rỗng hoặc `mock` | Tạo đầy đủ mock services. |
| `api` | Yêu cầu factory `api` trả về toàn bộ `Services`. |
| `hybrid` | Yêu cầu factory `hybrid` trả về ít nhất một override; phần còn lại dùng mock. |
| Giá trị khác | Ném `ServiceConfigurationError`. |

Hiện [`main.tsx`](../../frontend/src/main.tsx) gọi `createServices(mode)` và chưa truyền factory `api`/`hybrid`. Chỉ đổi biến môi trường sang hai mode này sẽ hiện lỗi cấu hình. API mode không tự chuyển về mock. Cần restart Vite khi đổi biến môi trường.

Factory kiểm tra dependency bắt buộc, clock và các method của core/workspace service. Kiểm tra này xác nhận hình dạng interface, không xác nhận quyền, tính đúng của dữ liệu hay kết nối backend.

## Hợp đồng dependency

[`Services`](../../frontend/src/app/services/services.ts) gồm:

| Dependency | Port hoặc mục đích |
| --- | --- |
| `context.clock` | `now()`, `sleep(ms, signal?)`. |
| `auth` | `restore`, `login`, `logout`. |
| `preferences` | `load`, `save`. |
| `chat` | Catalog, load/create, draft, send/cancel, inspector, reset/release. |
| `notifications` | `list`, `snapshot`, `subscribe`, `markRead`, `reset`. |
| `reportTargets` | `hasReport(id)` để kiểm tra đích trình bày của thông báo người dùng. |
| `workspace.reports` | `catalog`, `list`, `detail`, `download`, `summarize`, `recent`, `onChanged`. |
| `workspace.dashboard` | `catalog`, `overview`, `breakdown`. |
| `workspace['admin-users']` | `list`, `detail`, `changeStatus`, `reset`. |
| `workspace['agent-chat']` | Chat mục tiêu: agent, hội thoại, tin nhắn, gửi, mốc đã đọc, nhóm, task, hiện diện, sự kiện. |
| `workspace['agent-builder']` | Builder và trình xem thư mục: agent, job, prompt, kỹ năng, gói thư viện, lịch, credential, mẫu khởi tạo, tree/file/log/diff/archive. |
| `workspace['admin-console']` | Bảng admin: tổng quan, người dùng, provisioning, reset agent, trace và chế độ hội thoại, gắn nhãn jev, cấu hình. |

Các interface gốc nằm trong [`features`](../../frontend/src/features), tại `auth/services/auth-service.ts`, `settings/services/preferences-service.ts`, `chat/services/chat-service.ts`, `notifications/services/notifications-service.ts`, `reports/services/reports-service.ts`, `dashboard/services/dashboard-service.ts`, `admin-users/services/admin-users-service.ts`, `chat/services/agent-chat-service.ts`, `agents/services/builder-service.ts` và `admin/services/admin-service.ts`.

Workspace dùng `Record<string, unknown>` tại lớp ứng dụng; page lấy port qua `useWorkspaceService<T>(key)`. Khi đăng ký thêm port, cần cập nhật composition và kiểm tra startup tương ứng, không chỉ ép kiểu ở page.

## Đăng ký adapter thật

**Trạng thái:** Đã có (API) ở chế độ hybrid: [`main.tsx`](../../frontend/src/main.tsx) đăng ký `hybrid: createApiHybridServices(...)` từ [`src/adapters/api/`](../../frontend/src/adapters/api/). Các adapter dùng chung một HTTP client (credentials, `X-Contoso-Client: web` cho request ghi, lỗi ánh xạ sang mã của `normalizeServiceError` và không bao giờ là chữ của server), một session store (preferences được tải lúc login/restore vì `PreferencesService.load` là đồng bộ) và một kết nối SSE. `reportTargets.hasReport` chỉ trả lời cho id báo cáo mà API báo cáo đã trả trong phiên. Adapter dashboard tải `/api/dashboard/dataset` (cache 30 s) và chạy `createDashboardRepository` trên đó. Admin users có `revision: 1`, không có audit và phân trang phía client (`queryUsers`); `reset` là `unsupported`. Thay đổi contract: `DownloadDescriptor.content` là `string | Blob`, `Artifact.mediaType` cho thêm PDF/DOCX/XLSX, `sourceMode` của `DashboardOverview` và admin cho phép `api`, và ô đăng nhập là username.

Kế hoạch ban đầu như sau.

Sau khi có implementation theo các contract đã thống nhất, truyền factory vào `createServices` tại bootstrap:

```ts
// Các factory bên dưới là implementation cần bổ sung tại điểm tích hợp.
const services = createServices(mode, {
  api: createApiServices,
  hybrid: () => ({
    workspace: {
      reports: reportsAdapter,
      dashboard: dashboardUsingReportsAdapter,
    },
    reportTargets: reportTargetCatalog,
  }),
});
```

Hybrid thay core service theo từng object và merge `workspace` theo feature key; không merge từng method bên trong service. Dashboard mock giữ dependency reports tại lúc khởi tạo. Vì vậy override `workspace.reports` bắt buộc kèm `workspace.dashboard` và `reportTargets`; reports-only override bị từ chối. Người viết adapter vẫn phải bảo đảm ba dependency dùng cùng nguồn.

`hasReport` là gợi ý đồng bộ để điều hướng thông báo người dùng. Adapter phải cung cấp catalog phù hợp với nguồn thực; không suy luận quyền hoặc sự tồn tại từ mẫu ID như `R010`. Request đọc chi tiết có thẩm quyền vẫn quyết định người dùng có được xem báo cáo hay không.

## Ánh xạ sang API

**Trạng thái:** Đã có (API)

Endpoint được định nghĩa trong [15](15-api.md) (core) và [15 § Workspace extensions](15-api.md#mở-rộng-workspace).

| Port | Nhóm endpoint | Trạng thái |
| --- | --- | --- |
| `auth` | `/api/auth/*` | Đã có (API) |
| `preferences` | `/api/me/preferences` | Đã có (API) |
| `chat` | `/api/threads*` + SSE `/api/stream` | Đã có (API) dưới dạng `workspace['agent-chat']`; port `chat` kịch bản vẫn là mock |
| `notifications` | `/api/notifications*` | Đã có (API) |
| `workspace.reports` | `/api/reports*` | Đã có (API) |
| `workspace.dashboard` | `/api/dashboard/dataset` + tính toán phía FE bằng `features/dashboard/model` | Đã có (API) |
| `workspace['admin-users']` | `/api/admin/users*` | Đã có (API); trang admin console thay thế trên `/admin/users` khi được cấu hình |
| `workspace['agent-chat']` | `/api/threads*`, `/api/tasks*`, `/api/presence`, `/api/attachments/*` + SSE | Đã có (API) |
| `workspace['agent-builder']` | `/api/agents*`, `/api/jobs/*`, `/api/catalog/*` | Đã có (API) |
| `workspace['admin-console']` | `/api/admin/*` + SSE `/api/admin/agents/{id}/stream` | Đã có (API) |

Khác biệt contract adapter phải ánh xạ:

- Role: FE dùng `USER` / `ADMIN`; API dùng `user` / `admin`.
- Định danh: FE `Principal.email` so với API `username` (đăng nhập mục tiêu bằng username).
- Tên hiển thị: FE `Principal.displayName` là bắt buộc; API `display_name` có thể là `''`, nghĩa là "hiện tên đăng nhập".
- Session: FE `Session.expiresAt` không có field tương ứng ở API. `Me` không trả thời hạn (thời hạn trượt, [12](12-auth-and-domains.md#đăng-nhập-mức-poc)); adapter coi 401 là hết session.
- Miền: `Me.domain` (`{id, name, status}` hoặc `null` với admin) được ánh xạ vào `Session.domain` (`SessionDomain`); banner miền không khả dụng và trạng thái tắt của ô soạn tin đọc từ đó. Session mock mang `domain: null`.
- Quản lý người dùng: FE `ManagedUser` (`name`, `email`, `role: 'USER'`, `status: active | disabled`, `revision`, `lastActiveAt`), phân trang và sắp xếp, `changeStatus` với `expectedRevision`/`operationId`, và audit event không có phần tương ứng ở API. `User` của API có `username`, `display_name`, `domain`, `status` (cả `provisioning`, `failed`), `status_detail` và `created_at`; vô hiệu hoá/kích hoạt là `PATCH /api/admin/users/{id} {disabled}` không kiểm tra revision, và danh sách không phân trang ([15](15-api.md#api-admin-apiadmin)).

## Ánh xạ và kiểm tra dữ liệu

Thống nhất endpoint, xác thực, DTO, phân quyền, pagination, business timezone, identity phiên bản, hủy request và thứ tự event trước khi triển khai transport. Endpoint được định nghĩa trong [15](15-api.md) (core) và [15 § Workspace extensions](15-api.md#mở-rộng-workspace).

Adapter thực hiện các bước:

1. Gọi transport và kiểm tra quyền theo session hiện hành.
2. Ánh xạ DTO sang domain model của feature; giữ phân biệt `null`, số 0 và trường thiếu.
3. Kiểm tra identity, kiểu dữ liệu và invariant trước khi trả cho page.
4. Trả `ServiceResult<T>` với lỗi ứng dụng ổn định; giữ abort là luồng điều khiển.

[`decodeReportVersion`](../../frontend/src/features/reports/adapters/decode-version.ts) kiểm tra payload **đã ánh xạ sang domain**, không phải decoder cho một DTO backend giả định. Nó kiểm tra report/version identity, sequence, block legacy, số hữu hạn hoặc null, kích thước bảng/biểu đồ, evidence reference và thời gian nguồn không mới hơn bản lưu. Timestamp được chuẩn hóa về ISO UTC; ngày nghiệp vụ và timezone trong scope có quy tắc riêng.

Schema v1 đi qua `decodeReportSchema`; schema version chưa hỗ trợ được `decodeReportVersion` ghi nhận bằng `schemaIssue`, giữ phần legacy nếu có. Block legacy lạ bị từ chối; block schema lạ trở thành diagnostic hiển thị được. Chi tiết tại [14f](14f-report-schema.md).

[`normalizeServiceError`](../../frontend/src/shared/contracts/normalize-service-error.ts) ánh xạ application code hoặc HTTP status thành `ServiceError`, không chuyển raw server message vào UI. Helper nhận các status 401, 403, 404, 409, 422, 408, 501; status khác về `unavailable`. `DOMException` mang tên `AbortError` được ném lại. Mock repository có bước chuẩn hóa lỗi riêng qua integration của workspace.

Khoảng trống: các status spec [15](15-api.md) dùng như 413 (payload quá lớn), 429 (giới hạn tần suất) và 503 (không khả dụng) hiện đều về `unavailable`. **Trạng thái:** Dự kiến.

## Chat transport

[`ChatTransport`](../../frontend/src/features/chat/services/chat-service.ts) có `send` và `cancel`. `send` nhận principal ID, conversation ID, body, attachment metadata, request ID ổn định, AbortSignal và callback phát `ChatBundle` snapshot.

Adapter stream cần xử lý acknowledgement, chống lặp, thứ tự, reconnect và trạng thái gián đoạn trước khi phát snapshot. `applyMessage` trong model giữ cập nhật có sequence mới hơn cho cùng message ID; nó không thay thế toàn bộ logic hòa giải ở transport.

Abort kết thúc subscription hiện tại. `cancel` là yêu cầu riêng để dừng công việc từ xa, phụ thuộc capability. Không tự gửi lại câu hỏi khi chưa rõ server đã nhận hay chưa. `delivery` (`replay`, `stream`, `complete`), `connection` và capability của agent do adapter công bố.

Nội dung công khai đưa vào `Message.blocks` không chứa trace nội bộ hay private instructions. Mock attachment chưa có upload transport; adapter thật cần định nghĩa lưu byte, quyền truy cập, vòng đời và trạng thái upload trước khi tuyên bố hỗ trợ. Chat mục tiêu (tin nhắn trọn vẹn qua SSE, `report_refs`, attachment) khác; xem [14](14-frontend.md#hiện-trạng-so-với-mục-tiêu).

## Port chat mục tiêu

**Trạng thái:** Đã có (API). [`AgentChatService`](../../frontend/src/features/chat/services/agent-chat-service.ts) được `createApiHybridServices` đăng ký là `workspace['agent-chat']`; [`ChatRoute`](../../frontend/src/features/chat/pages/ChatRoute.tsx) hiển thị chat mục tiêu khi có key này và chat mock khi không có. Khi đó shell ẩn huy hiệu "Dữ liệu minh họa", và đích chat của thông báo người dùng mở `/chat/:threadId` sau khi đối chiếu id với `GET /api/threads`.

| Phương thức | Endpoint |
| --- | --- |
| `agents`, `threads`, `tasks` | `GET /api/agents`, `GET /api/threads`, `GET /api/tasks?status=queued,running` |
| `messages(threadId, before?)` | `GET /api/threads/{id}/messages?before=&limit=50` |
| `send(threadId, {text, files, choiceId?, replyTo?})` | multipart `POST /api/threads/{id}/messages`; hơn 10 file hoặc một file trên 20 MB bị từ chối trước khi upload |
| `markRead`, `createGroup`, `updateGroup` | `POST /api/threads/{id}/read`, `POST /api/threads`, `PATCH /api/threads/{id}` |
| `cancelTask`, `presence` | `POST /api/tasks/{id}/cancel`, `POST /api/presence` |
| `subscribe` | SSE `message.created`, `agent.status`, `task.updated`, `thread.updated`, cùng `reconnect` |

DTO được ánh xạ sang camelCase (`display_name` → `name`, `report_refs` → `reportRefs`, tệp đính kèm có `url`). Mã của server ánh xạ sang `readOnly` (`thread_read_only`), `tooLarge` (`file_too_large`, 413), `domainUnavailable` và `taskEnded`; trang hiển thị chữ riêng cho từng mã. `createRealtime` luôn nghe `open` và truyền số lần đã mở, nên adapter chỉ phát `reconnect` từ lần thứ hai. Tin nhắn được khử trùng theo id, nên phản hồi của `send` và bản SSE của cùng tin nhắn chỉ hiển thị một lần.

## Artifact và mutation

`ReportsService.download` trả `DownloadDescriptor` cho đúng report/version/artifact, hiện gồm text content, media type HTML/CSV, filename, size và `sourceMode`. UI tạo Blob và thu hồi object URL. Thêm PDF/DOCX cần mở rộng contract và triển khai binary transport; đổi nhãn nút chưa đủ.

Admin `changeStatus` nhận `userId`, `targetStatus`, `expectedRevision`, `operationId`. Controller giữ operation ID khi retry kết quả chưa rõ; đọc lại detail/audit để đối chiếu. Khi conflict, người dùng cần xem dữ liệu mới và xác nhận thao tác mới. Các kiểu audit/mutation hiện vẫn ghi `sourceMode: 'mock'`; tích hợp backend admin cần cập nhật contract này có chủ đích.

## Kiểm tra khi thay adapter

Các test hiện có gồm [`create-services.test.ts`](../../frontend/src/app/services/create-services.test.ts), [`adapter-contracts.test.ts`](../../frontend/src/features/reports/tests/adapter-contracts.test.ts), [`lifecycle.test.tsx`](../../frontend/src/features/chat/tests/lifecycle.test.tsx) và [`status-controller.test.mjs`](../../frontend/src/features/admin-users/tests/status-controller.test.mjs).

Khi thêm transport thật, cần xác minh riêng trường hợp quyền bị thu hồi, lỗi request, response đến muộn, phiên bản không khớp, download sai identity và kết quả mutation chưa rõ. Test mock hiện tại không chứng minh các bảo đảm từ backend chưa tích hợp.
