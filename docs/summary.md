# P-170 — Technical Summary

Tài liệu này mô tả implementation hiện tại của P-170 — một ứng dụng
local-first gồm frontend Next.js và backend FastAPI cho data profiling, review
metadata, hỏi đáp có evidence và một Analysis Workspace bounded.

## 1. Nguyên tắc thiết kế

P-170 tách rõ hai loại công việc:

- **Compute deterministic**: DuckDB, pandas, NumPy và SciPy tạo profile,
  test, drift và aggregate. Các kết quả số phải truy nguyên được.
- **LLM/Agent**: định tuyến câu hỏi, retrieval, diễn giải và tạo narrative. LLM
  không tự tính số, không ghi raw data, không quyết định PII và không nhận raw
  SQL tùy ý.

Các nguyên tắc bảo vệ chính:

1. Proposal metadata phải được review trước khi profile được dùng như context
   đã xác nhận.
2. Profile sample luôn mang cờ `is_approximate`.
3. Analysis phải đi qua semantic context và quality gate.
4. Cột PII không được dùng làm measure, dimension hoặc filter.
5. Execution chỉ dùng query spec allowlist, filter parameterized và output có
   giới hạn.
6. Mỗi analysis execution lưu canonical query, result hash, giới hạn và
   duration làm evidence.

## 2. Runtime architecture

```text
Browser / Next.js :3000
        │ HTTP/JSON + Server-Sent Events
        ▼
FastAPI :8000
  └── /api/v1
      ├── profiling, proposals, reports
      ├── statistical tests, drift
      ├── Q&A và SSE streaming
      └── analysis-sessions
              │
              ├── SQLite metadata: data/app.db
              ├── LangGraph checkpoint: data/checkpoints.sqlite
              ├── Immutable upload source: data/uploads/
              ├── Retrieval index: data/index/
              └── Audit log: data/audit.jsonl
```

Mặc định backend chạy ở `0.0.0.0:8000`, frontend ở `localhost:3000`. Frontend
được triển khai độc lập; FastAPI chỉ cung cấp API và Swagger UI, không serve
asset Next.js.

### Backend modules

| Module | Vai trò |
| --- | --- |
| `src/main.py` | Khởi tạo FastAPI, CORS, database directories, `/health`. |
| `src/api/routes.py` | Dataset upload/list, profiling, proposal review, report, Q&A, test, drift, audit. |
| `src/api/analysis_routes.py` | Analysis session, context version, quality gate và execution. |
| `src/agents/graph.py` | LangGraph profiling và Q&A graph. |
| `src/agents/nodes/` | Ingest, compute, proposal/HITL, summarize, router và QA guardrail. |
| `src/agents/tools/` | Các tool read-only tách theo domain. |
| `src/services/compute.py` | Thống kê profile deterministic. |
| `src/services/stats_tests.py` | Statistical tests và multiple-testing correction. |
| `src/services/drift.py` | So sánh profile run. |
| `src/services/repository.py` | Dataset, profile run, proposal và report persistence. |
| `src/services/analysis_engine.py` | DuckDB aggregate bounded, không có raw-SQL entry point. |
| `src/services/analysis_repository.py` | Analysis session/context/gate/execution persistence. |
| `src/services/quality_gate.py` | Kiểm tra profile, proposal, source, grain, timezone và missingness. |
| `src/services/retrieval.py` | BM25 và local embedding retrieval. |
| `src/services/llm.py` | Gọi provider OpenAI-compatible. |
| `src/services/security.py` | Token, rate limit, masking và audit. |

## 3. Profiling workflow

```text
POST /datasets/upload (tùy chọn)
          ↓
POST /profile
          ↓
created → running → pending_review
                         ↓
              confirm/edit/reject/request_test
                         ↓
                      completed
```

`POST /profile` tạo một dataset/profile run và chạy LangGraph với thread
`profile:<profile_run_id>`. Scan mode là:

- `sample`: mặc định, reservoir sample mặc định 10.000 dòng, seed mặc định
  `42`; kết quả được đánh dấu approximate.
- `full`: quét toàn bộ source.

