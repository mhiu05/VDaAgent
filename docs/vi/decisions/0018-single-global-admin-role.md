# 0018 · Một vai trò admin toàn cục duy nhất

- **Bối cảnh.** Admin cần dashboard quan sát và quản lý người dùng. Với người dùng thường, các miền phải tách biệt.
- **Quyết định.** Có hai vai trò: `user` (đúng một miền) và `admin` (không có miền, thấy mọi thứ, không có nhóm agent). Chỉ admin vào được `/api/admin/*` và có đăng nhập Langfuse.
- **Đã loại.**
  - Admin theo miền cộng superadmin: mọi truy vấn dashboard phải lọc theo miền, và cần một project Langfuse cho mỗi miền, việc headless init không làm được.
  - Admin là cờ bên trong miền: không có góc nhìn xuyên miền.
- **Hệ quả.** Mọi admin thấy dữ liệu của mọi miền. Admin theo miền là việc sau này. Xem [12](../12-auth-and-domains.md#vai-trò-và-phân-quyền).
