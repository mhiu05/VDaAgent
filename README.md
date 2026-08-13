# VDaAgent — Data Profiling & Analysis Workspace

VDaAgent là workspace giúp biến một dataset thành hồ sơ dữ liệu có thể kiểm tra,
review và dùng cho phân tích có evidence.

Nguyên tắc cốt lõi:

- Compute engine tạo các con số deterministic; LLM chỉ diễn giải, retrieval và
  hỗ trợ Q&A.
- Metadata, proposal, quality issue, execution và audit được lưu theo workspace.
- PII và raw row không được đưa vào report/export thông thường.
- Mọi aggregate trong Analysis Workspace đều bounded, không nhận raw SQL từ
  frontend hoặc Agent.

## Luồng sử dụng

```text
Chọn workspace hoặc guest trial
        ↓
Upload dataset → Profiling deterministic
        ↓
Review metadata proposals (semantic type / key / PII)
        ↓
Profile report
   ┌────┼───────────────┬──────────────┐
   ↓    ↓               ↓              ↓
 Q&A  Kiểm định      Drift       Tạo Analysis
                                      ↓
                         Context → Quality gate
                                      ↓
                         Khám phá theo nhóm
                                      ↓
                            Aggregate evidence
```

Một workflow thông thường:

1. Mở workspace Analyst hoặc dùng guest Analyst để thử sản phẩm.
2. Tải CSV, TSV, Parquet hoặc JSON.
3. Chọn `sample` để khám phá nhanh hoặc `full` để quét toàn bộ source.
4. Mở profile report và xử lý các proposal còn pending.
5. Dùng report, Q&A, kiểm định thống kê hoặc drift.
6. Nếu cần trả lời một câu hỏi nghiệp vụ, tạo Analysis Session từ profile đã
   hoàn tất.
7. Khai báo row grain, dimensions và measures; approve context để chạy quality
   gate.
8. Trong “Khám phá dữ liệu”, chọn cách so sánh nhóm, metric, filter và thứ tự
   sắp xếp. Kết quả có execution ID và result hash.
9. Xuất report PDF/JSON và chọn những mục cần đưa vào bản xuất.

## Hai luồng truy cập

### Chưa đăng nhập — guest trial

Khi `AUTH_ALLOW_GUEST=true`, người dùng có thể chọn Viewer, Analyst hoặc Admin
trên navbar và dùng workspace tạm mà không cần tạo tài khoản.

- Guest được cấp token riêng cho browser session và workspace guest riêng.
- Quyền backend vẫn được kiểm tra theo role, giống luồng đăng nhập.
- Dữ liệu guest không gắn với email hay workspace cá nhân.
- Guest workspace/file có thể được dọn sau thời gian retention hoặc khi đổi role;
  không dùng guest trial cho dữ liệu production hoặc dữ liệu cần lưu lâu dài.
- Guest mode không dùng SQLite. Metadata vẫn đi qua PostgreSQL; storage dùng
  provider đã cấu hình cho guest (`GUEST_STORAGE_PROVIDER`).

### Đã đăng nhập

Người dùng đăng nhập bằng Supabase Auth. Access token và workspace hiện tại được
gửi tới backend trong `Authorization: Bearer` và `X-Workspace-Id`.

- Dữ liệu, lịch sử, report draft và workspace membership được giữ lâu dài.
- Role và capability được resolve lại ở backend cho từng request.
- Viewer chủ yếu đọc report đã publish.
- Analyst upload, profiling, review metadata, test, drift, Q&A và tạo Analysis.
- Admin có thêm quản lý member, report workflow, audit và workspace settings.

Trang chủ và Hướng dẫn chỉ là trang tổng quan; không gắn trạng thái role hiện tại.
Role/workspace chỉ có ý nghĩa khi người dùng bước vào workspace.

## Tính năng chính

- Profiling deterministic: schema, dtype, missingness, cardinality, uniqueness,
  duplicate, outlier, top values và correlation.
- Human-in-the-loop review cho semantic type, candidate key và PII proposal.
- Profile report có provenance, narrative summary và các metric đã kiểm chứng.
- Q&A theo profile evidence; có thể mở rộng tới external knowledge base nếu được
  cấu hình.
