# 0003 · Lịch chạy chỉ chạy khi chủ sở hữu rảnh

- **Bối cảnh.** Lịch chạy thuộc về từng agent, trong khi việc toàn cục của mỗi người dùng chạy tuần tự.
- **Quyết định.** Lịch chạy chạy trong phiên chính của chủ sở hữu khi chủ sở hữu rảnh. Tin đến trong lúc đó theo quy tắc thông báo bình thường. Mỗi lịch có tối đa một lần đang chờ.
- **Đã loại.**
  - Lịch chạy là task toàn cục: phải chờ sau cả hàng đợi, trải nghiệm tệ.
  - Dùng nhánh git của thư mục agent: phải merge cả context lẫn thư mục.
  - Sub-agent chỉ đọc: quy tắc phân quyền, vùng nháp, sao chép tin ngược lại, và hai giọng nói cho một agent.
  - Harness tạm dừng lịch khi có tin đến: thêm một cơ chế mới, và việc bị dừng trộn lẫn vào context.
- **Hệ quả.** Lịch chạy có thể bị bỏ đói nếu chủ sở hữu không bao giờ rảnh ([99](../99-risks-and-future-work.md)). Xem [09](../09-routines.md).
