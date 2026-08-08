# P-170 — Project Summary

README chỉ tập trung vào mục tiêu, chức năng, cài đặt và hướng dẫn sử dụng.
Tài liệu này ghi phần kỹ thuật chi tiết: kiến trúc, workflow nội bộ, API,
persistence, Q&A, security, giới hạn và kiểm tra chất lượng.

## 1. P-170 là gì?

P-170 là AI Data Profiling Agent hỗ trợ Analyst kiểm tra và hiểu dataset.

Hệ thống có thể:

- Upload CSV, TSV, Parquet hoặc JSON.
- Tính metrics bằng DuckDB/pandas/numpy/scipy.
- Phát hiện PII, quasi-identifier và candidate key.
- Đề xuất semantic type và metadata.
- Tạm dừng để Analyst confirm, edit hoặc reject proposal.
- Chạy statistical test và drift analysis.
- Tạo data quality report.
- Report agent hỗ trợ Markdown, Top-k non-PII distribution và Pearson correlation.
- Trả lời câu hỏi dựa trên metrics, metadata và report đã lưu.

LLM chủ yếu phân loại câu hỏi, diễn giải evidence và tạo narrative. Semantic
type ban đầu do rule/compute suy ra; các trường hợp chưa chắc chắn có thể được
LLM refine dưới confidence cap và vẫn phải qua HITL. LLM không phải nguồn sự
thật cho các con số, không quyết định candidate key/PII và không có tool ghi dữ liệu.

## 2. Workflow chính

```text
Upload dataset
    ↓
Create dataset + profile_run + graph thread
    ↓
Ingest → Compute metrics → Propose metadata
    ↓
HITL review checkpoint
    ├── Confirm/Edit → Summarize
    ├── Reject → Re-propose → HITL review lại
    └── Request test → Deep analysis → HITL review lại
    ↓
Nếu có question ban đầu: QA
    ↓
Finalize và lưu kết quả
```

Mỗi `profile_run` có một LangGraph thread riêng:

```text
graph_thread_id = profile:<profile_run_id>
```

Vì vậy nhiều profile có thể chạy xen kẽ mà không dùng chung checkpoint.

## 3. Lifecycle của profile run

```text
created → running → pending_review ⇄ resuming → completed
    └────────────────────────────────────────→ failed
```

- `created`: run đã được tạo nhưng graph chưa bắt đầu.
- `running`: đang ingest, compute hoặc tạo proposal.
- `pending_review`: đang chờ Analyst; chỉ trạng thái này nhận quyết định.
- `resuming`: một request đang tiếp tục workflow.
- `completed`: report và kết quả cuối đã được lưu.
- `failed`: workflow lỗi; nguyên nhân nằm trong `error` và audit log.

Legacy run không có checkpoint mapping an toàn được giữ ở chế độ đọc.

## 4. Kiến trúc runtime

```text
Browser :3000
  └── Next.js frontend
          │ HTTP/JSON + SSE
          ▼
FastAPI :8000/api/v1
  ├── LangGraph profiling/QA
  ├── SQLite metadata: data/app.db
  ├── LangGraph checkpoint: data/checkpoints.sqlite
  ├── Uploaded files: data/uploads/
  ├── Retrieval index: data/index/documents.json
  └── Audit log: data/audit.jsonl
```

### Backend

Nằm trong `backend/src/`:

- `api/routes.py`: REST API, SSE và workflow resume.
- `models/schemas.py`: Pydantic request/response contract.
- `agents/graph.py`: profiling graph và standalone QA graph.
- `agents/state.py`: state dùng chung cho LangGraph.
- `agents/nodes/profiling_nodes.py`: ingest, compute, proposal, HITL, test,
  summarize và finalize.
- `agents/nodes/qa_nodes.py`: question router, structured QA, retrieval QA,
  clarify và guardrail.
- `agents/tools/`: các tool read-only được tách theo domain và đăng ký tập trung
  qua `registry.py`:
  - `core_profile_tools.py`: profile overview, column discovery, column profile
    và profile versions.
  - `statistics_tools.py`: Pearson correlation, Top-k correlation, distribution,
    outlier summary và sampling uncertainty.
  - `data_quality_tools.py`: quality issues, missingness và duplicate analysis.
  - `governance_tools.py`: PII assessment, semantic type, candidate key và
    governance summary.
  - `test_tools.py`: test allowlist, test recommendation và test results.
  - `drift_tools.py`: drift summary, findings và schema diff.
  - `common.py`: safe envelope, pagination, active-run scope và column resolver.
  - `context.py`, `schemas.py`: ContextVar scope, PII lookup và result contracts.
  - `profiling_tools.py`: compatibility exports cho integration cũ.
