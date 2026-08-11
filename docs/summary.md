# P-170 — Data Profiling & Analysis Workspace: Technical Summary

P-170 là ứng dụng local-first giúp Analyst biến file dữ liệu thành profile có
thể review, rồi thực hiện một số phép phân tích aggregate có evidence. Profile
run là snapshot kỹ thuật; Analysis Session là đơn vị công việc nghiệp vụ được
pin vào snapshot đó. Sơ đồ thành phần và trust boundary nằm ở
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. Chức năng đang có

- Upload CSV, TSV, Parquet hoặc JSON.
- Profiling deterministic bằng DuckDB/pandas/numpy/scipy: schema, null,
  cardinality, uniqueness, duplicate, outlier, distribution và Pearson
  correlation.
- Phát hiện candidate key, semantic type, PII và quasi-identifier; proposal
  phải qua Human-in-the-loop trước khi profile hoàn tất.
- Statistical test, drift comparison, report Markdown và Q&A có SSE.
- Analysis Workspace MVP: tạo session từ profile đã `completed`, khai báo và
  approve semantic context, chạy quality gate, sau đó thực hiện aggregate
  bounded với evidence được lưu.

LLM chỉ dùng để diễn giải/narrative và Q&A khi provider được cấu hình. Mọi số
liệu profile và analysis đều do compute engine sinh ra; LLM không có quyền ghi
dữ liệu, chạy SQL/Python tùy ý hoặc quyết định PII/candidate key.

## 2. Hai workflow độc lập nhưng liên kết

### Profiling workflow

```text
Upload → dataset + profile_run → ingest → compute → proposals
                                              ↓
                               HITL review / request test
                                              ↓
                                      summarize → completed
```

Mỗi run dùng LangGraph thread `profile:<profile_run_id>` và có lifecycle:

```text
created → running → pending_review ⇄ resuming → completed
    └────────────────────────────────────────→ failed
```

Profile chỉ nhận review khi đang `pending_review`. PII pending cũng được mask
fail-closed; Q&A trên một profile bị chặn cho tới khi không còn proposal pending.

### Analysis Workspace MVP

```text
Completed profile → analysis session → context draft → context approved
       → quality gate → bounded execution → insight_review
```

Session có thread identity `analysis:<session_id>` để dành cho graph bền vững
sau này, nhưng hiện chưa có Analysis LangGraph/checkpointer. Các status đang
được dùng là `needs_context`, `quality_review`, `quality_blocked`, `plan_review`
(Deep mode sau quality gate), `running` và `insight_review`.

Quick mode hiện hỗ trợ execution trực tiếp sau gate. Deep mode mới dừng tại
`plan_review`; chưa có API planner, plan approval, retry/cancel, insight review
hay report finalization.

## 3. Runtime architecture

```text
Browser :3000 (Next.js)
      │ HTTP/JSON + SSE
      ▼
FastAPI :8000/api/v1
 ├─ Profiling + QA LangGraph
 ├─ Analysis API + deterministic DuckDB aggregate engine
 ├─ SQLite metadata                 data/app.db
 ├─ LangGraph SQLite checkpoints    data/checkpoints.sqlite
 ├─ Uploaded immutable sources      data/uploads/
 ├─ Retrieval index                 data/index/documents.json
 └─ Append-only audit log           data/audit.jsonl
```

SQLite là persistence được hỗ trợ và kiểm thử cho local MVP. Metadata khởi tạo
bằng SQLAlchemy Core `metadata.create_all()` và vài migration additive cho cột
cũ; chưa có Alembic hay quy trình migration versioned.

## 4. Backend

### API và contracts

- `api/routes.py`: profile, review/resume, test, drift, Q&A, upload/dataset,
  audit và status.
- `api/analysis_routes.py`: lifecycle API cho Analysis Workspace MVP.
- `models/schemas.py`: contracts profiling/Q&A.
- `models/analysis_schemas.py`: contracts session, context, quality issue,
  filter và query spec.

### Graph và services

- `agents/graph.py`, `agents/nodes/`: LangGraph cho profiling và Q&A.
- `services/compute.py`, `stats_tests.py`, `drift.py`: compute deterministic
  cho profile.
- `services/repository.py`: bảng profile và các bảng analysis; vẫn là single
  metadata registry SQLAlchemy Core.
- `services/analysis_repository.py`: persistence boundary cho session,
  context, quality gate và query execution.
- `services/quality_gate.py`: rule deterministic. Critical issue block execution;
  warning được lưu để Analyst acknowledge qua API.
- `services/analysis_engine.py`: DuckDB aggregate engine. Chỉ nhận QuerySpec
  allowlisted: `count`, `count_distinct`, `sum`, `mean`, `median`, tối đa ba
  dimensions, filter typed và limit bounded.
- `services/retrieval.py`, `llm.py`, `guardrails.py`, `security.py`: retrieval,
  LLM provider, policy, token/rate limit/masking/audit.

## 5. Analysis guardrails

Analysis engine map source từ session sang profile run do server pin, rồi đọc
`datasets.source_ref`; client/LLM không truyền file path, SQL hoặc executable
expression. Chỉ identifier đã kiểm tra được quote vào SQL; filter values dùng
bound parameter.

