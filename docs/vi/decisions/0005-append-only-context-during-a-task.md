# 0005 · Context chỉ nối thêm trong lúc task chạy

- **Bối cảnh.** Sửa phần đầu của context làm mất prefix cache từ điểm đó trở đi.
- **Quyết định.**
  - Lưu đúng text đã render của mỗi event, và không bao giờ render lại.
  - Render system prompt một lần mỗi epoch.
  - Offload output lớn ngay khi tới, dự phòng bằng một lần offload hàng loạt, và cho task thất bại nếu context vẫn vượt giới hạn.
  - Thay đổi từ builder tới agent dưới dạng notice nối thêm ([0016](0016-builder-edits-notify-then-apply-at-a-safe-point.md)).
- **Đã loại.**
  - Viết lại output cũ mỗi lượt: mất cache liên tục.
  - Đặt `current_state` trong system prompt: mất cache mỗi lượt.
  - Render lại system prompt mỗi khi thư mục thay đổi.
- **Hệ quả.** Cache chỉ bị đặt lại ở epoch mới và khi offload hàng loạt. Xem [06](../06-context-and-compaction.md).
