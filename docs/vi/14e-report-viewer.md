# 14e · Kho và trình xem báo cáo

**Phụ thuộc:** [14](14-frontend.md), [14c](14c-frontend-adapters.md), [14f](14f-report-schema.md), [19](19-reports-dashboard-notifications.md)

**Trạng thái:** Đã có (mock)

> Backend mục tiêu: báo cáo do agent publish và `api` phục vụ; xem [19 § Reports library](19-reports-dashboard-notifications.md#kho-báo-cáo) và [15 § Workspace extensions](15-api.md#mở-rộng-workspace). Download mục tiêu bổ sung DOCX/PDF/XLSX nhị phân; mock hiện chỉ cung cấp HTML/CSV dạng text. Xem [hiện trạng so với mục tiêu](14-frontend.md#hiện-trạng-so-với-mục-tiêu).

[`ReportsPage`](../../frontend/src/features/reports/pages/ReportsPage.tsx) giữ kho báo cáo phía sau và lazy-load [`ReportDetailPage`](../../frontend/src/features/reports/pages/ReportDetailPage.tsx), component mặc định là `ReportViewer`. Một Radix dialog chuyển giữa hai mode `dashboard` và `detail` trên cùng phiên bản đã lưu.

Mode `dashboard` là **tổng quan báo cáo** của một report version. Dashboard nghiệp vụ tại `/` đọc port và phạm vi riêng; hai màn hình không thay thế nguồn dữ liệu cho nhau.

## URL, history và focus

| URL | Hành vi mặc định |
| --- | --- |
| `/reports` | Danh sách card với tìm kiếm, lọc, sort và pagination. |
| `/reports?report=R010&version=R010-v2` | Tổng quan báo cáo của R010-v2. |
| `/reports?report=R010&version=R010-v2&view=detail` | Tài liệu đầy đủ của cùng phiên bản. |
| `/reports?report=R010` | Đọc bản khả dụng rồi replace URL với version đã resolve. |
| `/reports/R010?version=R010-v2` | Deep link tương thích, mặc định mở tài liệu. |

`view=dashboard`/`view=detail` chỉ định mode. Identity dữ liệu lấy từ URL, không phụ thuộc `location.state`. Các query danh sách, bộ lọc lặp, timezone, scenario và pagination được giữ khi đổi view/version.

Mở card, đổi mode và đổi version tạo history entry để Back/Forward khôi phục lựa chọn. Khi mở từ thư viện đang mount, `reportViewerDepth` giúp Close/Escape quay về entry gốc trong một thao tác. Với deep link trực tiếp, đóng viewer replace về URL thư viện. Nếu được mở từ chat và có chat origin hợp lệ, đóng quay về chat; origin chỉ chấp nhận path nội bộ `/chat`.

Card có link đích thật, hỗ trợ modifier key/tab mới. Đóng trả focus về trigger còn gắn trong DOM; fallback của thư viện là heading kết quả. TOC và evidence anchor cuộn/focus bên trong reader, không tạo hash entry. Tổng quan/detail giữ offset cuộn riêng trong vòng đời viewer đang mount.

Dialog cung cấp focus trap, khóa cuộn nền, title/description và Escape. Trên mobile, viewer chiếm gần hết viewport; heading/actions tách khỏi phần nội dung cuộn.

## Dữ liệu phiên bản được chọn

`ReportsService.detail(principal, reportId, versionId?, signal?)` trả `ReportDetail`: summary record, selected version, danh sách version được phép xem, evidence và artifact metadata.

`useServiceRead` dùng identity principal/report/version, hủy và bỏ kết quả cũ khi selection thay đổi. Khi chưa pin version, header controls chờ URL normalization và canonical read hoàn tất. Đổi phiên bản không để tài liệu cũ hiển thị dưới identity mới.

[`deriveReportVersionSummary`](../../frontend/src/features/reports/model/version-summary.ts) chiếu nội dung từ `detail.version`, gồm scope, cutoff, source quality, policy/content revision, đoạn tổng quan, KPI, chart, finding, recommendation, limitation, evidence và artifact metadata. Hàm từ chối identity không khớp; không dùng `summary.latestVersion` thay cho bản đang chọn. Không có persisted version thì trả `null`.

KPI legacy lấy từ hàng số/null của metric table. Bảng comparison không tự chuyển thành delta phần trăm. Thiếu giá trị hiển thị `—`; không tự gán số 0 hoặc tạo insight/recommendation mới.

## Tổng quan compact

[`deriveReportDashboardView`](../../frontend/src/features/reports/model/dashboard-view.ts) chỉ chọn cách trình bày, không sửa bản lưu. Với schema v1, phần chính gồm đoạn mở đầu nếu block đầu là text, metric-grid đầu tiên, tối đa hai chart phù hợp và finding đầu tiên hoặc section chỉ chứa finding. Block còn lại vẫn hiển thị ở phần hỗ trợ; section lồng nhau được giữ nguyên.

Chart compact tối đa bốn series. Giới hạn nhãn tùy loại: heatmap tám, pie/donut sáu, horizontal bar tám, loại còn lại bốn mươi. Đây là tiêu chí chọn vùng nổi bật; chart không đạt vẫn còn trong phần hỗ trợ. Legacy summary dùng hai chart và một finding đầu, giữ phần còn lại để xem tiếp.

`ReportKpis` dùng chung cho schema/legacy, giữ định nghĩa và số liệu chính xác ngay lần render đầu. Không có count-up. Viewer header giữ version, phạm vi, cutoff và chất lượng nguồn. Khi container nội dung đủ rộng, chart có thể đặt cạnh nhau; màn hình hẹp xếp dọc.

## Tài liệu đầy đủ

`ReportDocument` đọc sections legacy hoặc chuyển schema sections qua module lazy `ReportBlocks`. Reader giữ thứ tự tác giả lưu, có mục lục, anchor, evidence provenance, methodology và limitations. Schema và legacy dùng chung `ReportChart`/`ChartRenderer` cho các biểu đồ tương ứng.

Schema không chọn layout riêng theo `reportTypeId`; các block quyết định nội dung. Schema version chưa hỗ trợ có cảnh báo, dùng legacy nếu bản lưu cung cấp. Block mới chưa hỗ trợ có diagnostic nhìn thấy được. Quy tắc decoder và chart fallback tại [14f](14f-report-schema.md).

Bảng rộng cuộn trong vùng của nó; bảng lớn phân trang. Chart có legend, giá trị/đơn vị và bảng dữ liệu tương đương. Đường biểu diễn giữ null gap. Plot có thể rút gọn nhãn nhưng bảng/tooltip giữ nhãn gốc.

## Mở rộng biểu đồ

`ChartRenderer` có presentation `compact`, `reading`, `expanded`, dùng chung data và registry. Bảng dữ liệu chart được mount khi mở disclosure; mặc định 25 hàng/trang ở compact, 100 ở reading/expanded.

[`ChartExpansion`](../../frontend/src/shared/charts/ChartExpansion.tsx) đặt panel hiện có vào portal slot trong viewer, giữ lựa chọn loại chart tương thích, inert nội dung nền, focus nút thu gọn và khôi phục scroll/focus khi đóng. Escape thu gọn chart trước khi đóng dialog. Đổi report, version hoặc mode kết thúc expansion.

## Tải artifact

[`ReportArtifactActions`](../../frontend/src/features/reports/components/ReportArtifactActions.tsx) ở header dùng chung cho hai mode. Request mang đúng report/version/artifact; kết quả trả về được kiểm tra version trước khi tạo Blob và download. Có trạng thái pending/error/success, abort công việc lỗi thời và revoke object URL.

**Trạng thái:** Đã có (mock) với HTML/CSV; Dự kiến với DOCX/PDF/XLSX.

Mock hiện cung cấp nội dung HTML/CSV thật để tải, theo phiên bản đã lưu. Không có export PDF/DOCX. Bản lưu không có artifact thì không dựng tệp giả. Thêm định dạng nhị phân cần sửa contract và adapter download, xem [14c](14c-frontend-adapters.md).

## Trạng thái và generation

| Tình huống | Hành vi |
| --- | --- |
| Không tìm thấy report/version | Trạng thái thiếu dữ liệu, không thay bằng phiên bản khác âm thầm. |
| Không đủ quyền | Trạng thái bị từ chối tại service/viewer. |
| Lỗi đọc | Thông báo và retry. |
| Draft hoặc generation chưa có bản lưu | Hiển thị lifecycle, không tạo tài liệu hoặc download giả. |
| Generation mới thất bại/đang chạy nhưng còn bản lưu | Bản lưu trước vẫn khả dụng; attempt được trình bày riêng. |
| Không có chart/KPI/evidence/artifact | Collection rỗng được xử lý theo loại nội dung, không tự sinh số liệu. |
| Schema version lạ | Warning và nội dung legacy nếu có. |
| Chart lạ/không tương thích/quá capacity | Giữ bảng dữ liệu gốc để đọc. |

Record có persisted version được xem là completed ngay cả khi latest attempt thất bại. Chưa có version: queued/running thành generating; failed thành failed; succeeded nhưng thiếu output hoặc unknown thành unsupported; không attempt thành draft. Logic nằm trong [`lifecycle.ts`](../../frontend/src/features/reports/model/lifecycle.ts).

## Motion và kiểm tra

Motion dùng GSAP và `@gsap/react`, được quản lý bằng context trong `useAnalyticalMotion`. Content/KPI và từng chart family sở hữu hiệu ứng riêng. Bars reveal theo zero origin, line giữ gap, radial/scatter/heatmap reveal bằng opacity. Cleanup khi đổi identity, mode, type, expansion hoặc unmount; giảm chuyển động bỏ qua reveal và trả ngay nội dung cuối.

Test liên quan: [`workspace.test.tsx`](../../frontend/src/features/reports/tests/workspace.test.tsx), [`version-summary.test.ts`](../../frontend/src/features/reports/tests/version-summary.test.ts), [`dashboard-view.test.ts`](../../frontend/src/features/reports/tests/dashboard-view.test.ts), [`reports-viewer.spec.ts`](../../frontend/tests/reports-viewer.spec.ts), [`report-schema.spec.ts`](../../frontend/tests/report-schema.spec.ts), [`compact-dashboard.spec.ts`](../../frontend/tests/compact-dashboard.spec.ts), [`riverside.spec.ts`](../../frontend/tests/riverside.spec.ts). Chúng bao phủ những phần khác nhau của projection, history, download, schema, focus, motion và viewport; hướng dẫn chạy tại [14g](14g-frontend-development.md).
