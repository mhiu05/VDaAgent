# Bản đồ tài liệu

Tài liệu này mô tả codebase tại ngày 2026-09-26. Nhãn **Implemented**, **Partially implemented** và **Planned / placeholder** chỉ mức độ có thể kiểm chứng trong code; tính năng chịu ảnh hưởng của feature flag được ghi ngay tại trang liên quan. Đường dẫn code trong backtick bắt đầu từ root repo.

## Đọc theo mục tiêu

| Bạn muốn | Lộ trình |
| --- | --- |
| Mới tham gia | [README](../README.md) → [Product overview](product/overview.md) → [Core concepts](product/core-concepts.md) → [Architecture](../ARCHITECTURE.md) |
| Theo một request | [System flow](architecture/system-flow.md) → [Execution model](architecture/execution-model.md) → [Analysis workflow](workflows/analysis-workflow.md) |
| Làm backend | [Backend](architecture/backend.md) → [Data model](architecture/data-model.md) → [API](api/overview.md) → [Failure recovery](workflows/failure-recovery.md) |
| Làm frontend | [User flows](product/user-flows.md) → [Frontend](architecture/frontend.md) → [Streaming](api/streaming.md) |
| Làm agent | [Agents](agents/overview.md) → [Orchestration](agents/orchestration.md) → [Agent runtime](agents/agent-runtime.md) → [Evidence](agents/evidence-validation.md) |

## Danh mục

- **Product:** [overview](product/overview.md), [user flows](product/user-flows.md), [core concepts](product/core-concepts.md), [use cases](product/use-cases.md).
- **Architecture:** [overview](architecture/overview.md), [system flow](architecture/system-flow.md), [backend](architecture/backend.md), [frontend](architecture/frontend.md), [data model](architecture/data-model.md), [execution model](architecture/execution-model.md), [integrations](architecture/integrations.md), [security](architecture/security.md).
- **Agents:** [overview](agents/overview.md), [orchestration](agents/orchestration.md), [runtime](agents/agent-runtime.md), [context & memory](agents/context-memory.md), [tools](agents/tools.md), [skills](agents/skills.md), [evidence validation](agents/evidence-validation.md). Vai trò cụ thể: [Coordinator](agents/agents/orchestrator.md), [Data](agents/agents/data-agent.md), [Comparison](agents/agents/compare-agent.md), [Chart](agents/agents/chart-agent.md), [Analyst](agents/agents/analyst-agent.md), [Insight](agents/agents/insight-agent.md), [Report](agents/agents/report-agent.md), [Reviewer](agents/agents/reviewer-agent.md).
- **Workflows:** [overview](workflows/overview.md), [analysis](workflows/analysis-workflow.md), [report generation](workflows/report-generation.md), [dataset processing](workflows/dataset-processing.md), [failure recovery](workflows/failure-recovery.md).
- **Platform:** [workspace](platform/workspace.md), [datasets](platform/datasets.md), [reports](platform/reports.md), [artifacts](platform/artifacts.md), [automations](platform/automations.md), [permissions](platform/permissions.md).
- **API:** [overview](api/overview.md), [authentication](api/authentication.md), [endpoints](api/endpoints.md), [streaming](api/streaming.md), [errors](api/errors.md).

Tài liệu dữ liệu mock độc lập hiện có: [mapping Supabase](data/mock-data-supabase-mapping.md).
