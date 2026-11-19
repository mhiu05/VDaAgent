# 0011 · Lead có sẵn và agent do người dùng tạo

- **Bối cảnh.** Người dùng cần tự xây được agent, nhưng jev và hàng đợi toàn cục cần đúng một lead cho mỗi người dùng.
- **Quyết định.**
  - Mỗi người dùng nhận một lead có sẵn (slug `lead`, "Điều phối") không xoá được. Quy tắc nền tảng của nó cố định; prompt vai trò lấy từ `starters/lead/prompt.md` của miền hoặc `platform/lead/prompt.md`, và người dùng sửa được.
  - Mọi agent khác (agent mẫu và agent tự tạo) không phải lead, và được tạo, tuỳ biến trong builder.
  - `domain.yaml` không chứa danh sách agent hay lead.
- **Đã loại.**
  - Người dùng chọn agent bất kỳ làm lead: cần quy tắc chuyển đổi, và phải từ chối khi đang có task xếp hàng.
  - Không có lead cho tới khi người dùng tạo: trải nghiệm lần đầu trống rỗng, và không có hàng đợi.
- **Hệ quả.** Người dùng mới chat được ngay, và hàng đợi luôn có chủ. Xem [04](../04-agent-folder.md#tạo-agent) và [05](../05-agent-builder.md).
