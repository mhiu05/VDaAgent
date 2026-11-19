# 0021 · UI tiếng Việt và tiếng Anh

- **Bối cảnh.** Đặc tả PoC dự kiến UI chỉ tiếng Việt, một từ điển và không framework i18n. Frontend thực tế đã xây dựng dùng i18next với tiếng Việt và tiếng Anh, cùng định dạng số và ngày theo locale.
- **Quyết định.** Giữ cả hai ngôn ngữ; tiếng Việt là mặc định. Locale là một tuỳ chọn của người dùng ([19](../19-reports-dashboard-notifications.md#tùy-chọn-cá-nhân)). Nó chỉ đổi nhãn điều khiển và định dạng. Tin nhắn của agent, báo cáo đã lưu và nội dung demo cố định giữ ngôn ngữ lúc được viết. Mẫu thông báo người dùng (user notification) có cả hai ngôn ngữ. `message` lỗi của API vẫn bằng tiếng Việt, nhưng UI hiện text riêng cho từng mã lỗi.
- **Đã loại.** Bỏ tiếng Anh để khớp đặc tả: vứt bỏ code và test đang chạy mà không được gì.
- **Hệ quả.** Mỗi chuỗi UI mới cần cả hai bản dịch. Agent vẫn trả lời bằng tiếng Việt trừ khi người dùng yêu cầu khác. Xem [14](../14-frontend.md#ngôn-ngữ).
