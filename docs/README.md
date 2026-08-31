# Tài liệu kỹ thuật VDaAgent (P-170)

Bộ tài liệu này mô tả implementation đang có trong repository, không phải roadmap. Nếu tài liệu khác code, hãy ưu tiên route/model, service, migration, test và workflow triển khai, sau đó cập nhật lại trang gần implementation nhất.

## Lộ trình đọc

| Nhu cầu | Bắt đầu tại |
| --- | --- |
| Hiểu hệ thống và data flow | [Tổng quan hệ thống](./architecture/system-overview.md) |
| Chạy dự án local | [Phát triển và kiểm thử local](./development/local-development-and-testing.md) |
| Hiểu queue/worker profiling | [Profiling Job bất đồng bộ](./architecture/async-profiling-jobs.md) |
| Hiểu chart Preview/Official | [Phân tích có giới hạn](./architecture/bounded-execution.md) |
| Hiểu QA, tool, retrieval và trace | [Agent system](./architecture/agent-system.md) |
| Vận hành database | [Database migrations](./operations/database-migrations.md) |
| Triển khai Azure | [Deployment](./operations/deployment.md) |
| Xem giới hạn/known gaps hiện tại | [Tóm tắt bàn giao](./summary.md) |

## Kiến trúc

- [Tổng quan hệ thống](./architecture/system-overview.md) — process, dependency, trust boundary và mô hình dữ liệu.
- [Profiling Job bất đồng bộ](./architecture/async-profiling-jobs.md) — enqueue, lease, retry, resume và SSE projection.
- [Phân tích có giới hạn](./architecture/bounded-execution.md) — QuerySpec, planner, Preview, Official và quality gate.
- [Agent system](./architecture/agent-system.md) — LangGraph, native skills, QA routing, deterministic evidence validation, retrieval và trace.
- [Report Draft và snapshot](./architecture/report-draft-snapshots.md) — optimistic edit, snapshot hash và export source.

## Chức năng

- [Dataset và profiling](./features/datasets-and-profiling.md)
- [Connector và storage](./features/connectors-and-storage.md)
- [Command Center](./features/command-center.md)
- [QA và evidence](./features/qa-and-evidence.md)
- [So sánh drift](./features/drift-comparison.md)
- [Report](./features/reports.md)
- [Workspace và quản trị](./features/workspaces-and-admin.md)

## Bảo mật

- [Authentication và authorization](./security/authentication-and-authorization.md)
- [Cô lập workspace, Data API và privacy](./security/workspace-isolation-and-privacy.md)

## Vận hành

- [Cấu hình](./operations/configuration.md)
- [Database migrations](./operations/database-migrations.md)
- [Quan sát và phục hồi lỗi](./operations/observability-and-failure-recovery.md)
- [Triển khai Azure](./operations/deployment.md)

## Phát triển và đánh giá

- [Phát triển và kiểm thử local](./development/local-development-and-testing.md)
- [Evaluation và release evidence](./development/evaluation.md)

## Bề mặt runtime

Tất cả router nghiệp vụ được mount dưới `/api/v1`. Backend health là `/health` ngoài prefix; OpenAPI/Redoc bị tắt ở production.

| Nhóm | Module | Entry point tiêu biểu |
| --- | --- | --- |
| Dataset, profile, QA, drift | `api/routes.py` | `/datasets`, `/profile`, `/profiling-jobs`, `/qa`, `/profile/{run_id}/drift` |
| Command Center | `api/analysis_routes.py` | `/analysis-sessions`, `/profile/{run_id}/explorer/*`, `/profile/{run_id}/charts/*` |
| Workspace, report | `api/authz_routes.py` | `/session`, `/workspace-bootstrap`, `/workspaces`, `/reports`, `/dashboard` |
| Connector | `api/connector_routes.py` | `/connectors`, datasource create/test/update/delete |
| Google Drive | `api/google_drive_routes.py` | status, connect, callback và disconnect |
| Agent runtime | `api/agent_routes.py` | run, trace, evidence, plan và trace summary |
| Native agent skills | `api/skill_routes.py` | catalog, detail và inspect tool bundle |
| System Admin | `api/admin_routes.py` | list/create/lock/role/delete user |
| Local MCP | `mcp_server.py` | stdio tools cho profile, chart plan, Preview và Official |

Không dùng bảng này làm OpenAPI thay thế. Limit field, status transition, permission và error chi tiết nằm trong schema/route và các trang feature tương ứng.

## Quy ước nguồn sự thật

- REST/SSE: `backend/src/api/`, `backend/src/models/`.
- Persistence: `backend/src/services/repository.py`, `backend/migrations/`.
- Agent/tool/evidence: `backend/src/agents/`, `backend/src/services/qa_validation.py`.
- Frontend: `frontend/src/app/`, `frontend/src/components/`, `frontend/src/lib/`.
- Runtime/release: `config.yaml`, `backend/src/config.py`, `.env.example`, Dockerfile và `.github/workflows/`.
- Evaluation: `tests/evaluations/` là source harness; `evaluations/` chỉ là artifact đã sinh.

[README root](../README.md) dành cho onboarding; [ARCHITECTURE.md](../ARCHITECTURE.md) là bản đồ cấp cao; [summary.md](./summary.md) là snapshot bàn giao và known-gap register.
