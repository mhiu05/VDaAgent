# 0002 · jev đọc góc nhìn của người nhận

- **Bối cảnh.** jev cần đúng context, và dựng context riêng cho từng loại kênh thì không mở rộng được.
- **Quyết định.** Một bộ dựng context duy nhất: `current_state`, tóm tắt và `JEV_K` message event gần nhất của người nhận, cộng tin nhắn. Mọi quyết định được lưu ở `jev_decisions` để sau này so sánh các chính sách.
- **Đã loại.**
  - Quy tắc context theo từng kênh.
  - Chỉ dùng log của hội thoại: không thấy được task hiện tại.
  - Không có bộ phân loại, agent tự phân loại mọi tin: mỗi tin tốn một lượt model đầy đủ, và phải chờ khối công việc hiện tại xong.
- **Hệ quả.** Phần còn lại của hệ thống chỉ phụ thuộc nhãn của jev, nên chính sách đổi tự do được. Xem [07](../07-routing-and-queue.md#jev).
