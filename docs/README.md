# Tài liệu kỹ thuật P-170

Đây là cổng tài liệu do implementation sở hữu của P-170. Nội dung mô tả hệ thống đang có trong repository, không phải roadmap. Nếu nội dung tài liệu khác với code, migration, test hoặc cấu hình triển khai, implementation là nguồn sự thật và cần ghi nhận chênh lệch trong [Điểm còn thiếu và ghi chú source of truth](./summary.md).

## Bắt đầu từ đây

| Câu hỏi | Tài liệu |
| --- | --- |
| Hiểu runtime và các ranh giới chính | [Tổng quan hệ thống](./architecture/system-overview.md) |
| Theo dõi một Profiling Job bất đồng bộ | [Profiling Job bất đồng bộ](./architecture/async-profiling-jobs.md) |
| Hiểu chart và execution an toàn | [Phân tích có giới hạn](./architecture/bounded-execution.md) |
| Hiểu LangGraph, QA và evidence | [Agent system](./architecture/agent-system.md) |
| Tạo hoặc review report | [Report Draft và snapshot](./architecture/report-draft-snapshots.md) và [Tính năng reports](./features/reports.md) |
| Chạy stack ở local | [Phát triển và kiểm thử local](./development/local-development-and-testing.md) |
| Cấu hình một môi trường | [Tham chiếu configuration](./operations/configuration.md) |
| Triển khai hoặc vận hành production | [Triển khai](./operations/deployment.md) và [Quan sát và phục hồi lỗi](./operations/observability-and-failure-recovery.md) |

## Kiến trúc

- [Tổng quan hệ thống](./architecture/system-overview.md) — process, dependency, request boundary và source map.
- [Profiling Job bất đồng bộ](./architecture/async-profiling-jobs.md) — PostgreSQL queue, lease, retry, recovery và SSE.
- [Phân tích có giới hạn](./architecture/bounded-execution.md) — QuerySpec, Preview/Official, limit, timeout và quality gate.
- [Agent system](./architecture/agent-system.md) — profiling graph, QA, retrieval, trace và evidence.
- [Report Draft và snapshot](./architecture/report-draft-snapshots.md) — draft có thể sửa, snapshot bất biến và lifecycle.

## Tính năng sản phẩm

- [Dataset và profiling](./features/datasets-and-profiling.md)
- [Command Center](./features/command-center.md)
- [QA và evidence](./features/qa-and-evidence.md)
- [So sánh drift](./features/drift-comparison.md)
- [Reports](./features/reports.md)
- [Connector và storage](./features/connectors-and-storage.md)
- [Workspace và quản trị](./features/workspaces-and-admin.md)

## Bảo mật

- [Authentication và authorization](./security/authentication-and-authorization.md)
- [Cô lập workspace và bảo vệ dữ liệu](./security/workspace-isolation-and-privacy.md)

## Vận hành

- [Cấu hình](./operations/configuration.md)
- [Quan sát và phục hồi lỗi](./operations/observability-and-failure-recovery.md)
- [Triển khai Azure](./operations/deployment.md)

## Phát triển và đánh giá

- [Phát triển và kiểm thử local](./development/local-development-and-testing.md)
- [Đánh giá](./development/evaluation.md)

## Tóm tắt API

Các router nghiệp vụ đều được mount dưới `/api/v1`. Hợp đồng đầy đủ do các route module sở hữu; các nhóm và entry point hiện tại là:

| Nhóm | Route module | Path tiêu biểu |
| --- | --- | --- |
| Dataset/profile/QA/drift | `backend/src/api/routes.py` | `/datasets`, `/profile`, `/profiling-jobs`, `/qa`, `/profile/{run_id}/drift` |
| Agent runtime | `backend/src/api/agent_routes.py` | `/agent-runs/{run_id}/trace`, `/evidence`, `/plan`, `/trace-summary` |
| Command Center | `backend/src/api/analysis_routes.py` | `/analysis-sessions`, `/profile/{run_id}/explorer/session`, `/profile/{run_id}/charts/auto-plan`, `/profile/{run_id}/charts/auto-profile-pack`, `/profile/{run_id}/explorer/previews` |
| Auth/workspace/report | `backend/src/api/authz_routes.py` | `/session`, `/workspace-bootstrap`, `/workspaces`, `/reports`, `/reports/{id}/snapshots`, các lifecycle endpoint |
| Connector | `backend/src/api/connector_routes.py` | `/connectors`, `/connectors/datasource`, các endpoint test connector |
| Google Drive | `backend/src/api/google_drive_routes.py` | `/google-drive/status`, `/connect`, `/callback`, `/connection` |
| System Admin | `backend/src/api/admin_routes.py` | `/admin/users`, đổi status/role/delete user |

Health check của backend là `/health` và nằm ngoài prefix `/api/v1`. Xem các trang tính năng để biết limit request, state transition và permission; không sao chép hành vi route vào bảng thứ hai.

## Quy ước sở hữu

- API contract do `backend/src/api/` và `backend/src/models/` sở hữu.
- Hình dạng persistence và lịch sử migration do `backend/src/services/repository.py` và `backend/migrations/` sở hữu.
- Agent state, tool, trace và evidence do `backend/src/agents/` sở hữu.
- Route và hành vi browser do `frontend/src/app/`, `frontend/src/components/` và `frontend/src/lib/` sở hữu.
- Default vận hành và validation do `config.yaml`, `backend/src/config.py`, `.env.example`, Dockerfile và `.github/workflows/` sở hữu.

[README](../README.md) ở root là entry point cho người mới. [ARCHITECTURE.md](../ARCHITECTURE.md) là chỉ mục kiến trúc ngắn. [summary.md](./summary.md) là handover snapshot và sổ đăng ký điểm còn thiếu.
