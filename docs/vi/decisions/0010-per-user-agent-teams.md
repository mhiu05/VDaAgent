# 0010 · Mỗi người dùng có nhóm agent riêng

- **Bối cảnh.** grokbot có một phiên chính và một thư mục cho mỗi agent. Tự cải thiện nên học sở thích của một người.
- **Quyết định.** Miền cung cấp bộ credentials và agent mẫu. Mỗi người dùng nhận bản sao riêng của mọi agent (thư mục, phiên, lead và hàng đợi). Mỗi người dùng thuộc đúng một miền.
- **Đã loại.**
  - Một nhóm dùng chung cho mỗi miền: người dùng chờ lẫn nhau, trí nhớ trộn lẫn giữa người dùng, và lịch sử của từng người chỉ còn là một góc nhìn lọc từ một context chung.
  - Thư mục miền dùng chung cộng lớp riêng của từng người: cần quy tắc merge giữa các lớp.
- **Hệ quả.** Chi phí tăng theo số người dùng × số agent, được chặn bởi `MAX_AGENTS_PER_USER`. Cô lập giữa người dùng thì đơn giản. Xem [12](../12-auth-and-domains.md).