- `services/compute.py`: tính toán deterministic.
- `services/repository.py`: persistence bằng SQLAlchemy Core.
- `services/retrieval.py`: BM25 và dense retrieval tùy chọn.
- `services/llm.py`: provider OpenAI-compatible.
- `services/guardrails.py`, `security.py`: policy, masking, rate limit và audit.

`registry.py` là allowlist duy nhất được bind vào LLM. Registry inject đúng
`profile_run_id` vào `ContextVar`, chỉ cho tool đọc aggregate metadata/artifact,
ghi audit cho mỗi tool call và chặn tool không được đăng ký. Vì vậy
`v2_tools.py` không còn tồn tại; implementation đã nằm trong các file domain.

### Frontend

Nằm trong `frontend/src/`:

- `/chat`: chat, upload và Q&A.
- `/datasets`: danh sách dataset.
- `/datasets/new`: upload và bắt đầu profiling.
- `/profiles/[runId]`: profile report.
- `/profiles/[runId]/review`: HITL review và request test.
- `/profiles/[runId]/analysis`: test/drift analysis.
- `/compare`: so sánh drift.
- `components/markdown.tsx`: render Markdown an toàn cho report và chat content.
- `lib/api.ts`: HTTP client, upload và SSE.
- `lib/chat-history.ts`: lịch sử chat lưu client-side bằng localStorage.

### Report và evidence hiển thị

- Compute lưu tối đa `profiling.top_k_values` giá trị phổ biến cho mỗi cột; mặc
  định là 10. Cột PII không lưu giá trị Top-k.
- UI report hiển thị ba cột non-PII đầu tiên và tối đa năm giá trị đầu mỗi cột.
  Số phần trăm được tính trên toàn bộ `row_count`, không phải tổng riêng của
  năm giá trị đang hiển thị. Thanh tỷ lệ được chuẩn hóa theo giá trị lớn nhất
  trong nhóm năm giá trị đó.
- Correlation được tính bằng Pearson trên các cột numeric. UI chỉ hiển thị mỗi
  cặp một lần, sắp xếp theo `abs(r)`, phân biệt tương quan dương/âm và gắn mức
  độ từ yếu đến rất mạnh. Pearson chỉ mô tả quan hệ tuyến tính, không chứng
  minh quan hệ nhân quả.

## 5. Q&A hiện tại

Q&A có hai nguồn chính:

### Structured QA

Dùng các tool read-only theo domain để đọc aggregate metadata của đúng
`profile_run_id`, ví dụ:

- profile overview;
- column profile;
- null/cardinality/uniqueness;
- correlation;
- quality issues;
- PII assessment;
- test results;
- drift findings.

### Retrieval QA

Retrieval hiện tìm trong report/profile đã được index vào
`data/index/documents.json`.

Dự án hiện chưa có knowledge base nghiệp vụ độc lập. Vì vậy agent chưa tự biết
business rules, data dictionary hoặc tài liệu bên ngoài nếu các nội dung đó chưa
được thêm vào hệ thống.

Structured QA có thể đọc các nhóm evidence sau:

- profile overview và column metadata;
- null, cardinality, uniqueness, outlier và missingness;
- Top-k distribution chỉ cho cột non-PII;
- Pearson correlation và các cặp tương quan đã persist;
- PII, semantic type, candidate key và risk warnings;
- statistical test results và drift findings.

Tool không nhận `profile_run_id` từ LLM. Dispatcher inject run đang active từ
workflow/request context để tránh đọc chéo dataset. Kết quả có envelope thống
nhất gồm `data`, `evidence`, `limitations`, `is_approximate` và error code nếu
không có evidence hoặc request không hợp lệ.

## 6. API quan trọng

