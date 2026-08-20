# VDaAgent — Data Profiling & Evidence Workspace

VDaAgent giúp một nhóm Analyst biến dataset thành Profile Run có thể kiểm tra, khám phá bằng aggregate an toàn, diễn giải bằng Agent và xuất báo cáo có provenance.

## Luồng chính

```text
Upload dataset
  → Profile Run
  → Review proposal metadata và PII
  → Command Center
      ├─ Tổng quan
      ├─ Khám phá dữ liệu
      ├─ Hỏi Agent
      └─ Báo cáo
```

1. Tạo hoặc chọn workspace, sau đó upload CSV, TSV, Parquet hoặc JSON.
2. Chạy Profile Run ở chế độ `sample` hoặc `full`.
3. Review các đề xuất semantic type, candidate key và PII trước khi khám phá.
4. Trong tab **Khám phá**, chạy Preview để thử nhanh. Promote Preview thành kết quả chính thức khi muốn dùng làm evidence.
5. Trong tab **Hỏi Agent**, đặt câu hỏi về Profile Run hoặc một kết quả chính thức. `Enter` gửi câu hỏi; `Shift + Enter` xuống dòng.
6. Ghim kết quả Explorer hoặc câu trả lời Agent đã xác thực vào **Report Draft**.
7. Tạo snapshot, sau đó xuất PDF. PDF dùng snapshot bất biến gần nhất.

`/analyses` và `/notebooks` không còn là route hay workflow của sản phẩm.

## Tính năng

- Profiling có thống kê cột, missingness, cardinality, outlier, tương quan và cảnh báo PII.
- Proposal review theo Human-in-the-loop; raw rows và PII không được đưa vào output thông thường.
- Explorer chỉ chạy aggregate bounded; không chấp nhận raw SQL từ browser hoặc Agent.
- Tách Preview và Official. Chỉ Official mới có thể ghim vào báo cáo.
- Agent diễn giải profile/evidence đã tính, không tự tính lại metric hay đọc raw rows.
- Trace ở chế độ `shadow` lưu evidence đã redact để câu trả lời có thể xác thực và ghim vào báo cáo.
- Report Draft hỗ trợ sắp xếp, bỏ ghim, snapshot và PDF có section: Tổng quan, Hồ sơ kỹ thuật, Chất lượng, Tóm tắt Agent, So sánh dữ liệu, Snapshot báo cáo và kết quả Explorer chính thức.
- So sánh dữ liệu giữa các Profile Run tương thích; statistical testing không còn xuất hiện trong PDF.
- Workspace, membership, audit, Supabase Auth và optional Google Drive storage.

## Kiến trúc

```text
Next.js :3000
  └─ Supabase SSR Auth, React Query, JSON/SSE, PDF proxy
                         ↓
FastAPI :8000/api/v1
  ├─ Authentication, workspace membership và capability checks
  ├─ Profiling, Explorer, Q&A và report workflow
  ├─ DuckDB, pandas, NumPy và SciPy cho compute bounded
  ├─ PostgreSQL cho metadata, audit, report và agent provenance
  └─ Storage adapter: Supabase Storage, Google Drive hoặc local dev/test
```

## Cài đặt local

### Yêu cầu

- Python 3.11+
- Node.js 20+
- pnpm 9+
- PostgreSQL cho môi trường tích hợp/production
- Một LLM key nếu muốn narrative và Q&A đầy đủ

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env

corepack enable
Set-Location frontend
pnpm install
Set-Location ..
```

Điền các biến cần thiết trong `.env`; không commit file này. Bật Command Center khi phát triển UI:

```env
UX_COMMAND_CENTER_ENABLED=true
NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true
```

Khởi động hai terminal:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2
Set-Location frontend
pnpm dev --port 3000
```

- Frontend: http://localhost:3000
- Backend health: http://localhost:8000/health
- API docs: http://localhost:8000/docs khi không ở production

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

Chạy backend bằng `.venv/bin/python -m uvicorn src.main:app --app-dir backend --reload` và frontend bằng `cd frontend && pnpm dev --port 3000`.

