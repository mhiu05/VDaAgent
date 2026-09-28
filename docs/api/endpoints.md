# Nhóm endpoint chính

Mọi path bên dưới có prefix `/api/v1`. Bảng này là bản đồ nghiệp vụ; Zod schemas trong `@vda/contracts` là nguồn định nghĩa payload chi tiết.

| Nhóm | Endpoint quan trọng | Vai trò |
| --- | --- | --- |
| Session/workspace | `GET /setup`, `POST /auth/login`, `POST /auth/logout`, `GET /session`, `GET /catalog`, `GET /workspace-summary` | Cấu hình, identity, scope có thể chọn |
| Conversation | `GET/POST /conversations`, `GET /conversations/{id}`, `GET/POST /conversations/{id}/messages`, `GET/PUT /conversations/{id}/context`, `GET /conversations/{id}/memory` | Lịch sử, turn, context và memory |
| Durable turn | `GET /agent-turn-jobs/{id}`, `GET /agent-turn-jobs/{id}/events`, `POST /agent-turn-jobs/{id}/cancel` | Theo dõi/hủy job; POST turn trả `agent_turn_job_id` khi admission phù hợp |
| Analysis | `POST /analyses`, `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/artifacts`, `GET /runs/{id}/workflow-status`, `GET /runs/{id}/runtime`, `GET /runs/{id}/events`, `POST /runs/{id}/cancel` | Tạo và quan sát run |
| Result | `GET /runs/{id}/brief`, `GET /runs/{id}/decision-intelligence` | Projection đã validate, có thể trả 404 nếu chưa có |
| Dataset | `GET/POST /imports` | Danh sách và nhập CSV `csv-v1` |
| Report | `GET /reports`, `GET /reports/{id}`, `POST /reports/{id}/exports`, `GET /reports/{id}/download?token=…` | Báo cáo đã publish nội bộ và export JSON/CSV |
| Automation | `GET/POST /report-definitions`, `PATCH/DELETE /report-definitions/{id}`, `POST /report-definitions/{id}/trigger`, `POST /scheduler/tick` | Quản lý lịch và enqueue occurrence |

`POST /analyses` cần `Idempotency-Key` và `AnalysisRequest` gồm `org_id`, scope, `data_as_of`, question; response `202` có `run_id`, `conversation_id`, status. POST conversation/message cũng cần key và `AgentTurnRequest`; response `202` có message IDs, run ID nếu tạo và job ID nếu durable. `POST /imports` nhận `org_id`, `source_name`, chuỗi CSV và trả manifest `201`. Report export nhận format `json|csv`, trả URL download có hạn khoảng 5 phút; tải lại vẫn kiểm user và report. `GET /runs/{id}/events` và turn-job events cần `Accept: text/event-stream`.

Các route POST stream hội thoại cũ (`/conversations/stream`, `/conversations/{id}/messages/stream`) chỉ khả dụng theo feature flags; xem [streaming](streaming.md). Không thấy endpoint public để cài skill, đăng ký MCP server, hay quản lý membership.

Code: `src/frontend/src/server/api/routes`, `src/backend/packages/contracts/src`. Xem [overview](overview.md), [authentication](authentication.md).
