# 0016 · Thay đổi từ builder: báo ngay, áp dụng đầy đủ ở điểm an toàn

- **Bối cảnh.** System prompt được render một lần mỗi epoch để giữ prefix cache ([0005](0005-append-only-context-during-a-task.md)), nhưng người dùng mong việc sửa prompt có hiệu lực.
- **Quyết định.** Mọi thay đổi từ builder ghi vào thư mục, commit dưới tên `user:<username>`, và nối một notice mô tả thay đổi (unified diff khi sửa prompt). Sửa prompt còn khiến compaction chuyển sang chờ, nên điểm an toàn kế tiếp mở epoch mới với prompt mới được render đầy đủ.
- **Đã loại.**
  - Chỉ áp dụng ở lần compaction tự nhiên kế tiếp: có thể là vài ngày sau.
  - Mở epoch mới mà không compaction: mất lịch sử kể từ lần compaction trước.
- **Hệ quả.** Hành vi đổi ngay khi agent đọc notice, và không làm hỏng cache giữa task. Xem [05](../05-agent-builder.md#sửa-prompt).