## Cấu hình quan trọng

| Biến | Mục đích |
| --- | --- |
| `DATABASE_URL` | PostgreSQL metadata database; production bắt buộc. |
| `AUTH_MODE` | `supabase` cho production; `dual` chỉ là bridge phát triển. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Auth và Supabase storage. |
| `STORAGE_PROVIDER` | `supabase`, `google_drive` hoặc `local`. |
| `LLM_PROVIDER`, `LLM_MODEL`, provider API key | Narrative và Q&A. |
| `AGENT_TRACE_MODE` | Mặc định `shadow`; ghi provenance đã redact. |
| `UX_COMMAND_CENTER_ENABLED` | Bật backend contract Command Center. |
| `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | Bật Command Center ở frontend. |

Environment variables trong `.env` ưu tiên hơn `config.yaml`. Sau khi thay đổi config backend, restart backend nếu không dùng auto-reload.

## Route frontend

```text
/                             Trang chủ
/guide                        Hướng dẫn
/login, /signup               Authentication
/datasets                     Danh sách dataset
/datasets/new                 Upload và tạo Profile Run
/datasets/{datasetId}/runs    Lịch sử Profile Run
/profiles/{runId}             Profile Run Command Center
/profiles/{runId}/review      Review proposal metadata
/reports                      Thư viện Report Draft và report đã xuất bản
/reports/{reportId}           Chi tiết report và PDF
/compare                      So sánh Profile Run
/chat                         Agent Q&A theo workspace
/workspaces, /settings        Workspace context, theme và thành viên
/activity                     Activity log
```

## API chính

Tất cả API backend dùng prefix `/api/v1`.

```text
POST      /datasets/upload
GET       /datasets
POST      /profile
GET       /profile/{run_id}
PATCH     /profile/{run_id}/confirm
POST      /profile/{run_id}/explorer/previews
POST      /profile/{run_id}/explorer/previews/{preview_id}/promote
GET       /profile/{run_id}/report-draft
GET/POST  /profile/{run_id}/report
POST      /qa
POST      /qa/stream
POST      /reports/{report_id}/items
POST      /reports/{report_id}/snapshots
GET       /reports/{report_id}/export-source
GET       /agent-runs/{run_id}/evidence
```

PDF được tạo qua Next.js proxy: `/api/reports/profile/{runId}`. Khi export từ Report Draft, client gửi `reportId` để lấy snapshot đã đóng băng thay vì lấy trạng thái draft đang chỉnh sửa.

## Kiểm tra

```powershell
# Frontend
Set-Location frontend
pnpm typecheck
pnpm lint
pnpm test:e2e

# Backend, từ repository root
.\.venv\Scripts\python.exe -m compileall -q backend/src
.\.venv\Scripts\python.exe -m ruff check backend tests
```

Backend integration tests cần PostgreSQL test database riêng. Đặt `P170_TEST_DATABASE_URL` trước khi chạy:

```powershell
$env:P170_TEST_DATABASE_URL = 'postgresql+psycopg://p170_test:<password>@localhost:5432/p170_test'
.\.venv\Scripts\python.exe -m pytest -q
```

Không chạy test tích hợp vào database development hoặc production.

## Giới hạn hiện tại

- Không hỗ trợ raw SQL, raw-row analysis, source cleaning hay join nhiều bảng.
- Preview là bounded sample; Official là nguồn evidence để chia sẻ hoặc ghim báo cáo.
- Agent evidence chỉ được coi là verified khi có provenance lưu cho đúng Profile Run.
- Planner tự do, verifier enforce, jobs và long-term memory chưa được phát hành.
- Guest workspace dành cho thử nghiệm, không dành cho lưu trữ dài hạn.

## Tài liệu liên quan

- [Technical summary](docs/summary.md)
- [Architecture](ARCHITECTURE.md)
- [Configuration](config.yaml)
- [Environment template](.env.example)
- [Backend migrations](backend/migrations)
