# P-170 — Data Profiling & Analysis Workspace

P-170 là ứng dụng local-first giúp Analyst upload, profiling, review và thực
hiện phân tích aggregate có evidence trên một dataset. Compute engine tạo ra số
liệu; AI chỉ hỗ trợ đề xuất metadata, narrative và Q&A — không phải nguồn sự
thật cho các con số.

## 1. Mục tiêu và workflow người dùng

Mục tiêu của dự án là biến một dataset thô thành profile có thể review, giải
thích và kiểm tra lại. Quy trình sử dụng chính:

```text
Upload dataset → Profiling → Review proposal → Profile hoàn tất
                                                    │
                         Test / Drift / Q&A ←───────┼──────→ Start analysis
                                                    │
                                  Context → Quality gate → Aggregate evidence
```

1. Vào **Dataset mới** và upload CSV, TSV, Parquet hoặc JSON.
2. Chọn `sample` để chạy nhanh hoặc `full` để quét toàn bộ dữ liệu.
3. Mở profile report sau khi profiling hoàn tất.
4. Nếu còn proposal chờ xử lý, vào **Review** để confirm, edit, reject hoặc
   yêu cầu chạy test.
5. Xem report, mở **Phân tích** để chạy statistical test/drift và dùng **Agent**
   để hỏi đáp.
6. Khi profile đã hoàn tất và không còn proposal pending, bấm **Start analysis**
   để tạo một Analysis Session, khai báo context, chạy quality gate và thực hiện
   phép aggregate có evidence.
7. Vào danh sách dataset để xem các profile run trước đó hoặc vào **So sánh
   drift** để so sánh hai run.

Chi tiết workflow LangGraph, HITL, API contract và persistence nằm trong
[`docs/summary.md`](docs/summary.md).

## 2. Các chức năng

- Profiling reproducible: schema, null, duplicate, uniqueness, outlier,
  distribution, correlation và thống kê theo cột.
- Phát hiện PII, quasi-identifier, candidate key và semantic type.
- Human-in-the-loop cho confirm, edit, reject proposal và request test.
- Report agent hỗ trợ Markdown, Top-k non-PII distribution và Pearson
  correlation.
- Statistical test, drift analysis và Q&A streaming qua SSE.
- Analysis Workspace MVP: pin một completed profile run, approve semantic
  context, chạy quality gate và aggregate `count`, `count distinct`, `sum`,
  `mean` hoặc `median` với evidence hash.
- Mask PII, giới hạn dữ liệu trả về, audit log và các guardrail cho Agent.
- Lưu lịch sử dataset/profile run để có thể xem lại và so sánh.

## 3. Cấu trúc mã nguồn

```text
backend/src/
├── main.py                         # FastAPI app, lifespan, CORS, health
├── api/routes.py                   # REST API profiling/Q&A, SSE và resume
├── api/analysis_routes.py          # Analysis session/context/gate/execution API
├── models/schemas.py                # Pydantic contracts profiling/Q&A
├── models/analysis_schemas.py       # Pydantic contracts Analysis Workspace
├── agents/
│   ├── graph.py                    # profiling graph và standalone QA graph
│   ├── state.py                    # state của profiling/question/resume
│   ├── nodes/profiling_nodes.py    # ingest, compute, proposal, HITL, test, finalize
│   ├── nodes/qa_nodes.py           # router, structured QA, retrieval QA, guardrail
│   └── tools/                      # domain-separated read-only agent tools
└── services/
    ├── compute.py                  # deterministic profiling metrics
    ├── stats_tests.py              # statistical tests và FDR correction
    ├── drift.py                    # drift computation
    ├── repository.py               # SQLAlchemy Core metadata/profile + analysis tables
    ├── analysis_repository.py      # persistence cho Analysis Workspace
    ├── analysis_engine.py          # DuckDB aggregate bounded, không raw SQL
    ├── quality_gate.py             # quality rules deterministic cho analysis
    ├── retrieval.py                # BM25 và local dense retrieval
    ├── llm.py                      # OpenAI-compatible providers
    ├── guardrails.py               # input/output policy
    └── security.py                 # token, rate limit, audit, masking

frontend/src/
├── app/chat/                       # Agent workspace, upload, Q&A
├── app/datasets/                   # dataset list, upload, run history
├── app/profiles/[runId]/           # report, review, analysis
├── app/analyses/                   # analysis list, intake và workspace MVP
├── app/compare/                    # so sánh drift
├── components/                     # app shell, UI và Markdown renderer
└── lib/                            # API client, SSE, types, chat history
```

## 4. Yêu cầu và cấu hình

Yêu cầu tối thiểu:

- Python 3.11 trở lên.
- Node.js 20 trở lên.
- pnpm 9 trở lên.
- Git và một LLM API key nếu muốn dùng narrative/Q&A bằng LLM.

Tạo cấu hình local:

```text
.env.example → .env
config.yaml  → cấu hình không chứa secret
```

Trong `.env`, chọn một provider và model tương ứng:

```env
OPENAI_API_KEY=your_api_key
```

Các provider được hỗ trợ gồm `openai`, `openrouter`, `gemini`, `groq`,
`together`, `ollama` và `custom`. Tên key cụ thể được ghi trong
[`.env.example`](.env.example). Phiên bản hiện tại dùng SQLite cho metadata và
LangGraph checkpointer, vì vậy có thể để trống `DATABASE_URL` và
`DATABASE_CHECKPOINTER_URL`. API token cấu hình qua `API_TOKEN`, còn địa chỉ
backend của frontend qua `NEXT_PUBLIC_API_URL`.

Retrieval mặc định dùng BM25 kết hợp local embedding của
`sentence-transformers`. Model `sentence-transformers/all-MiniLM-L6-v2` có thể
được tải ở lần chạy đầu tiên; nếu không tải được, hệ thống vẫn fallback sang
BM25-only.

