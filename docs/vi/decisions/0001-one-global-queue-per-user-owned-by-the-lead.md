# 0001 · Mỗi người dùng một hàng đợi task toàn cục, do lead sở hữu

- **Bối cảnh.** Nhiều agent cần phối hợp ổn định, và mỗi người dùng có nhóm agent riêng ([0010](0010-per-user-agent-teams.md)).
- **Quyết định.** Mỗi người dùng có một hàng đợi FIFO, chỉ lead của người đó điều khiển, với tối đa một task toàn cục đang chạy cho mỗi người dùng. jev chỉ phân loại tin gửi tới lead. Mọi agent khác nhận thông báo, và nhờ lead xếp hàng việc mới. Một partial unique index cưỡng chế việc mỗi người dùng chỉ có một task đang chạy.
- **Đã loại.**
  - jev của bất kỳ agent nào cũng tạo task: sự giúp đỡ cần giữa task sẽ bị xếp sau chính task cần nó, gây deadlock.
  - Danh sách việc riêng của từng agent trong task hiện tại: thêm một tầng lập lịch thứ hai.
  - Một hàng đợi chung cho mọi người dùng: người dùng phải chờ lẫn nhau.
- **Hệ quả.** Các người dùng chạy song song, còn việc của từng người dùng chạy tuần tự. Xem [07](../07-routing-and-queue.md#hàng-đợi-task-toàn-cục).