Profile response có schema, null count/rate, cardinality, uniqueness, numeric
summary, outlier, top-k phù hợp, correlation, risk warning, proposal và trạng
thái run. Proposal có các loại `candidate_key`, `semantic_type` và `pii`;
trạng thái gồm `pending`, `confirmed`, `rejected`, `edited` và
`auto_confirmed`.

Khi proposal đang pending, Analyst có thể gọi:

```text
PATCH /api/v1/profile/{run_id}/confirm
```

để confirm, edit, reject hoặc request test. Việc resume graph tiếp tục bước
summarize/finalize khi đủ điều kiện. Q&A gắn với profile bị chặn nếu profile
còn proposal pending.

## 4. Q&A và report

Q&A nhận `question`, tùy chọn `profile_run_id` và tối đa 20 history messages.
Hai endpoint là:

```text
POST /api/v1/qa
POST /api/v1/qa/stream
```

Nhánh Q&A định tuyến giữa câu hỏi có cấu trúc, retrieval và các câu hỏi cần
profile context. Câu trả lời có `sources` và cờ `is_approximate`. Endpoint
stream trả Server-Sent Events để UI hiển thị dần câu trả lời.

Report profile có thể lấy bằng:

```text
GET /api/v1/profile/{run_id}
GET /api/v1/profile/{run_id}/report
GET /api/v1/profile/{run_id}/export
```

LLM key không bắt buộc để backend khởi động hoặc chạy compute. Khi không có
LLM, các phần narrative có thể trả bảng/thống kê thay vì diễn giải tự nhiên.

## 5. Statistical test và drift

Statistical test được gửi qua:

```text
POST /api/v1/profile/{run_id}/test
```

Request khai báo `test_type`, danh sách cột, tham số, `alpha` và correction
method (`benjamini_hochberg`, `bonferroni` hoặc `none`). Response chứa test
statistic, p-value, adjusted p-value, kết luận và diễn giải.

Drift được gửi qua:

```text
POST /api/v1/profile/{run_id}/drift
```

với `baseline_run_id` và current run. Backend kiểm tra tính tương thích của
hai run trước khi trả finding, metric, severity và detail.

## 6. Analysis Workspace MVP

Analysis session được tạo từ một profile run:

```text
POST /api/v1/analysis-sessions
```

Request có `profile_run_id`, `mode` (`quick` hoặc `deep`), `goal`, tùy chọn
`decision`, `audience`, `output`, `time_scope`, `population` và `baseline`.

Workflow thực tế:

```text
completed profile
      ↓
analysis session (needs_context)
      ↓
context version draft
      ↓
context approved
      ↓
quality gate
      ├── blocked
      ├── warning (có thể acknowledge)
      └── passed
      ↓
bounded execution
      ↓
execution + evidence
```

### Semantic context

Context version mô tả:

- `row_grain`, `entity`, `keys`
- `time_column`, `timezone`
- `dimensions`, `measures`
- `ignored_columns`, `limitations`

Context phải được approve bằng:

```text
POST /api/v1/analysis-sessions/{session_id}/context-versions
POST /api/v1/analysis-sessions/{session_id}/context-versions/{context_id}/approve
```

### Quality gate

```text
POST /api/v1/analysis-sessions/{session_id}/quality-gate
```

Gate kiểm tra tối thiểu:

- profile tồn tại, có status `completed` và có row count;
- không còn proposal pending;
- row grain đã được khai báo hoặc cảnh báo thiếu;
- timezone khi có time column;
- missingness cao của measure;
- profile sample và tính đại diện của source.

Issue critical làm gate `blocked`; issue warning làm gate `warning`. Issue có
thể được ghi nhận bằng:

```text
POST /api/v1/analysis-sessions/{session_id}/quality-issues/{issue_id}/acknowledge
```

Quality gate chỉ báo cáo và lưu evidence, không sửa source data.

### Bounded aggregate engine

Execution gửi query và context version được kỳ vọng:

```text
POST /api/v1/analysis-sessions/{session_id}/executions
GET  /api/v1/analysis-sessions/{session_id}/executions
```

Query spec chỉ cho phép:

- aggregate: `count`, `count_distinct`, `sum`, `mean`, `median`;
- tối đa 3 dimensions;
- tối đa 20 filters;
- filter `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_null`,
  `not_null`;
- tối đa 500 dòng kết quả, mặc định 100.