Nếu không có LLM key, backend vẫn có thể chạy
phần compute deterministic; các chức năng cần LLM sẽ báo thiếu cấu hình.

## 5. Cài đặt và chạy local

### Windows PowerShell

Từ thư mục gốc repository:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Mở .env và điền API key nếu dùng LLM
```

Nếu chưa có pnpm, bật Corepack:

```powershell
corepack enable
```

Terminal 1 — backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Terminal 2 — frontend:

```powershell
cd frontend
pnpm install
pnpm dev --port 3000
```

#### Shortcut bằng Makefile trên Windows

`Makefile` hiện được viết cho môi trường Windows/PowerShell. Nếu đã cài GNU
Make, có thể dùng `gmake` thay cho các lệnh chạy thủ công:

```powershell
gmake help             # Xem toàn bộ shortcut
gmake install          # Cài dependency backend/frontend
gmake dev              # Mở backend và frontend ở hai cửa sổ riêng
gmake backend          # Chỉ chạy backend
gmake frontend         # Chỉ chạy frontend
gmake health           # Kiểm tra backend health
gmake frontend-check   # Typecheck và lint frontend
gmake frontend-build   # Build frontend production
```

Trước `gmake install`, vẫn cần tạo `.venv` và sao chép `.env` như các bước ở
trên. `gmake dev` không dùng cho macOS/Linux vì target hiện tại gọi `cmd.exe`,
đường dẫn virtualenv kiểu Windows và lệnh `start`.

### macOS

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
python -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Mở terminal khác để chạy frontend:

```bash
cd frontend
pnpm install
pnpm dev --port 3000
```

### Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
python -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Mở terminal khác để chạy frontend:

```bash
cd frontend
pnpm install
pnpm dev --port 3000
```

Sau khi khởi động:

- Frontend: <http://localhost:3000>
- Swagger UI: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/health>

## 6. Hướng dẫn sử dụng

### Giao diện Chat với Agent

Mở <http://localhost:3000/chat> hoặc bấm **Agent** trong thanh điều hướng.
Màn hình này là workspace hội thoại với Data Profiling Agent:

1. Nếu chưa có profile, bấm nút **＋** cạnh ô nhập để upload dataset trực tiếp
   trong chat.
2. Chọn **Sampling** để có kết quả nhanh hoặc **Full scan** để tính trên toàn
   bộ file, sau đó bấm **Upload và bắt đầu profiling**.
3. Chờ Agent hoàn tất profiling. Chat sẽ hiển thị preview số cột, kiểu dữ liệu,
   null, cardinality và uniqueness.
4. Nếu profile còn proposal pending, bấm **Review proposals**. Agent sẽ không
   trả lời câu hỏi về dataset cho đến khi các proposal được Analyst xử lý.
5. Sau khi review, nhập câu hỏi vào ô chat hoặc chọn một prompt gợi ý, ví dụ:
   - `Tóm tắt chất lượng dữ liệu của tôi`
   - `Cột nào có rủi ro PII cao nhất?`
   - `Có cột nào phù hợp làm candidate key không?`
6. Bấm nút gửi hoặc nhấn **Enter**. Dùng **Shift + Enter** để xuống dòng.
   Câu trả lời được stream dần trong chat và có thể gồm heading, danh sách,
   bảng Markdown cùng các số liệu từ profile.
7. Có thể bấm **+ New chat** để tạo cuộc trò chuyện mới. Lịch sử hội thoại và
   profile context được lưu ở trình duyệt hiện tại; xóa localStorage sẽ xóa
   lịch sử local này.

Agent chỉ trả lời dựa trên evidence đã profiling, bảo vệ giá trị PII và không
đọc raw row tùy ý. Nếu cần xem đầy đủ proposal, report, test hoặc drift, mở
profile tương ứng từ dataset/run history.

### Qua giao diện web

1. Mở <http://localhost:3000/datasets/new>.
2. Chọn file CSV, TSV, Parquet hoặc JSON rồi bấm **Upload file**.
3. Chọn chế độ scan và random seed nếu cần. Chế độ Sample dùng kích thước mẫu
   mặc định của backend; profile sẽ hiển thị kết quả có phải ước lượng hay không.
4. Bấm **Bắt đầu profiling**.
5. Xem report tại `/profiles/{runId}`.
6. Nếu có proposal pending, bấm **Review** và xử lý từng đề xuất.
7. Dùng **Phân tích** để chạy test hoặc xem kết quả drift.
8. Với profile `completed` không còn proposal pending, bấm **Start analysis**.
9. Ở workspace, khai báo row grain, dimensions và measures, sau đó approve
   context để chạy quality gate.
10. Nếu gate không bị block, dùng **Explore** để chạy một aggregate bounded.
    Kết quả hiển thị execution ID, result hash và thời gian chạy làm evidence.

### Analysis Workspace MVP: phạm vi hiện tại

Analysis hiện hỗ trợ một source là completed profile run và các aggregate an
toàn. API/engine không nhận raw SQL, path file do client chọn hay raw row; PII
không được aggregate, group-by hoặc filter trực tiếp.

Chế độ **Quick Answer** chạy aggregate sau quality gate. **Deep Analysis** mới
dừng tại bước plan review; Planner–Executor, plan approval, retry/cancel,
insight bank và report evidence-linked vẫn là phần roadmap chưa triển khai.



## Tài liệu chi tiết

- [`docs/summary.md`](docs/summary.md): kiến trúc, workflow nội bộ, API,
  persistence, Q&A, security, giới hạn và kiểm tra chất lượng.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): component diagram, trust boundary và
  data flow của implementation hiện tại.
