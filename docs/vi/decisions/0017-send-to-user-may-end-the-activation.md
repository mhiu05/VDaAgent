# 0017 · `send_to_user` có thể kết thúc activation

- **Bối cảnh.** Hầu hết câu trả lời kết thúc bằng "gửi câu trả lời rồi dừng". Một lần gọi model riêng chỉ để nói Done tốn độ trễ và token.
- **Quyết định.** `send_to_user(..., final=True)` đánh dấu exec là bước cuối. Nếu exec thoát với mã 0, harness nối `tool_result` và agent chuyển sang rảnh mà không gọi model thêm. Nếu code lỗi sau khi gửi, cờ bị bỏ qua. Input kế tiếp đi ngay sau message `tool` dưới dạng một message `user`, và một test hợp đồng live kiểm tra rằng nhà cung cấp chấp nhận cấu trúc này.
- **Đã loại.**
  - Luôn bắt buộc một lượt model cuối: phí một lời gọi cho mỗi câu trả lời.
  - `final` cho `send_to_agent`: bên gửi thường chờ trả lời.
- **Hệ quả.** Nếu một nhà cung cấp từ chối cấu trúc message này, phương án dự phòng là render một lượt cố định `assistant: (done)`, không bao giờ được lưu như output của model. Xem [03](../03-agent-loop.md#vòng-lặp-bước).
