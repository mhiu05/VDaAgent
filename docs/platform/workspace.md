# Workspace và conversation

**Status: Implemented.** `workspace` trong UI là mặt làm việc của một organization, không phải bảng workspace độc lập. Organization/membership tạo biên dữ liệu; session trả danh sách tổ chức và role để người dùng chọn. URL `/workspace`, `/chat`, `/runs`, `/reports`, `/data/imports`, `/automations` là các bề mặt của cùng ứng dụng Next.js.

Conversation giữ message history và `context` đang chọn: dataset refs, current run, active report/artifact. UI cho phép thay đổi context; repository kiểm lại mọi reference theo tổ chức và quyền trước khi runtime dùng. Một conversation có thể có nhiều run; scheduled run có thể tạo conversation loại `scheduled`. Refresh UI tải lại session, conversation, job/run và event từ API.

Workspace là phạm vi làm việc; thread context là lựa chọn hiện tại; memory là tóm tắt agent đã persist; chúng không đồng nghĩa. Không thấy mô hình nhiều workspace tùy ý trong cùng một organization.

Code: `src/frontend/features/workspace/workspace.tsx`, `src/frontend/features/agent-workspace/components/agent-workspace.tsx`, `src/backend/database/repositories/workspace-repository.ts`, `src/backend/database/repositories/conversation-repository.ts`. Xem [core concepts](../product/core-concepts.md) và [permissions](permissions.md).
