# Tổng quan sản phẩm

**Implemented.** VDaAgent hỗ trợ nhóm quản lý tồn kho bất động sản hỏi và kiểm tra dữ liệu snapshot theo dự án, phân khu và ngày. UI gom hội thoại, run, evidence và báo cáo vào một workspace. Mỗi kết quả có đường về dữ liệu và artifact đã tính, thay vì chỉ là lời trả lời từ mô hình ngôn ngữ.

Người dùng chính là `owner` và `analyst` cần nhập dữ liệu, chạy phân tích, tạo báo cáo; `viewer` xem dữ liệu và kết quả đã được cấp quyền. Hệ thống giải quyết việc rà soát tồn kho theo thời gian, so sánh kỳ/nhóm và tìm các tín hiệu nổi bật trong dữ liệu đã nhập.

Khả năng hiện có: CSV import, phân tích semantic có công thức xác định, agent workflow tạo draft/review/report, hội thoại theo ngữ cảnh, dashboard bằng chứng, lịch báo cáo và export JSON/CSV. Dữ liệu mock và công thức `mvp-inventory-v0.1` phục vụ MVP; mọi số đo cần được hiểu cùng định nghĩa và giới hạn của phiên bản này. Không thấy code giao nhận báo cáo cho bên ngoài hoặc hỗ trợ dữ liệu tùy ý ngoài schema tồn kho.

Codebase: `src/frontend/src/features/workspace`, `src/backend/packages/semantic`, `src/backend/packages/agents/src/analysis-v1`. Xem [user flows](user-flows.md) và [use cases](use-cases.md).
