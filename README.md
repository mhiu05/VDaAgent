# P-170 - AI Data Profiling Agent

AI Data Profiling Agent tự động lập hồ sơ dữ liệu: upload dataset, tính thống kê, phát hiện PII, đề xuất candidate key và semantic type, yêu cầu analyst xác nhận HITL, chạy kiểm định thống kê, so sánh drift và trả lời câu hỏi về dataset.

Trong dự án này, mọi con số được tính bởi compute engine như DuckDB, pandas, NumPy và SciPy. LLM chỉ dùng để diễn giải, tóm tắt và hỗ trợ hỏi đáp bằng ngôn ngữ tự nhiên, không tự suy diễn số liệu.

## Core Features

- Profiling CSV, TSV, Parquet và JSON thông qua API upload hoặc đường dẫn `dataset_ref`.
- Tính thống kê theo cột: null rate, cardinality, độ dài, min/max, mean, median, std, quartile, outlier, top-k value và correlation matrix.
- Phát hiện PII và mặc định mask giá trị mẫu của cột nhạy cảm trong API/export.
- Đề xuất metadata có evidence và confidence: candidate key, semantic type, PII.
- HITL review: analyst confirm, reject hoặc edit proposal trước khi metadata được áp dụng.
- Kiểm định thống kê theo yêu cầu, có hiệu chỉnh multiple testing.
- Drift detection giữa hai lần profiling.
- Q&A về dataset với 2 nhánh: structured lookup cho câu hỏi định lượng và retrieval cho câu hỏi định tính.
- Web UI tĩnh tại `/ui/` để upload, profile, review HITL và chat QA.
- Audit log cho các hành động nhạy cảm.

## Tech Stack

| Layer | Công nghệ |
| --- | --- |
| Backend API | FastAPI, Uvicorn, Pydantic v2 |
| Agent orchestration | LangGraph, LangChain Core |
| LLM providers | OpenAI-compatible providers: OpenAI, OpenRouter, Gemini, Groq, Together, Ollama, Custom |
| Compute | DuckDB, pandas, NumPy, SciPy |
| Metadata DB | SQLite mặc định; PostgreSQL cho production |
| Retrieval | BM25 mặc định; embedding/rerank tùy chọn qua extras |
| Test/lint | pytest, httpx, ruff |

## Yêu cầu

- Python 3.11 trở lên
- Pip/venv.
- LLM API key là tùy chọn. Không có key thì profiling, thống kê, drift và một phần Q&A offline vẫn chạy; chỉ thiếu phần diễn giải tự nhiên bằng LLM.

## Quick Setup

```bash
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Mở `.env` và điền key của provider đang dùng nếu cần báo cáo/diễn giải bằng LLM:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
```

Nếu chỉ muốn chạy offline để kiểm tra pipeline deterministic, có thể để trống các API key.

## Chạy ứng dụng

```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Hoặc:

```bash
make run
```

Sau khi server chạy:

- Web UI: <http://localhost:8000/ui/>
- Health check: <http://localhost:8000/health>
- API docs: <http://localhost:8000/docs>
- Status cấu hình: <http://localhost:8000/api/v1/status>

Mặc định ứng dụng dùng SQLite trong `data/app.db`, checkpointer trong `data/checkpoints.sqlite`, upload trong `data/uploads/` và audit log trong `data/audit.jsonl`.

## Cấu hình

Dự án đọc cấu hình theo thứ tự ưu tiên:

1. Biến môi trường trong `.env`.
2. Giá trị trong `config.yaml`.
3. Default trong code.

Một số cấu hình quan trọng:

| Nhóm | Khóa | Ý nghĩa |
| --- | --- | --- |
| LLM | `LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY` hoặc key provider tương ứng | Chọn model để diễn giải và sinh báo cáo |
| Database | `DATABASE_URL` | Để trống để dùng SQLite; đặt PostgreSQL DSN khi deploy |
| Security | `security.require_api_token`, `API_TOKEN` | Bật token Bearer cho production |
| Profiling | `profiling.default_scan_mode`, `sample_size`, `random_seed` | Chọn full scan/sample và tái lập kết quả |
| Retrieval | `retrieval.embedding_provider`, `retrieval.enable_rerank` | Cấu hình QA retrieval |

Khi `security.require_api_token=true`, client gọi API với header:

```http
Authorization: Bearer <API_TOKEN>
```

## Workflow sử dụng API

### 1. Upload dataset

```bash
curl -X POST http://localhost:8000/api/v1/datasets/upload \
  -F "file=@data/sample_users.csv"
```

Response trả về `dataset_ref`. Dùng giá trị này cho bước profiling.

### 2. Chạy profiling

```bash
curl -X POST http://localhost:8000/api/v1/profile \
  -H "Content-Type: application/json" \
  -d '{"dataset_ref":"data/sample_users.csv","dataset_name":"users","scan_mode":"full"}'
```

Pipeline sẽ chạy đến điểm chờ HITL và trả về:

- `profile_run_id`
- thống kê theo cột
- proposal cho candidate key, semantic type và PII
- `pending_proposals`
- cảnh báo rủi ro nếu có

### 3. Review HITL

Lấy profile:

```bash
curl http://localhost:8000/api/v1/profile/<profile_run_id>
```

Xác nhận proposal và cho pipeline tạo báo cáo:

```bash
curl -X PATCH http://localhost:8000/api/v1/profile/<profile_run_id>/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "confirmed_by": "analyst@example.com",
    "resume": true,
    "decisions": [
      {"kind": "candidate_key", "proposal_id": "<proposal_id>", "decision": "confirm"}
    ]
  }'