- Statistical tests với alpha và multiple-testing correction.
- Drift giữa hai profile run của cùng dataset.
- Analysis Workspace với context, quality gate và bounded aggregate.
- Exploration presets: so sánh nhóm, tìm nhóm dẫn đầu, tìm nhóm thấp nhất; có
  filter và insight max/min/spread.
- Export PDF hoặc JSON với checklist chọn từng nhóm nội dung, Chọn tất cả và Bỏ
  chọn tất cả. PDF đánh số phân cấp như `1`, `7.1`, `7.1.1`.
- Google Drive storage tùy chọn cho file lớn; Supabase vẫn là nguồn sự thật cho
  Auth, workspace, permission, metadata và audit.

## Kiến trúc

```text
Next.js :3000
  ├─ Supabase browser Auth / guest transport
  └─ HTTP JSON + SSE + X-Workspace-Id
                    ↓
FastAPI :8000/api/v1
  ├─ JWT/JWKS + workspace membership + capability checks
  ├─ LangGraph profiling và Q&A
  ├─ DuckDB / pandas / NumPy / SciPy compute
  ├─ PostgreSQL: metadata, checkpoint, retrieval, audit
  └─ Storage adapter: Supabase Storage hoặc Google Drive
```

Các thư mục quan trọng:

```text
backend/src/api/                 FastAPI routes
backend/src/agents/              LangGraph, prompts, read-only tools
backend/src/services/            compute, storage, retrieval, auth, quality gate
backend/src/models/              Pydantic contracts
backend/migrations/              Alembic migrations
frontend/src/app/                Next.js pages và API route cho PDF
frontend/src/components/         app shell, navbar, auth và UI dùng chung
frontend/src/lib/                API client, auth, types, SSE
scripts/                         knowledge-base và auth migration utilities
tests/                           backend/API/compute/security tests
data/knowledge_base/             corpus retrieval local
```

## Yêu cầu

- Python 3.11+
- Node.js 20+
- pnpm 9+
- PostgreSQL (Supabase PostgreSQL dùng cho production)
- Git
- LLM key tùy chọn về mặt compute; nếu thiếu, profiling/test/drift vẫn chạy,
  nhưng narrative/Q&A có thể không hoạt động hoặc dùng fallback.

## Cài đặt local

### Windows PowerShell

Từ thư mục root:

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

Mở `.env` và tối thiểu điền:

```env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/postgres
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

Nếu dùng Supabase Auth/Storage, điền thêm `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` và `SUPABASE_SECRET_KEY`. Không đưa secret key vào
`NEXT_PUBLIC_*`.

Khởi động hai terminal:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2
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

Chạy backend bằng `.venv/bin/python` và frontend bằng `pnpm dev --port 3000`.

Sau khi khởi động:

- Frontend: <http://localhost:3000>
- Health: <http://localhost:8000/health>
- API docs: <http://localhost:8000/docs> khi `APP_ENV` không phải `production`
- API prefix: <http://localhost:8000/api/v1>

Có thể dùng shortcut trên Windows nếu đã cài Make:

```text
make install
make dev
make health
make frontend-check
make frontend-build
```

## Cấu hình storage

### Supabase Storage mặc định

```env
STORAGE_PROVIDER=supabase
SUPABASE_STORAGE_BUCKET=p170-dataset
SUPABASE_STORAGE_PREFIX=datasets
SUPABASE_STORAGE_TIMEOUT_SECONDS=300
SUPABASE_STORAGE_RESUMABLE_THRESHOLD_MB=6
SUPABASE_STORAGE_CHUNK_MB=6
```

File lớn hơn ngưỡng resumable được upload theo chunk. Giới hạn ứng dụng mặc định
là `SECURITY_MAX_UPLOAD_MB=500`, nhưng Supabase Free có giới hạn file thực tế
50 MB. Nếu bucket/provider từ chối file lớn hơn giới hạn plan, cần dùng provider
khác hoặc nâng plan.

### Google Drive cho file lớn

Google Drive chỉ lưu binary source; Supabase vẫn lưu Auth, workspace, quyền,
dataset metadata và audit.

1. Tạo OAuth Web Client trong Google Cloud, bật Google Drive API.
2. Thêm redirect URI chính xác:
   `http://localhost:8000/api/v1/google-drive/callback`.
