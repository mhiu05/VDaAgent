# 0015 · Preset thư viện là trình cài một lần

- **Bối cảnh.** Người dùng không chuyên kỹ thuật cần cách dễ để cài thư viện Python, ví dụ "Phân tích dữ liệu" cho pandas và các thư viện đi kèm. Agent cũng tự chạy `uv add`.
- **Quyết định.** Preset là một danh sách package được seed. Chọn preset sẽ chạy `uv add <packages>` một lần, và không có gì ghi lại rằng preset đã được dùng. Danh sách package đã cài được đọc trực tiếp từ `pyproject.toml`, và package được gỡ từng cái một.
- **Đã loại.**
  - Trạng thái preset suy ra từ `pyproject.toml`, kèm gỡ thông minh: phức tạp, và có thể gỡ package mà agent đang cần.
  - Lưu lựa chọn preset trong DB: một nguồn sự thật thứ hai, lệch đi mỗi khi agent tự chạy `uv add`.
- **Hệ quả.** Đơn giản và lặp lại an toàn. Hoàn tác một preset nghĩa là gỡ từng package của nó. Xem [05](../05-agent-builder.md#thư-viện).
