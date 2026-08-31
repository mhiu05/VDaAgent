# Chỉ mục kiến trúc P-170

File này là mô tả kiến trúc cấp cao và ổn định. Hợp đồng chi tiết nằm trong [docs/](docs/README.md) và do các path implementation tương ứng sở hữu.

## Hình dạng kiến trúc

```text
Next.js browser ── REST/SSE /api/v1 ── FastAPI
       │                                  ├─ boundary auth/workspace/capability
       │                                  ├─ API dataset/profile/QA/drift/export
       │                                  ├─ Command Center và execution có giới hạn
       │                                  ├─ Report Draft/snapshot/lifecycle
       │                                  └─ service connector và agent
       │                                  ├─ PostgreSQL (metadata, queue, report,
       │                                  │  audit, retrieval, LangGraph checkpoint)
       │                                  ├─ storage đã cấu hình (Supabase/Drive/local)
       │                                  └─ LLM và embedding provider
       └─ Next server PDF route ──────────┘

Profiling Worker ── claim/heartbeat ── PostgreSQL queue
                 └─ DuckDB/pandas compute có giới hạn ── Profile Run đã lưu
```

Hệ thống theo evidence-first, scope theo workspace, execution có giới hạn, profiling work có persistence bền vững và fail-closed cho các setting production/security-sensitive. PostgreSQL là bắt buộc ở mọi môi trường; SQLite không phải fallback được hỗ trợ.

## Các ranh giới chính

- **Identity:** production yêu cầu Supabase JWT verification. `AUTH_MODE=dual` ở development/test và guest là các compatibility path do configuration điều khiển.
- **Tenant:** `X-Workspace-Id` được kiểm tra với membership đang active trước khi truy cập repository. System Admin là context riêng, không phải workspace superuser.
- **Compute:** source read và analysis đi qua profiling/QuerySpec có giới hạn; agent và browser không được dùng arbitrary SQL/Python.
- **Async:** profile request đưa job vào PostgreSQL queue; worker claim lease, heartbeat, retry và recover stale work.
- **Evidence:** factual claim trong answer/report phải trỏ tới profile fact đã lưu, Official execution hoặc typed retrieval source. Report vẫn cho phép note thủ công, nhưng note không trở thành quantitative evidence.
- **Report:** Report Draft có thể thay đổi được tách khỏi snapshot đã hash và dùng cho export.
- **Privacy:** raw data và credential ở server/provider; PII được mask hoặc reject tùy operation.

## Tài liệu thiết kế chi tiết

- [Tổng quan hệ thống](docs/architecture/system-overview.md)
- [Profiling Job bất đồng bộ](docs/architecture/async-profiling-jobs.md)
- [Phân tích có giới hạn](docs/architecture/bounded-execution.md)
- [Agent system](docs/architecture/agent-system.md)
- [Report Draft và snapshot](docs/architecture/report-draft-snapshots.md)
- [Cô lập workspace](docs/security/workspace-isolation-and-privacy.md)
- [Cấu hình và triển khai](docs/operations/configuration.md) · [Triển khai Azure](docs/operations/deployment.md)

## Bản đồ mã nguồn

| Boundary | Nguồn sự thật |
| --- | --- |
| FastAPI app/middleware/error | [`backend/src/main.py`](backend/src/main.py) |
| API route và Pydantic contract | [`backend/src/api/`](backend/src/api/) và [`backend/src/models/`](backend/src/models/) |
| Agent graph/tool/trace | [`backend/src/agents/`](backend/src/agents/) |
| Profiling/analysis/connector/report | [`backend/src/services/`](backend/src/services/) |
| Hình dạng PostgreSQL | [`backend/src/services/repository.py`](backend/src/services/repository.py) và [`backend/migrations/`](backend/migrations/) |
| Hành vi browser | [`frontend/src/app/`](frontend/src/app/), [`frontend/src/components/`](frontend/src/components/), [`frontend/src/lib/`](frontend/src/lib/) |
| Runtime default và release | [`config.yaml`](config.yaml), [`backend/src/config.py`](backend/src/config.py), [workflow](.github/workflows/azure-container-deploy.yml) |

## Kỷ luật khi thay đổi

Khi thay đổi contract, cập nhật tài liệu tính năng gần nhất và test tương ứng; chỉ cập nhật file này nếu boundary hoặc ownership thay đổi. Không lặp lại bảng endpoint hay inventory configuration ở tài liệu cấp cao.