- Cột phải có trong profile và trong semantic context đã approve (khi context
  khai báo danh sách cột).
- Không aggregate, group-by hoặc filter trực tiếp trên PII đã xác nhận/pending.
- Không trả raw row: response chỉ chứa aggregate result, query spec, hash,
  duration, approximate flag và limitations.
- Mỗi execution lưu context version, canonical query spec, result hash, result
  bounded, duration và limitations trong `query_executions`.
- Query bị chặn nếu context stale/chưa approved, chưa có quality gate, hoặc gate
  có decision `blocked`.

Quality gate hiện kiểm tra profile completed, proposal pending, source rỗng,
sampling, row grain, timezone và missingness của measures. Nó chưa thay thế một
data-quality framework đầy đủ và không tự sửa outlier/missing/type.

## 6. API quan trọng

Mọi endpoint nghiệp vụ nằm dưới `/api/v1`; `/health` nằm ở root.

| Method | Path | Mục đích |
| --- | --- | --- |
| POST / GET | `/profile`, `/profile/{run_id}` | Chạy và đọc profile |
| PATCH | `/profile/{run_id}/confirm` | Review proposal và resume graph |
| POST | `/profile/{run_id}/test`, `/profile/{run_id}/drift` | Test và drift |
| POST | `/qa`, `/qa/stream` | Q&A thường/SSE |
| POST | `/datasets/upload` | Upload file |
| GET / DELETE | `/datasets`, `/datasets/{dataset_id}` | Dataset metadata |
| GET | `/datasets/{dataset_id}/runs` | Run history |
| POST / GET | `/analysis-sessions` | Tạo/liệt kê analysis session |
| GET | `/analysis-sessions/{id}` | Đọc session, source, context và gate mới nhất |
| POST | `/analysis-sessions/{id}/context-versions` | Tạo context version |
| POST | `/analysis-sessions/{id}/context-versions/{context_id}/approve` | Approve context |
| POST | `/analysis-sessions/{id}/quality-gate` | Chạy quality gate |
| POST | `/analysis-sessions/{id}/quality-issues/{issue_id}/acknowledge` | Acknowledge warning |
| POST / GET | `/analysis-sessions/{id}/executions` | Chạy/liệt kê aggregate evidence |

Mutation analysis hiện ghi audit và rate limit giống endpoint profile, nhưng
chưa có idempotency key hay asynchronous job lifecycle.

## 7. Persistence

Profile metadata gồm `datasets`, `profile_runs`, `column_stats`, ba bảng
proposal, `statistical_test_results` và `drift_reports`.

Analysis MVP bổ sung:

- `analysis_sessions`: business goal, mode, status, creator và thread ID;
- `analysis_sources`: một source `primary` pin vào `dataset_id` và
  `profile_run_id`;
- `semantic_context_versions`: JSON context và approval;
- `quality_gate_runs`, `quality_issues`: quyết định gate và evidence;
- `query_executions`: query spec, result bounded, result hash, duration,
  approximation và limitations.

Code hiện enforce một source tại lúc tạo session, nhưng schema chưa có unique
constraint bảo vệ điều này ở database. Dataset/version lineage riêng, metric
glossary, plan, artifact, insight và report tables chưa được implement.

## 8. Frontend

- `/chat`, `/datasets`, `/profiles/[runId]`, `/compare`: workflow profiling
  hiện hữu.
- `/analyses`: danh sách analysis sessions.
- `/analyses/new`: intake Quick/Deep và chọn completed profile run.
- `/analyses/[sessionId]`: workspace MVP gồm Context, Quality gate và Explore
  aggregate. Result hiển thị execution ID, hash và duration như evidence tối
  thiểu.

`Start analysis` xuất hiện trên profile hoàn tất; profile có proposal pending
vẫn dẫn Analyst tới Review. Các type/client riêng nằm ở
`frontend/src/lib/analysis-types.ts` và `analysis` functions trong `lib/api.ts`.

## 9. Security boundary

- API token và rate limit được cấu hình qua settings.
- PII sample values được mask mặc định trong profile/report/Q&A.
- Agent tools và analysis endpoint chỉ trả aggregate/artifact bounded, không
  trả raw dataset.
- Không có arbitrary SQL/Python endpoint.
- Audit log tách với telemetry; audit question mặc định chỉ lưu hash/độ dài.

## 10. Những phần chưa có

- Dataset version/content hash và migration Alembic.
- Metric DSL/glossary, period comparison, trend, pivot, chart spec và privacy
  suppression theo kích thước nhóm.
- Planner–Executor graph, plan CRUD/approval, cancellation/retry/SSE events.
- Insight bank, consistency/fact check và evidence-linked report/export.
- Multi-table, cleaning, connector, worker queue, RBAC và production storage.

## 11. Kiểm tra chất lượng

```powershell
# Backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check backend/src tests

# Frontend (PowerShell dùng pnpm.cmd)
pnpm.cmd --dir frontend typecheck
pnpm.cmd --dir frontend lint
pnpm.cmd --dir frontend test
pnpm.cmd --dir frontend build
```

Backend có contract test cho profile, HITL, Q&A/tool guardrails và Quick
Analysis lifecycle, bao gồm chặn group-by PII.
