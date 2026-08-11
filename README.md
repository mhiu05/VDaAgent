# P-170 — Data Profiling & Analysis Workspace

P-170 là ứng dụng local-first hỗ trợ Analyst biến một file dữ liệu thành một
profile có thể kiểm tra, review và dùng cho các phân tích aggregate có
evidence. Compute engine chịu trách nhiệm tạo số liệu; LLM chỉ hỗ trợ
narrative, retrieval và hỏi đáp, không phải nguồn sự thật cho các con số.

## Quy trình chính

```text
Upload dataset
      ↓
Profiling deterministic
      ↓
Review proposal metadata
      ↓
Profile completed
   ↙       ↓        ↘
Report  Test/Drift  Q&A Agent
              ↓
       Start analysis
              ↓
 Context → Quality gate → Bounded aggregate → Evidence
```

Một phiên làm việc điển hình:

1. Upload CSV, TSV, Parquet hoặc JSON.
2. Chọn `sample` để chạy nhanh hoặc `full` để quét toàn bộ file.
3. Mở profile report và xử lý các proposal về semantic type, candidate key và
   PII. Proposal chưa review sẽ chặn các bước cần profile đã được xác nhận.
4. Xem thống kê, report, statistical test hoặc so sánh drift giữa hai profile
   run.
5. Dùng Agent để hỏi đáp dựa trên evidence của profile.
6. Từ một profile đã `completed`, tạo Analysis Session, khai báo semantic
   context, chạy quality gate và thực hiện aggregate an toàn.

## Chức năng hiện có

- Profiling reproducible: schema, kiểu dữ liệu, missingness, cardinality,
  uniqueness, duplicate, outlier, phân phối, top-k và correlation.
- Phát hiện proposal cho PII, quasi-identifier, candidate key và semantic
  type, có human-in-the-loop để confirm, edit hoặc reject.
- Chạy statistical test với alpha và multiple-testing correction.
- So sánh drift giữa hai profile run.
- Report Markdown và hỏi đáp Agent qua API thường hoặc SSE streaming.
- Lưu dataset, profile run, proposal, test result, analysis session và audit
  event để xem lại.
- Analysis Workspace MVP với quality gate và các aggregate `count`,
  `count_distinct`, `sum`, `mean`, `median`.
- Guardrail: không nhận raw SQL từ client/LLM, không aggregate/group-by/filter
  trên cột PII, giới hạn số dimension/filter/row trả về và lưu `result_hash`.

## Kiến trúc

```text
Next.js frontend :3000
        │ HTTP/JSON + SSE
        ▼
FastAPI backend :8000/api/v1
        ├── LangGraph profiling + Q&A
        ├── DuckDB/pandas/numpy/scipy compute engine
        ├── SQLite metadata và LangGraph checkpoint
        ├── Local uploaded sources
        ├── BM25/local embedding retrieval index
        └── Append-only audit log
```

Các thư mục chính:

```text
backend/src/
├── main.py                         # FastAPI app, health check, CORS
├── api/routes.py                   # profiling, dataset, Q&A, test, drift
├── api/analysis_routes.py          # Analysis Workspace API
├── models/                         # Pydantic request/response contracts
├── agents/                         # LangGraph, nodes, state và read-only tools
└── services/
    ├── compute.py                  # số liệu profiling deterministic
    ├── stats_tests.py              # statistical tests
    ├── drift.py                    # drift computation
    ├── repository.py               # metadata và profile persistence
    ├── analysis_engine.py          # bounded aggregate engine
    ├── analysis_repository.py      # Analysis Workspace persistence
    ├── quality_gate.py             # deterministic quality rules
    ├── retrieval.py                # BM25/local retrieval
    ├── llm.py                      # OpenAI-compatible providers
    ├── guardrails.py               # giới hạn input/output/tool
    └── security.py                 # token, rate limit, audit, masking

frontend/src/
├── app/chat/                       # Agent workspace và upload nhanh
├── app/datasets/                   # dataset list, upload, run history
├── app/profiles/[runId]/           # report, review, test, analysis
├── app/analyses/                   # Analysis Workspace
├── app/compare/                    # so sánh drift
├── components/                     # layout và UI dùng chung
└── lib/                            # API client, SSE và TypeScript types
```

## Yêu cầu

- Python 3.11 trở lên
- Node.js 20 trở lên
- pnpm 9 trở lên
- Git
- LLM API key là tùy chọn. Profiling, test, drift và compute vẫn chạy được
  khi chưa cấu hình LLM; phần narrative/Q&A phụ thuộc provider đã chọn.

## Cài đặt và chạy local

### Windows PowerShell

Từ thư mục gốc repository:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env

