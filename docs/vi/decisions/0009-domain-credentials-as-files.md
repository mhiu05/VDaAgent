# 0009 · Credentials của miền là file, gắn vào agent theo bộ

- **Bối cảnh.** Mỗi miền có credentials dữ liệu riêng (DSN kho, key tìm kiếm). Người dùng có thể tự tạo agent, nên credentials không thể gắn với các thư mục template cố định.
- **Quyết định.**
  - Credentials nằm ở `domains/<domain>/credentials/<set>.env` (kèm `.env.example` được commit), được mount chỉ đọc, và gắn vào agent bằng symlink trong `.env.d/`.
  - `execd` nạp chúng vào môi trường của mỗi exec.
  - Tên key phải duy nhất giữa các bộ của cùng miền.
  - `api` không bao giờ parse giá trị, ngoài việc kiểm tra chúng không rỗng.
- **Đã loại.**
  - Mỗi template agent một `.env`: không dùng được cho agent người dùng tự tạo.
  - Mỗi miền một `.env`: mọi agent thấy mọi credentials.
  - Key có tiền tố trong `.env` gốc: một file khổng lồ, và gõ sai tiền tố sẽ âm thầm làm rơi credentials.
  - Lưu mã hoá trong DB, sửa trên UI: cần form, mã hoá và kiểm toán mà PoC không cần.
- **Hệ quả.** Đổi credentials chỉ là sửa một file, và có hiệu lực ở exec kế tiếp. Xem [12](../12-auth-and-domains.md#luồng-credentials).
