# 0008 · Một key OpenRouter của nền tảng, không BYOK

- **Bối cảnh.** jev chạy với mọi tin gửi tới lead và phải luôn hoạt động, nên không thể phụ thuộc việc người dùng có mang key hay không. Agent, compaction và jev đều cần truy cập model.
- **Quyết định.** Một `OPENROUTER_API_KEY` trong `.env` gốc phục vụ `AGENT_MODEL`, `JEV_MODEL` và `COMPACTION_MODEL`, qua client tương thích OpenAI. Credentials của miền là các file riêng ([0009](0009-domain-credentials-as-files.md)).
- **Đã loại.**
  - BYOK bắt buộc key của người dùng: người dùng không có key OpenRouter sẽ không dùng được jev.
  - BYOK có key dự phòng của miền: phải theo dõi chi phí của từng người, và thêm một đường credentials thứ hai.
  - LiteLLM làm lớp trừu tượng nhà cung cấp: không cần khi chỉ có một nhà cung cấp.
- **Hệ quả.** Nền tảng trả tiền cho mọi lời gọi; ngân sách theo người dùng là việc sau này. Xem [03](../03-agent-loop.md#gọi-model).