Tất cả endpoint nghiệp vụ nằm dưới `/api/v1`.

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/profile` | Tạo và chạy profile workflow |
| GET | `/profile/{run_id}` | Đọc report, proposal, test và kết quả cuối |
| GET | `/profile/{run_id}/export` | Xuất metadata/profile JSON bounded, không xuất raw dataset |
| PATCH | `/profile/{run_id}/confirm` | Resume với confirm/edit/reject/request_test |
| POST | `/profile/{run_id}/test` | Chạy statistical test trực tiếp |
| POST | `/profile/{run_id}/drift` | So sánh hai profile run |
| POST | `/qa` | Q&A non-streaming |
| POST | `/qa/stream` | Q&A qua SSE |
| POST | `/datasets/upload` | Upload dataset |
| GET | `/datasets` | Liệt kê dataset |
| GET | `/datasets/{dataset_id}/runs` | Liệt kê các profile run |
| DELETE | `/datasets/{dataset_id}` | Xóa dataset, runs và metadata liên quan |
| GET | `/status` | Runtime configuration |
| GET | `/audit` | Đọc audit events gần nhất |

`/health` là liveness endpoint ở root (`http://localhost:8000/health`), không
phải route nghiệp vụ dưới `/api/v1`.

`PATCH /profile/{run_id}/confirm` hỗ trợ payload dạng:

```json
{
  "confirmed_by": "analyst@example.com",
  "action": "confirm",
  "decisions": [
    {
      "kind": "pii",
      "proposal_id": "proposal-id",
      "decision": "confirm"
    }
  ],
  "test_requests": [],
  "resume": true
}
```

Với `action: "request_test"`, test được truyền qua `test_requests` ở top-level,
không gắn vào từng proposal.

## 7. Persistence

Metadata database gồm các nhóm bảng:

- `datasets`;
- `profile_runs`;
- `column_stats`;
- `candidate_key_proposals`;
- `semantic_type_proposals`;
- `pii_proposals`;
- `statistical_test_results`;
- `drift_reports`.

`profile_runs` lưu cả execution identity và kết quả continuation:

- `graph_thread_id`;
- lifecycle status;
- initial question;
- answer, question type và answer sources;
- resume metadata/idempotency;
- narrative report và terminal result.

Checkpointer mặc định dùng SQLite tại `data/checkpoints.sqlite`. Nếu persistent
checkpointer không khởi tạo được, runtime fallback sang `MemorySaver`; state sẽ
mất khi process restart và hệ thống ghi cảnh báo.

Proposal history không bị xóa khi Analyst reject/re-propose. Proposal cũ được
giữ lại để audit.

Các migration hiện tại là additive để hỗ trợ database local cũ, gồm workflow
columns và duplicate-row artifacts. Dataset deletion xóa metadata con; không tự
ánh xạ checkpoint legacy sang run mới.

## 8. Security boundary

- API token và rate limit có thể bật bằng config.
- PII sample values được mask mặc định.
- Raw dataset không được trả trực tiếp cho agent hoặc client report.
- Tool QA chỉ đọc aggregate metadata/artifact bounded.
- Không cho arbitrary SQL/Python execution.
- Có giới hạn tool calls, deep-analysis loop, output và pagination.
- Audit log ghi profile, proposal decision, tool call, QA và lỗi.
- Audit câu hỏi mặc định chỉ lưu hash/độ dài, không lưu nguyên văn.

## 9. Current limitations

- Chưa có knowledge base nghiệp vụ độc lập; retrieval chỉ dựa trên profile/report.
- Chưa có MCP connector cho Calendar, Gmail hoặc Telegram.
- Chưa có background worker/queue phân tán.
- Chat history hiện lưu ở browser localStorage, không lưu backend.
- SQLite phù hợp local development; production nên dùng PostgreSQL và checkpoint
  storage bền vững.

## 10. Kiểm tra chất lượng

```powershell
# Backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend/src tests
.\.venv\Scripts\python.exe -m ruff format --check backend/src tests

# Frontend
pnpm.cmd --dir frontend exec tsc --noEmit
pnpm.cmd --dir frontend test
pnpm.cmd --dir frontend lint
pnpm.cmd --dir frontend test:e2e
```

Frontend test hiện bao gồm unit test và Playwright E2E. Backend contract test
của tool catalog kiểm tra allowlist read-only, envelope/pagination, PII
distribution và cross-run isolation.
