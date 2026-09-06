# VDaAgent (P-170)

> Tóm tắt 1 câu: Profiling phân mảnh và khó kiểm chứng → nền tảng AI evidence-first cho Analyst, Data Engineer và nhóm ra quyết định.

VDaAgent biến một nguồn dữ liệu dạng bảng thành profile, phân tích, câu trả lời và báo cáo có provenance. Mỗi workspace được cô lập; profiling chạy bất đồng bộ; mọi claim định lượng phải gắn với evidence đã xác minh.

## Vấn đề (Problem)

Analyst thường phải nối nhiều bước thủ công trước khi có thể trả lời một câu hỏi dữ liệu: kiểm tra schema/data type, missing values, uniqueness/duplicates, distribution/outliers, correlation và PII. Workflow này dài, lặp lại và khó chuẩn hóa.

Ngay cả khi đã có metric, vẫn còn khoảng cách từ profile đến insight: người dùng phải tự đặt câu hỏi, chọn phép phân tích, tạo visualization rồi diễn giải và kiểm chứng kết quả. Chat AI tự do có thể rút ngắn thao tác nhưng tạo rủi ro hallucination, lộ dữ liệu nhạy cảm và khó truy nguyên.

Theo các số liệu được trình bày trong [Data profiling.pdf](presentation/Data%20profiling.pdf), data preparation/cleansing chiếm 37,75% thời gian của Data Professional; Analyst được khảo sát dành khoảng 5,7 giờ/tuần cho chuẩn bị dữ liệu và 3,7 giờ/tuần để kiểm tra/sửa AI output. 46% ưu tiên Human-in-the-Loop, trong khi chỉ 3% ưu tiên AI hoàn toàn tự động. Điều đó cho thấy automation cần đáng tin cậy, grounded và reviewable.

## Giải pháp (Solution)

VDaAgent kết hợp compute deterministic, LangGraph và các quality gate để rút ngắn workflow nhưng vẫn giữ quyền kiểm soát cho con người:

- **Profiling đa nguồn và chuyên sâu:** upload CSV/TSV/Parquet/JSON hoặc import MySQL, MongoDB, DuckDB và Google Drive; tính missingness, cardinality, uniqueness, distribution, outlier, correlation, duplicate, PII, quasi-identifier, candidate key và semantic type.
- **Workflow bất đồng bộ có HITL:** PostgreSQL queue và worker có lease, heartbeat, retry, stale-job recovery; AI đề xuất metadata để Analyst confirm, reject, edit hoặc yêu cầu kiểm định sâu.
- **AI Q&A evidence-first:** Chat Agent dùng tool/retrieval có scope theo Profile Run và workspace; validator deterministic kiểm tra artifact, citation và numeric grounding; thiếu evidence thì abstain thay vì đoán.
- **Biểu đồ an toàn:** planner deterministic hoặc structured-output tạo `QuerySpec` allow-list; Preview bị giới hạn để khám phá, Official chạy lại trên nguồn đầy đủ trong quality gate và mới đủ điều kiện làm evidence/report.
- **Drift và báo cáo tái lập:** so sánh drift từ statistic đã lưu, ghim profile/chart/answer/note vào Report Draft, tạo snapshot SHA-256 bất biến và export PDF PII-safe.

Pitch deck ghi nhận các chỉ số privacy, evidence binding và groundedness 100% cho bộ benchmark được trình bày. Đây không phải cam kết production SLA: release evidence staging vẫn phải được chạy lại trên đúng commit trước khi tuyên bố sẵn sàng.

## Target User

- **Primary:** Analyst và Data Engineer cần kiểm tra chất lượng, hiểu nhanh dataset và tạo insight có thể giải thích.
- **Secondary:** Product/Operations lead, nhóm BI và reviewer cần theo dõi drift, kiểm duyệt metadata và xuất báo cáo có provenance.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | LangGraph + LLM cấu hình được (OpenAI/Gemini hoặc provider tương thích) |
| Backend | FastAPI + Python 3.11 + Pydantic + SQLAlchemy/Alembic |
| Compute | DuckDB file-backed + pandas/NumPy/SciPy/statsmodels/scikit-learn |
| Frontend | Next.js 15 + React 19 + TypeScript + TanStack Query |
| Database | PostgreSQL 16-compatible (bắt buộc; không có SQLite fallback) |
| Storage | Supabase Storage (production), local adapter (development/test), Google Drive import |
| DevOps | Docker + Azure App Service + Azure Container Registry + GitHub Actions |

