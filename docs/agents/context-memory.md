# Context và memory

**Message history** là các message đã lưu trong conversation. **Thread context** là lựa chọn đang hoạt động (`dataset_ids`, current run, active report/artifact và refs). **Invocation context** là projection được tạo riêng cho tác vụ, gồm câu hỏi, quyền, message gần đây, refs, memory và tool allowlist; nó có giới hạn token và không cấp quyền mới. **Memory** là tóm tắt đã persist trong `agent_memory`, tách khỏi message history và artifact gốc.

`ContextResolver` ưu tiên refs của message, selection của workspace, reply rồi thread context. Mỗi ref được repository xác thực lại; chọn ref không tự tạo quyền truy cập. Team context lấy tối đa 12 message gần đây, memory có 3 layer: `working` theo run, `episodic` theo conversation, `workspace` cho kiến thức schema/tổ chức. Retriever chọn tối đa 8 entry trong ngân sách mặc định 1.600 token, cân bằng các layer; không dùng vector service.

`working` có thể sinh từ tool activity, `episodic` từ report, `workspace` được làm mới từ schema semantic khi tạo run. Các entry là dữ liệu tham khảo, không phải instruction đáng tin; context builder tách instruction hierarchy và gắn nhãn retrieved context là data. Persistent state còn gồm run/task/artifact/report và không được gọi chung là memory.

Code mapping: `src/backend/agents/runtime/context/resolver.ts`, `src/backend/agents/runtime/context/team-context.ts`, `src/backend/agents/runtime/context/memory.ts`, `src/backend/database/repositories/workspace-repository.ts`. Xem [core concepts](../product/core-concepts.md).