Tên cột được validate/quote; filter value được bind parameter. Engine đọc
source đã pin bằng DuckDB trong memory, không nhận path file, SQL hoặc code do
client/LLM truyền vào. Measure/dimension/filter phải thuộc semantic context đã
approve và không được là PII.

Execution lưu:

```text
execution_id
context_version_id
canonical query spec
result_hash
is_approximate
limitations
duration_ms
```

Nếu source profile dùng sample, kết quả aggregate được đánh dấu approximate và
đi kèm limitation tương ứng.

## 7. Persistence và dữ liệu runtime

Mặc định cấu hình trong `config.yaml` dùng:

```text
data/app.db                  SQLite metadata
data/checkpoints.sqlite      LangGraph checkpoint
data/uploads/                immutable uploaded sources
data/index/                  retrieval documents/embeddings
data/audit.jsonl             append-only audit events
```

Database được khởi tạo additive bằng SQLAlchemy Core khi backend start. SQLite
là lựa chọn mặc định cho local MVP; `DATABASE_URL` và
`DATABASE_CHECKPOINTER_URL` có thể override bằng biến môi trường khi cần dùng
database khác.

`.env` không được commit. Secret như LLM key, API token, database password và
service-account path phải đặt trong `.env` hoặc secret manager của môi trường
triển khai.

## 8. Security boundary

- API token là tùy chọn và mặc định tắt cho local development.
- Khi bật token, request phải gửi `Authorization: Bearer <API_TOKEN>`.
- Rate limit mặc định là 30 request/user/phút.
- Upload mặc định giới hạn 500 MB.
- Raw export mặc định tắt.
- PII được mask trong câu trả lời theo `security.mask_pii_in_answers`.
- Agent tool calls, context size và output size có hard limit.
- Audit log mặc định lưu hash/metadata câu hỏi thay vì nội dung câu hỏi.
- Raw source không được trả về từ Analysis API; chỉ trả aggregate bounded.

Đây là lớp bảo vệ cho local MVP, không thay thế authentication, authorization,
secret management và network isolation cần có khi triển khai public.

## 9. Frontend contract

Frontend dùng Next.js 15, React 19, TypeScript, TanStack Query và `pnpm`.
`frontend/src/lib/api.ts` là API client; `types.ts` và
`analysis-types.ts` chứa các type tương ứng với backend.

Các route chính:

```text
/chat
/datasets
/datasets/new
/datasets/{datasetId}/runs
/profiles/{runId}
/profiles/{runId}/review
/profiles/{runId}/analysis
/analyses
/analyses/new
/analyses/{sessionId}
/compare
```

Chat history được lưu ở browser localStorage. Dataset, profile và analysis
history được lưu ở backend database; xóa localStorage chỉ xóa lịch sử chat
trình duyệt, không xóa profile server.

## 10. Kiểm tra và phát triển

Từ thư mục gốc:

```powershell
pytest -q
```

Từ `frontend/`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Các test backend nằm trong `tests/`, bao gồm agent, API, compute, guardrail,
security và statistical test. Frontend có unit test Vitest; Playwright được
khai báo cho e2e test.

## 11. Giới hạn và phần chưa triển khai

- Chỉ một profile run/source cho mỗi Analysis Session; chưa hỗ trợ join nhiều
  bảng hoặc semantic layer dùng chung.
- Analysis engine chưa cung cấp arbitrary SQL, notebook, cleaning recipe,
  rollback hoặc chỉnh sửa source.
- `deep` mode mới là điểm dừng `plan_review`; planner nhiều bước, approval,
  retry/cancel, insight bank và final report chưa có API hoàn chỉnh.
- Profile sample phù hợp khám phá nhanh, không mặc nhiên là số liệu exact.
- Chưa có migration versioned bằng Alembic.
- SQLite/checkpointer local phù hợp MVP; triển khai production cần đánh giá
  concurrency, backup, auth và observability.

## 12. Tài liệu liên quan

- [`README.md`](../README.md): cài đặt, chạy app và hướng dẫn người dùng.
- [`Data_Analyst.md`](Data_Analyst.md): nguyên tắc nghiệp vụ và roadmap Data
  Analyst.
- [`../config.yaml`](../config.yaml): cấu hình không bí mật.
- [`../.env.example`](../.env.example): biến môi trường và secret setup.
