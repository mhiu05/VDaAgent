# 0019 · Thử lại có backoff thay vì giới hạn số lời gọi LLM đồng thời

- **Bối cảnh.** Mọi lời gọi model dùng chung một key OpenRouter. Lúc dồn dập (nhiều người dùng × agent, lịch chạy cùng tới hạn) có thể gặp 429.
- **Quyết định.** Không dùng semaphore giới hạn đồng thời. Response 429 và 5xx, cùng timeout, được thử lại 3 lần với backoff luỹ thừa (2, 4, 8 s, cộng ngẫu nhiên), tôn trọng `Retry-After`. Khi hết lượt thử, harness nối một event `error` và agent chuyển sang rảnh.
- **Đã loại.** Semaphore toàn cục `MAX_CONCURRENT_LLM`: không cần về mặt kỹ thuật ở quy mô PoC, và sẽ thêm độ trễ xếp hàng ở mọi nơi.
- **Hệ quả.** Khi tải nặng, agent gặp lỗi `model_unavailable` thay vì chờ. Giới hạn và ngân sách theo người dùng là việc sau này. Xem [03](../03-agent-loop.md#gọi-model).