corepack enable
cd frontend
pnpm install
cd ..
```

Mở hai terminal:

```powershell
# Terminal 1 — backend
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2 — frontend
cd frontend
pnpm dev --port 3000
```

### macOS/Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
cd frontend && pnpm install && cd ..
```

Sau đó chạy backend và frontend bằng các lệnh tương tự ở trên, thay đường dẫn
virtualenv bằng `.venv/bin/python`.

Khi khởi động xong:

- Frontend: <http://localhost:3000>
- API docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>
- API root: <http://localhost:8000/>

Có thể dùng shortcut trên Windows nếu đã cài GNU Make:

```powershell
gmake install          # cài dependency backend/frontend
gmake dev              # mở backend và frontend ở hai cửa sổ
gmake health           # kiểm tra backend
gmake frontend-check   # typecheck và lint frontend
gmake frontend-build   # build frontend production
```

## Cấu hình

`config.yaml` chứa cấu hình không bí mật; `.env` chứa secret và không được
commit. Bắt đầu bằng cách sao chép `.env.example` thành `.env`.

Các biến thường dùng:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=your_key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Ứng dụng hỗ trợ các provider OpenAI-compatible được khai báo trong
`.env.example`, gồm `openai`, `openrouter`, `gemini`, `groq`, `together`,
`ollama` và `custom`. Mặc định metadata dùng `data/app.db`, checkpoint dùng
`data/checkpoints.sqlite`, file upload nằm trong `data/uploads/`, index nằm
trong `data/index/` và audit log nằm ở `data/audit.jsonl`.

Nếu bật `security.require_api_token: true` trong `config.yaml`, cần đặt
`API_TOKEN` và gửi request với header `Authorization: Bearer <token>`.

Lần chạy đầu tiên có thể tải model embedding local được cấu hình trong
`config.yaml`. Nếu không tải được embedding, retrieval có thể fallback về
BM25-only.

## Các màn hình chính

- `/chat`: upload nhanh và hỏi Data Profiling Agent.
- `/datasets`: danh sách dataset và lịch sử profile run.
- `/datasets/new`: upload và bắt đầu profiling.
- `/profiles/{runId}`: profile report, thống kê và cảnh báo.
- `/profiles/{runId}/review`: review proposal metadata.
- `/profiles/{runId}/analysis`: statistical test và thao tác phân tích liên
  quan tới profile.
- `/analyses`: danh sách Analysis Session.
- `/analyses/new`: tạo session từ profile đã hoàn tất.
- `/analyses/{sessionId}`: context, quality gate và bounded execution.
- `/compare`: so sánh drift giữa baseline run và current run.

## API chính

Backend mount các router dưới `/api/v1`:

| Nhóm | Endpoint tiêu biểu |
| --- | --- |
| Dataset | `POST /datasets/upload`, `GET /datasets`, `GET /datasets/{id}/runs` |
| Profiling | `POST /profile`, `GET /profile/{run_id}`, `GET /profile/{run_id}/report` |
| Review | `PATCH /profile/{run_id}/confirm` |
| Test/drift | `POST /profile/{run_id}/test`, `POST /profile/{run_id}/drift` |
| Q&A | `POST /qa`, `POST /qa/stream` |
| Analysis | `/analysis-sessions` và các sub-route context/gate/executions |
| System | `GET /health`, `GET /status`, `GET /audit` |

Swagger UI tại `/docs` là contract chi tiết và nguồn tham khảo tốt nhất khi
gọi API trực tiếp.

## Kiểm tra chất lượng

```powershell
# Backend
pytest -q

# Frontend
cd frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Giới hạn hiện tại

- Analysis Workspace hiện chỉ hỗ trợ một profile run làm source và bounded
  aggregate; chưa có raw SQL, join nhiều bảng hoặc data-cleaning recipe.
- `deep` analysis mới dừng ở mức chuẩn bị workflow; planner/executor nhiều
  bước, retry/cancel, insight bank và report finalization chưa hoàn thiện.
- Profile chạy bằng `sample` được đánh dấu `is_approximate`; kết quả không nên
  được xem là số liệu exact nếu chưa xác nhận phạm vi mẫu.
- SQLite phù hợp cho local MVP. Quy trình migration versioned và deployment
  production cần được bổ sung khi mở rộng.

## Tài liệu liên quan

- [`docs/summary.md`](docs/summary.md): technical summary, state, persistence,
  API contract và guardrail.
- [`docs/Data_Analyst.md`](docs/Data_Analyst.md): nguyên tắc và phạm vi nghiệp
  vụ của Data Analyst workflow.
- [`config.yaml`](config.yaml): cấu hình runtime không bí mật.
- [`.env.example`](.env.example): danh sách biến môi trường và hướng dẫn secret.