```

`decision` hỗ trợ `confirm`, `reject`, `edit`. Khi `edit`, cần thêm `final_type`.

### 4. Hỏi đáp về dataset

```bash
curl -X POST http://localhost:8000/api/v1/qa \
  -H "Content-Type: application/json" \
  -d '{"profile_run_id":"<profile_run_id>","question":"Tỷ lệ null của cột email là bao nhiêu?"}'
```

Streaming SSE:

```bash
curl -N -X POST http://localhost:8000/api/v1/qa/stream \
  -H "Content-Type: application/json" \
  -d '{"profile_run_id":"<profile_run_id>","question":"Dataset này có rủi ro gì?"}'
```

### 5. Kiểm định thống kê

```bash
curl -X POST http://localhost:8000/api/v1/profile/<profile_run_id>/test \
  -H "Content-Type: application/json" \
  -d '{
    "requested_by": "analyst@example.com",
    "tests": [
      {"test_type": "shapiro_wilk", "columns": ["salary"]},
      {"test_type": "pearson", "columns": ["age", "salary"]}
    ]
  }'
```

### 6. So sánh drift

```bash
curl -X POST http://localhost:8000/api/v1/profile/<current_run_id>/drift \
  -H "Content-Type: application/json" \
  -d '{"baseline_run_id":"<baseline_run_id>"}'
```

### 7. Export profile

```bash
curl http://localhost:8000/api/v1/profile/<profile_run_id>/export
```

Export chỉ trả metadata và thống kê. Mặc định không xuất raw data và không trả giá trị mẫu của cột PII.

## API endpoints

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/status` | Cấu hình runtime và biến còn thiếu |
| `POST` | `/api/v1/datasets/upload` | Upload CSV/TSV/Parquet/JSON |
| `GET` | `/api/v1/datasets` | Danh sách dataset đã profile |
| `GET` | `/api/v1/datasets/{dataset_id}/runs` | Danh sách run của một dataset |
| `POST` | `/api/v1/profile` | Chạy profiling đến điểm HITL |
| `GET` | `/api/v1/profile/{run_id}` | Xem profile run |
| `GET` | `/api/v1/profile/{run_id}/export` | Export metadata/thống kê |
| `PATCH` | `/api/v1/profile/{run_id}/confirm` | Confirm/reject/edit proposal |
| `POST` | `/api/v1/profile/{run_id}/test` | Chạy kiểm định thống kê |
| `POST` | `/api/v1/profile/{run_id}/drift` | So sánh drift |
| `POST` | `/api/v1/qa` | Q&A không streaming |
| `POST` | `/api/v1/qa/stream` | Q&A streaming SSE |
| `GET` | `/api/v1/audit` | Xem audit log gần nhất |

## Kiểm thử và chất lượng

Chạy test:

```bash
pytest tests/ -v
```

Chạy smoke test end-to-end offline:

```bash
python scripts/smoke_test.py
```

Lint/format:

```bash
ruff check src/ tests/
ruff format src/ tests/
```

Hoặc dùng Makefile:

```bash
make test
make lint
make format
make check
```

## Cấu trúc dự án

```text
.
|-- src/
|   |-- main.py                 # FastAPI app, CORS, static UI, health
|   |-- config.py               # Đọc config.yaml + .env
|   |-- api/
|   |   `-- routes.py           # REST/SSE endpoints
|   |-- agents/
|   |   |-- graph.py            # LangGraph profiling và QA graph
|   |   |-- state.py            # Agent state
|   |   |-- nodes/              # Node ingest, stats, HITL, summarize, QA
|   |   `-- tools/              # Tool cho profiling/lookup
|   |-- models/
|   |   `-- schemas.py          # Pydantic request/response schema
|   |-- services/
|   |   |-- compute.py          # Tính thống kê
|   |   |-- stats_tests.py      # Kiểm định thống kê
|   |   |-- drift.py            # Drift detection
|   |   |-- repository.py       # Metadata DB
|   |   |-- retrieval.py        # QA retrieval
|   |   |-- security.py         # Auth, rate limit, audit, upload safety
|   |   `-- llm.py              # LLM adapter
|   `-- webui/
|       `-- index.html          # Dashboard tĩnh tại /ui/
|-- tests/                      # Unit/API/agent tests
|-- scripts/                    # Smoke test và AI log helpers
|-- docs/                       # ADR, gate docs, architecture notes
|-- figures/                    # Hình ảnh minh họa
|-- config.yaml                 # Cấu hình public, không secret
|-- .env.example                # Mẫu biến môi trường
|-- pyproject.toml              # Metadata package và dependencies
`-- requirements.txt            # Dependency list dùng nhanh cho pip install -r
```

## Ghi chú bảo mật và governance

- Không commit `.env` hoặc API key.
- Production nên bật `security.require_api_token=true` và đặt `API_TOKEN`.
- `allow_raw_export=false` theo mặc định để tránh xuất dữ liệu gốc.
- `mask_pii_in_answers=true` theo mặc định để tránh lộ giá trị mẫu của cột PII.
- Candidate key và PII proposal cần analyst xác nhận; agent không tự confirm thay người dùng.
- Audit log ghi lại upload, profiling, HITL decision, export, test và drift.

## Tài liệu liên quan



## License

MIT