# 0006 · Một tiến trình `api` chứa cả HTTP API và harness

- **Bối cảnh.** Harness cần runner cho agent, jev, hàng đợi và bộ lập lịch. PoC cần ít thành phần.
- **Quyết định.** Một tiến trình asyncio chạy FastAPI, supervisor với một `AgentRunner` cho mỗi agent, jev, bộ lập lịch, worker job và event bus trong tiến trình. Mọi trạng thái nằm trong Postgres và các thư mục; bộ nhớ chỉ là cache.
- **Đã loại.**
  - Tách service `api` và `harness`, nối qua `LISTEN/NOTIFY` của Postgres và lease: thêm khoảng một phần ba công việc cho harness, mà không chứng minh thêm được gì trong PoC.
  - Đặt harness trong container `workspace`: key OpenRouter và credentials DB sẽ nằm cạnh code do model viết.
- **Hệ quả.** Một tiến trình giới hạn khả năng mở rộng. Ranh giới HTTP `api` ↔ `workspace` là hợp đồng mạng duy nhất, nên tách sau này chỉ là thay đổi cách triển khai. Xem [02](../02-architecture.md).
