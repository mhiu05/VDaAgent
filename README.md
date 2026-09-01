# VDaAgent (P-170) — Nền tảng profiling và phân tích dữ liệu

VDaAgent là ứng dụng phân tích dữ liệu nhiều workspace theo nguyên tắc evidence-first. Hệ thống tiếp nhận dữ liệu dạng bảng, chạy profiling bất đồng bộ, hỗ trợ review metadata, phân tích/biểu đồ có giới hạn, Chat Agent có bằng chứng, so sánh drift và tạo báo cáo PII-safe.

## Những gì dự án đang hỗ trợ

- Upload CSV, TSV, Parquet và JSON lên Supabase Storage, Google Drive hoặc local storage ở development.
- Kết nối nguồn chỉ đọc MySQL, MongoDB và DuckDB; lưu credential đã mã hóa và chỉ trả metadata an toàn cho browser.
- Đưa Profile Run vào queue PostgreSQL; worker riêng claim lease, heartbeat, retry và khôi phục job stale.
- Profile source bằng DuckDB trên file đã materialize tạm thời; chỉ nạp các cột cần thiết vào pandas khi chạy statistical test.
- Lưu missingness, cardinality, uniqueness, distribution, outlier, correlation, duplicate, PII, quasi-identifier, candidate key và semantic type.
- Review proposal bằng LangGraph HITL, gồm confirm, reject, edit và yêu cầu kiểm định sâu.
- Tạo chart tại Command Center qua hai bước Preview (approximate) và Official (evidence), kèm quality gate.
- Trả lời QA qua JSON hoặc `chat_stream.v1` SSE; claim định lượng phải qua tool evidence và validator deterministic, nếu thiếu bằng chứng hệ thống sẽ abstain.
- Chat Agent P0–P2 có tiến trình trung thực, câu trả lời có cấu trúc/provenance bất biến, recovery có kiểu, lịch sử hội thoại bền vững theo workspace, gợi ý câu hỏi deterministic và feedback có giới hạn.
- Với câu hỏi deterministic đủ điều kiện, cache chỉ được dùng sau khi chạy lại bounded tool và evidence validation; verifier rủi ro cao hiện chạy ở chế độ shadow, không tự sửa câu trả lời.
- So sánh drift từ các thống kê đã lưu, không cần tải lại raw data.
- Soạn Report Draft, ghim profile/chart/answer/note, tạo snapshot bất biến và export PDF phía Next.js server.
- Cô lập dữ liệu theo workspace; mọi bảng ứng dụng trong PostgreSQL là backend-only đối với Supabase Data API.
- Supabase Storage giữ canonical dataset artifact trong production; Google Drive và database connector chỉ là nguồn import, còn local adapter dành cho development/test.

## Kiến trúc chạy

Stack local và production có ba process chính:

```text
Browser / Next.js ── REST + SSE ── FastAPI ── PostgreSQL / Storage / LLM
                                      │
                                      └── Profiling Worker ── DuckDB compute
```

Frontend dùng Next.js 15, React 19 và TypeScript. Backend dùng Python 3.11, FastAPI, SQLAlchemy/Alembic, LangGraph, DuckDB và PostgreSQL. Production chạy ba container độc lập (frontend, API, profiling worker) trên Azure App Service qua GitHub Actions.

## Bắt đầu nhanh trên Windows

Yêu cầu: Python 3.11, Node.js 22, pnpm 11.0.8 và PostgreSQL 16-compatible. PostgreSQL là bắt buộc; dự án không hỗ trợ SQLite fallback.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
cd frontend
pnpm install
cd ..
```

Sau khi sao chép `.env.example`, tối thiểu hãy đổi cấu hình local sau trước khi chạy migration:

```dotenv
APP_ENV=development
AUTH_MODE=dual
CANONICAL_STORAGE_PROVIDER=local
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/p170
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

Nếu `AUTH_MODE=dual` yêu cầu bearer dùng chung, đặt thêm `API_TOKEN`. LLM, embedding, Supabase Auth/Storage và Google Drive chỉ cần cấu hình khi kiểm thử các path tương ứng.

```powershell
alembic -c alembic.ini upgrade head
```

Chạy ba terminal từ repository root:

```powershell
# API
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Worker
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m src.workers.profiling_worker

# Frontend
cd frontend
pnpm dev --port 3000
```

Nếu đã cài GNU Make trên Windows, có thể dùng `make backend`, `make worker`, `make frontend`, `make dev` và `make health`.

## Kiểm tra nhanh

```powershell
ruff check backend/src tests
python -m pytest -q
python scripts/migration_smoke.py

cd frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

OpenAPI chỉ mở ở development/test tại `http://localhost:8000/docs`; backend health ở `/health`, frontend health ở `/health` của port frontend.

## Tài liệu

- [Cổng tài liệu](docs/README.md)
- [Tổng quan kiến trúc](ARCHITECTURE.md)
- [Agent system, QA, retrieval và evidence](docs/architecture/agent-system.md) (bao gồm Chat Agent P0–P2)
- [Kiến trúc hệ thống chi tiết](docs/architecture/system-overview.md)
- [Phát triển và kiểm thử local](docs/development/local-development-and-testing.md)
- [Cấu hình vận hành](docs/operations/configuration.md)
- [Migration và ranh giới Data API](docs/operations/database-migrations.md)
- [Triển khai Azure](docs/operations/deployment.md)
- [Tóm tắt bàn giao và known gaps](docs/summary.md)

## Cấu trúc repository

```text
backend/src/          FastAPI, agent graph, tool, service, worker và persistence
backend/migrations/   Chuỗi migration Alembic cho PostgreSQL
frontend/src/         Next.js routes, component, API client và PDF renderer
tests/                Backend, integration và evaluation tests
frontend/src/**/*.test.*  Frontend unit/component tests đặt cạnh source
evaluations/          Scorecard/report đã sinh; không phải source của harness
scripts/              Migration, security, benchmark và knowledge-base utilities
config.yaml           Default runtime không chứa secret
.env.example          Inventory biến môi trường
.github/workflows/    Quality gate, build image và triển khai Azure
```

Khi tài liệu và implementation khác nhau, source trong `backend/src/`, `frontend/src/`, migration, test và workflow triển khai là nguồn sự thật. [docs/summary.md](docs/summary.md) ghi rõ known gap và bằng chứng release còn thiếu; không suy diễn staging/production readiness từ benchmark local.