3. Tạo folder private và lấy ID sau `/folders/` làm `GOOGLE_DRIVE_FOLDER_ID`.
4. Tạo key mã hóa token:

   ```powershell
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

5. Điền `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
   `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` và:

   ```env
   STORAGE_PROVIDER=google_drive
   ```

6. Restart backend, vào `/datasets/new`, chọn Kết nối Google Drive và hoàn tất
   OAuth. Kết nối thuộc workspace; sau khi Admin kết nối, Analyst trong workspace
   có thể upload.

Không commit OAuth client secret, refresh token, Fernet key, `.env` hoặc API key.

## Role và capability

| Role | Phạm vi chính |
| --- | --- |
| Viewer | Đọc và export report đã publish. |
| Analyst | Viewer + upload, profiling, review metadata, test, drift, Q&A, Analysis và report draft/submit. |
| Admin | Analyst + quản lý member, review/publish/archive report, audit và workspace settings. |

Frontend chỉ ẩn/hiện action để UX rõ hơn. Backend mới là nơi quyết định quyền.
Thông thường: `401` là auth không hợp lệ, `403` là thiếu capability, `404` là
resource không thuộc workspace, `409 workspace_required` là cần chọn workspace.

## Route frontend chính

```text
/                         Trang chủ
/guide                    Hướng dẫn
/login, /signup           Auth
/dashboard                Dashboard theo role
/datasets                 Dataset và profile runs
/datasets/new             Upload và tạo profiling run
/profiles/{runId}         Profile report
/profiles/{runId}/review  Review proposal metadata
/profiles/{runId}/analysis Kiểm định, drift và export
/analyses                 Danh sách Analysis Session
/analyses/new             Tạo Analysis Session
/analyses/{sessionId}     Context, quality gate và exploration
/chat                     Agent Q&A
/reports                  Published report portal
/compare                  So sánh profile/drift
```

## API nhóm chính

Tất cả API nghiệp vụ có prefix `/api/v1`.

```text
GET/POST  /session, /me, /workspaces
POST      /datasets/upload
GET       /datasets, /datasets/{dataset_id}/runs
POST      /profile
GET       /profile/{run_id}
PATCH     /profile/{run_id}/confirm
POST      /profile/{run_id}/test
POST      /profile/{run_id}/drift
GET       /profile/{run_id}/report
POST      /qa và /qa/stream

POST      /analysis-sessions
POST      /analysis-sessions/{id}/context-versions
POST      /analysis-sessions/{id}/context-versions/{context_id}/approve
POST      /analysis-sessions/{id}/quality-gate
POST      /analysis-sessions/{id}/executions
GET       /analysis-sessions/{id}/executions

GET       /google-drive/status
GET       /google-drive/connect
DELETE    /google-drive/connection
```

## Kiểm tra trước khi commit

Từ root:

```powershell
python -m pytest -q
```

Từ `frontend/`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Health backend:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Test cần PostgreSQL test database riêng. Không trỏ test vào database production.

## Giới hạn hiện tại

- Một Analysis Session gắn với một profile run; chưa hỗ trợ join nhiều bảng.
- Analysis không nhận arbitrary SQL, notebook hoặc cleaning recipe.
- `deep` mode vẫn là workflow mở rộng; planner/approval nhiều bước chưa hoàn tất
  như quick bounded analysis.
- Sample run phù hợp khám phá nhanh, không mặc định là số liệu exact.
- Guest trial không phải cơ chế lưu trữ dài hạn.
- Published report là snapshot; thay đổi lớn cần tạo draft/version theo workflow
  report hiện có.

## Tài liệu liên quan

- [Technical summary](docs/summary.md)
- [.env.example](.env.example)
- [config.yaml](config.yaml)
- [Makefile](Makefile)