## Quick Start

```powershell
# 1. Clone repo
git clone <repository-url>
cd P-170

# 2. Tạo môi trường Python và cài dependency
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# 3. Cấu hình local
Copy-Item .env.example .env
# Sửa tối thiểu: APP_ENV=development, AUTH_MODE=dual,
# CANONICAL_STORAGE_PROVIDER=local và DATABASE_URL PostgreSQL local.

# 4. Cài frontend
cd frontend
corepack enable
pnpm install --frozen-lockfile
cd ..

# 5. Chạy migration
alembic -c alembic.ini upgrade head
```

PostgreSQL phải chạy trước khi migrate. Mở ba terminal từ repository root:

```powershell
# API
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Profiling worker
$env:PYTHONPATH = \backend\
.\.venv\Scripts\python.exe -m src.workers.profiling_worker

# Frontend
cd frontend
pnpm dev --port 3000
```

Các shortcut tương đương là `make backend`, `make worker`, `make frontend`, `make dev` và `make health` (GNU Make trên Windows). Backend health ở `http://localhost:8000/health`, frontend health ở `http://localhost:3000/health`; OpenAPI chỉ bật ngoài production tại `/docs`.

## Project Structure

```text
├── backend/
│   ├── src/api/             # FastAPI REST/SSE routes
│   ├── src/agents/          # LangGraph graph, tools, skills và runtime trace
│   ├── src/services/        # Profiling, compute, QA, analysis, report, auth
│   ├── src/workers/         # Durable profiling worker
│   └── migrations/          # Alembic migrations cho PostgreSQL
├── frontend/src/app/        # Next.js pages, route handlers và PDF endpoint
├── frontend/src/components/ # Command Center, chat, review và report UI
├── tests/                   # Backend, integration, frontend/evaluation tests
├── docs/                    # Tài liệu kiến trúc, tính năng, vận hành, bảo mật
├── presentation/            # Pitch deck và tài liệu demo
├── evaluations/             # Scorecard/report đã sinh
├── scripts/                 # Migration, security, benchmark và evaluation tools
├── Dockerfile.*.azure       # Image backend/frontend production
└── .github/workflows/       # Quality gate và triển khai Azure
```

## API Endpoints

Tất cả router nghiệp vụ dùng prefix `/api/v1`; các endpoint dưới đây là bề mặt chính:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check backend (không có prefix) |
| POST | `/api/v1/datasets/upload` | Upload dataset vào canonical storage |
| POST | `/api/v1/datasets/{dataset_id}/profile` | Enqueue một profiling run (HTTP 202) |
| GET | `/api/v1/profiling-jobs/{job_id}/events` | SSE trạng thái profiling job |
| PATCH | `/api/v1/profile/{run_id}/confirm` | Confirm/reject/edit proposal hoặc resume run |
| POST | `/api/v1/qa` | Hỏi đáp có evidence, trả JSON |
| POST | `/api/v1/qa/stream` | Hỏi đáp và tiến trình qua `chat_stream.v1` SSE |
| POST | `/api/v1/profile/{run_id}/explorer/previews` | Chạy bounded Preview |
| POST | `/api/v1/profile/{run_id}/explorer/previews/{preview_id}/promote` | Promote Preview thành Official |
| POST | `/api/v1/profile/{run_id}/drift` | So sánh drift giữa hai Profile Run |
| POST | `/api/v1/reports/{report_id}/snapshots` | Tạo snapshot report bất biến |

Request cần bearer/workspace context phù hợp; production không cho browser truy cập trực tiếp bảng PostgreSQL qua Supabase Data API.

## Deliverables Checklist

- [x] Source Code (GitHub)
- [x] README theo format dự án
- [x] Architecture và technical documentation (`docs/`, `ARCHITECTURE.md`)
- [x] AI logs, evidence và evaluation harness
- [x] Pitch deck (`presentation/`)
- [x] Weekly journal và worklog (`worklog/`)
- [ ] Release evidence staging được ủy quyền trên commit hiện tại
- [ ] Video demo và live URL production (nếu cần cho đợt bàn giao)

## Team

| Member | Role | Student ID |
|--------|------|-----------|
| Vũ Nguyễn Bảo Sơn | Product Manager - Lead Team | 2A202601116 |
| Phạm Thế Đăng | Web Developer | 2A202601766 |
| Nguyễn Minh Hiếu | AI Engineer | 2A202601154 |
| Phạm Thị Thùy Linh | Data Engineer, DevOps | 2A202601181 |

## License

MIT
