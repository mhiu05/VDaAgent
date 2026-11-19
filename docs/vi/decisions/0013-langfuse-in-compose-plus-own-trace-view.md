# 0013 · Langfuse trong compose cộng chế độ xem trace riêng

- **Bối cảnh.** Việc giám sát lời gọi LLM (chi phí, token, độ trễ, tìm kiếm) nên giao cho một công cụ đã có sẵn, nhưng vẫn phải xem được từ stack compose của chúng ta. Ta cũng cần một chế độ xem mà không công cụ LLM nào có: lịch sử của một agent dưới dạng chat, hiện mọi hành động và các trigger từ agent và người dùng khác.
- **Quyết định.**
  - Chạy Langfuse v4 (web, worker, ClickHouse, Redis, MinIO) trong stack compose, dùng chung server Postgres.
  - Gửi trace bằng instrumentation viết tay với SDK v5, mỗi activation một trace, dùng `trace_id` của chúng ta. Input của generation là phần chênh lệch, và chi phí lấy từ OpenRouter.
  - Tự xây chế độ xem trace dạng chat từ các bảng của chúng ta, và liên kết sâu từng activation sang Langfuse.
- **Đã loại.**
  - Tự xây UI kiểu Langfuse: thành ra tự viết phần mềm giám sát.
  - Arize Phoenix: nhẹ hơn, nhưng là một sản phẩm khác với cái được yêu cầu.
  - Drop-in `langfuse.openai`: nó ghi toàn bộ context và định giá theo bảng riêng.
  - Chỉ dùng Langfuse làm nguồn cho chế độ xem chat: nó không liên kết được các trace, và chế độ xem sẽ hỏng mỗi khi Langfuse không chạy.
- **Hệ quả.** Thêm năm container. Hai chế độ xem độc lập với nhau. Xem [13](../13-observability.md).
