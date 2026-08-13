# Báo cáo cập nhật công việc
Phạm Thế Đăng
## Ngày 14/08/2026

### 1. Hoàn thiện luồng tạo và xuất báo cáo profile

- Bổ sung kiểm tra trạng thái profile ở backend. Chỉ profile có trạng thái `completed` mới được export hoặc tạo report.
- Thêm API tạo report từ một profile run hoàn tất:
  - `POST /api/v1/profile/{run_id}/report`
  - Report được tạo trực tiếp trong khu vực **Báo cáo** với trạng thái chờ duyệt.
- Khi Analyst bấm **Xuất báo cáo** tại danh sách run, hệ thống tạo report rồi chuyển thẳng đến trang chi tiết báo cáo.
- Bổ sung nút **Xuất PDF đầy đủ** trên trang chi tiết report.
- File PDF sử dụng đầy đủ các nhóm nội dung, không chỉ phần tóm tắt:
  - Tổng quan
  - Technical profile
  - Chất lượng dữ liệu
  - Kiểm định
  - Drift
  - Agent summary
  - Phân tích

### 2. Hoàn thiện phân quyền và vòng đời report

- Analyst/Admin có thể xem các report `draft` và `in_review` trong workspace.
- Viewer chỉ xem được report đã `published`.
- Thêm API xóa report:
  - `DELETE /api/v1/reports/{report_id}`
- Backend chỉ cho phép xóa khi:
  - Người thực hiện đúng là tác giả report.
  - Report thuộc workspace hiện tại.
  - Report đang ở trạng thái `draft` hoặc `in_review`.
  - Report chưa qua duyệt hoặc publish.
- Khi xóa, backend dọn cả version, section, visualization và review liên quan, đồng thời ghi audit event `report_deleted`.
- Frontend bổ sung nút **Xóa báo cáo**, hộp xác nhận và tự tải lại danh sách sau khi xóa.

### 3. Cải thiện giao diện khu vực Báo cáo

- Thiết kế lại trang danh sách report theo dạng thư viện card.
- Bổ sung:
  - Badge trạng thái.
  - Icon report.
  - Ngày cập nhật.
  - Nút mở report.
  - Nút xóa report.
  - Empty state và loading state.
- Thu gọn chiều rộng, padding, khoảng cách, kích thước icon và typography của card để bố cục gọn hơn.
- Hỗ trợ responsive trên mobile và dark mode.
- Cải thiện giao diện trang chi tiết report, hiển thị nội dung Markdown rõ ràng hơn.

### 4. Bổ sung xóa lịch sử chat

- Thêm nút xóa từng đoạn chat ở sidebar.
- Thêm nút xóa từng đoạn chat trong cửa sổ **Lịch sử chat**.
- Thêm nút **Xóa tất cả** lịch sử chat.
- Có hộp xác nhận trước khi xóa.
- Lịch sử chat vẫn được cách ly theo user, workspace và guest session.
- Nếu xóa đoạn chat đang mở, hệ thống chuyển sang đoạn chat khác hoặc quay về Dashboard.

### 5. Kiểm tra và xác nhận

- Frontend đã chạy thành công:
  - `npm.cmd run typecheck`
  - `npm.cmd run lint`
- Backend đã kiểm tra syntax bằng `py_compile`.
- Đã chạy `git diff --check` không phát hiện lỗi whitespace.
- Đã bổ sung test API cho việc tạo report, chặn export khi profile chưa hoàn tất và xóa report trước khi publish.
- Backend test suite chưa chạy được trong môi trường hiện tại vì chưa có executable `pytest`.

### Các file chính đã cập nhật

- `backend/src/api/routes.py`
- `backend/src/api/authz_routes.py`
- `backend/src/services/repository.py`
- `frontend/src/app/datasets/[datasetId]/runs/page.tsx`
- `frontend/src/app/reports/page.tsx`
- `frontend/src/app/reports/[reportId]/page.tsx`
- `frontend/src/components/app-shell.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/chat-history.ts`
- `frontend/src/app/globals.css`
- `tests/test_api/test_routes.py`
