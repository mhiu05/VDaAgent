# 0022 · UI từ frontend đã xây dựng, UX từ đặc tả

- **Bối cảnh.** Có hai nguồn mô tả frontend:
  - frontend đã xây dựng trong repo này, chạy trên mock service và có hệ thống hình ảnh riêng;
  - đặc tả PoC, định nghĩa các luồng của sản phẩm và giao diện kiểu Zalo/Telegram.

  Hai nguồn khác nhau về stack, giao diện, route, bố cục chat và mô hình agent.
- **Quyết định.**
  - **Phần nhìn lấy từ frontend đã xây dựng.** Gồm design token, component, overlay Radix, Be Vietnam Pro, icon Lucide, chuyển động GSAP, bộ render biểu đồ SVG, tuỳ chọn mật độ và giảm chuyển động, và stack (React 19, CSS thuần, i18next).
  - **Hành vi lấy từ đặc tả.** Gồm route và trang đích, đăng nhập bằng username, nhóm agent (lead, agent mẫu và agent do người dùng tạo), chat ba khung với dòng trạng thái, banner task, lựa chọn và khung thông tin, builder, trình xem thư mục, các trang admin, SSE và nút đổi giao diện trên header.
  - Các trang workspace chỉ frontend đã xây dựng có thì được giữ, với backend mô tả ở [19](../19-reports-dashboard-notifications.md).
- **Đã loại.**
  - Dùng stack và bảng màu của đặc tả (React 18, Tailwind, shadcn/ui, TanStack Query, token Zalo/Telegram): nghĩa là viết lại UI đang chạy và đã được test.
  - Giữ chat đã xây dựng làm đích: nó được thiết kế quanh agent cố định, capability và streaming, không khớp với harness.
- **Hệ quả.** Chat, đăng nhập và trang người dùng admin phải thay đổi để đạt đích. [14](../14-frontend.md#hiện-trạng-so-với-mục-tiêu) liệt kê mọi khác biệt.
