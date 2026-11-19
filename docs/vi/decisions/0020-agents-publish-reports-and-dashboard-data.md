# 0020 · Agent xuất bản báo cáo và dữ liệu dashboard

- **Bối cảnh.** Frontend có thư viện báo cáo và dashboard nghiệp vụ. Đặc tả PoC không có cả hai: báo cáo chỉ là tệp đính kèm DOCX/PDF, và chỉ agent truy cập được kho dữ liệu, vì credentials của miền nằm trong thư mục agent và `api` không bao giờ phân tích giá trị của chúng ([12](../12-auth-and-domains.md#luồng-credentials)).
- **Quyết định.**
  - Agent xuất bản qua các helper `contoso`: `start_report`, `publish_report`, `fail_report` và `publish_dataset`. `api` kiểm tra và lưu những gì chúng gửi, thuộc về người dùng.
  - Một phiên bản báo cáo là report schema v1 cộng artifact và evidence, và không bao giờ thay đổi sau khi xuất bản.
  - Dashboard nghiệp vụ đọc dataset `dashboard` mới nhất, do một agent (thường là `data`) xuất bản khi người dùng yêu cầu, hoặc từ một lịch chạy người dùng tạo. Trình duyệt tính KPI từ đó bằng các hàm có sẵn, đã được test, trong `features/dashboard/model`.
- **Đã loại.**
  - `api` truy vấn kho dữ liệu: nó sẽ cần credentials của miền, phá vỡ quy tắc chỉ code của agent thấy chúng.
  - Tính dashboard trong `api`: sẽ nhân đôi quy tắc frontend và test của chúng sang Python khi chưa cần.
  - Chỉ giữ báo cáo dưới dạng tệp đính kèm trong chat: không có phiên bản, không tìm kiếm, không trình xem.
- **Hệ quả.** Báo cáo và dashboard chỉ mới bằng mức agent cập nhật chúng. Toàn bộ dataset được gửi tới trình duyệt, nên bị giới hạn 20 MB. Quy tắc schema tồn tại hai nơi, trong phần kiểm tra của `api` và bộ decode của frontend ([99](../99-risks-and-future-work.md)). Xem [19](../19-reports-dashboard-notifications.md).
