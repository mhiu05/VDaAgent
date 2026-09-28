# Skills trong repo

**Planned / placeholder.** Hiện không có registry, format, loader hoặc API để cài/nạp một “skill” như đơn vị thực thi độc lập. Không có bằng chứng rằng một skill được phát hiện tự động từ thư mục rồi cấp quyền cho agent trong production.

Điều đã có: `AgentDefinition` mô tả vai trò và tool allowlist; `ToolRegistry` chạy thao tác được kiểm schema; `use-cases.ts` mô tả use case; `McpGateway` là lớp kết nối tool tùy chọn. Chúng là các cơ chế khác nhau, không nên gọi chung là skill. Nếu workflow/use case được đóng gói thành skill sau này, tài liệu và quyền thực thi phải được cập nhật từ implementation lúc đó.

Code mapping: `src/backend/packages/agents/src/runtime/team/definitions.ts`, `src/backend/packages/agents/src/runtime/team/tools.ts`, `src/backend/packages/agents/src/use-cases.ts`, `src/backend/packages/agents/src/runtime/team/mcp-gateway.ts`. Xem [tools](tools.md).
