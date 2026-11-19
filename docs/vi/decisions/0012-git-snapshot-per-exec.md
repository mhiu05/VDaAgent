# 0012 · Snapshot git sau mỗi lần chạy

- **Bối cảnh.** Trình xem thư mục cho thấy agent biết gì lúc này, nhưng không cho thấy tự cải thiện đã diễn ra thế nào: bước nào sửa trí nhớ, ai đã thêm kỹ năng.
- **Quyết định.**
  - Mỗi thư mục agent là một git repository. Sau mỗi exec, `execd` chạy `git add -A`, kiểm tra `git diff --cached --quiet`, và chỉ commit khi có thay đổi, với tác giả `agent:<slug>`, `user:<username>` hoặc `contoso-harness`.
  - `tool_result` lưu `head` và `changed`, kể cả khi không có thay đổi.
  - Snapshot lỗi không bao giờ làm exec lỗi.
  - `baseline_commit` cho phép khôi phục.
- **Đã loại.** Danh sách đường dẫn thay đổi dựa trên mtime: không có diff, không có phiên bản cũ, và không có mốc để khôi phục.
- **Hệ quả.** Khoảng 20–50 ms mỗi exec. Số commit tăng dần, và gộp commit là việc sau này. Xem [04](../04-agent-folder.md#snapshot-git).
