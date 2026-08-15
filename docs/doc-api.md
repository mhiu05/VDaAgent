# Ghi chÃº API backend vÃ  lá»—i Preview schema

TÃ i liá»‡u nÃ y ghi láº¡i API backend theo commit lÃ m viá»‡c trÆ°á»›c Ä‘Ã³, nguyÃªn nhÃ¢n lá»—i hiá»‡n táº¡i khi báº¥m **Preview schema**, pháº§n Ä‘Ã£ sá»­a, vÃ  báº±ng chá»©ng kiá»ƒm tra.

## Commit dÃ¹ng Ä‘á»ƒ Ä‘á»‘i chiáº¿u

Commit Ä‘Æ°á»£c dÃ¹ng Ä‘á»ƒ review láº¡i backend:

```text
daabdb9 complete profiling agent updates
```

Commit nÃ y lÃ  láº§n push gáº§n trÆ°á»›c báº£n UI má»›i. á»ž commit nÃ y, flow preview file CSV khÃ´ng dÃ¹ng endpoint batch `/profile/files/preview`. Flow Ä‘Ãºng lÃ  gá»i láº§n lÆ°á»£t:

```text
POST /api/v1/profile/file/schema
POST /api/v1/profile/file/preview
```

## ToÃ n bá»™ API backend á»Ÿ commit `daabdb9`

CÃ¡c route dÆ°á»›i Ä‘Ã¢y Ä‘á»u náº±m dÆ°á»›i prefix:

```text
/api/v1
```

### Agent vÃ  conversation

```text
POST /chat
POST /conversations
GET  /conversations
GET  /conversations/{conversation_id}/messages
GET  /status
GET  /agent/tools
GET  /agent/runs
GET  /agent/runs/{run_id}
GET  /agent/runs/{run_id}/trace
GET  /agent/traces
```

### HITL

```text
GET  /hitl
POST /hitl/{record_id}/approve
POST /hitl/{record_id}/reject
```

### Profiling file

```text
POST /profile/file
POST /profile/file/schema
POST /profile/file/preview
POST /profile/file/columns
POST /profile/file/correlations
POST /profile/file/findings
POST /profile/file/sections
POST /profile/files
POST /profile/excel
```

Ã nghÄ©a chÃ­nh:

```text
POST /profile/file
```

Cháº¡y full profiling cho má»™t file CSV.

```text
POST /profile/file/schema
```

Äá»c schema nhanh, tráº£ `source_name`, `source_type`, `row_count`, `column_count`, `columns`.

```text
POST /profile/file/preview
```

Äá»c cÃ¡c dÃ²ng preview cá»§a file CSV.

```text
POST /profile/files
```

Upload nhiá»u CSV vÃ  cháº¡y profiling collection/cross-file relationship. ÄÃ¢y khÃ´ng pháº£i endpoint preview schema.

### Statistical tests

```text
POST /analysis/statistical-test/file
POST /analysis/pearson-correlation/file
POST /analysis/spearman-correlation/file
POST /analysis/independent-t-test/file
POST /analysis/chi-square-independence/file
POST /analysis/one-way-anova/file
POST /analysis/statistical-tests/file
POST /analysis/statistical-test/database
```

### Database profiling

```text
POST /profile/database/test
POST /profile/database/tables
POST /profile/database/schema
POST /profile/database/preview
POST /profile/database/query/preview
POST /profile/database/table
POST /profile/database/query
POST /profile/database/sections
```

## API backend hiá»‡n táº¡i

Code hiá»‡n táº¡i váº«n giá»¯ toÃ n bá»™ API profiling chÃ­nh cá»§a commit `daabdb9`, Ä‘á»“ng thá»i cÃ³ thÃªm má»™t sá»‘ API má»›i cho workspace, knowledge, profiling plan, saved reports vÃ  report comments:

```text
GET  /users/{user_id}/workspace
PUT  /users/{user_id}/workspace
POST /knowledge/documents
GET  /knowledge/documents
GET  /knowledge/search
POST /profiling/plans
POST /profiling/plans/{plan_id}/confirm
POST /profiling/database-plan
GET  /users/{user_id}/rules
POST /users/{user_id}/rules
GET  /profile/reports
GET  /profile/reports/{run_id}
GET  /profile/reports/{run_id}/comments
POST /profile/reports/{run_id}/comments
```
### `POST /api/v1/profiling/database-plan`

Recommend database tables from uploaded requirement documents and custom requirements after the user has configured a database connection and loaded/listed available tables.

Input JSON:

```json
{
  "user_id": "anonymous",
  "tables": [
    { "schema": "public", "table": "orders" },
    { "schema": "public", "table": "customers" }
  ],
  "custom_requirements": "bao cao customer va pii",
  "document_ids": ["doc_xxx"],
  "max_tables": 3
}
```

Output JSON:

```json
{
  "recommended_tables": [
    {
      "schema_name": "public",
      "table_name": "customers",
      "score": 1.0,
      "reason": "Matched requirement terms: customer.",
      "matched_terms": ["customer"]
    }
  ],
  "questions": [
    "Confirm these tables before profiling, especially if the requirement mentions business concepts not visible in table names."
  ],
  "evidence": [
    "Selected tables from requirement document and available database object names."
  ]
}
```

Frontend uses this API from the **Agent select from docs** action. The API does not create database credentials or connect by itself; it ranks the already available table list, then the frontend previews the selected tables through existing database schema/preview APIs.

Pháº§n quan trá»ng: backend hiá»‡n táº¡i khÃ´ng cÃ³ route:

```text
POST /api/v1/profile/files/preview
```

VÃ¬ váº­y frontend khÃ´ng Ä‘Æ°á»£c gá»i endpoint nÃ y.

## NguyÃªn nhÃ¢n lá»—i

CÃ³ hai lá»—i bá»‹ chá»“ng lÃªn nhau:

1. Sau khi sá»­a UI, frontend cÃ³ lÃºc bá»‹ Ä‘á»•i sang gá»i sai endpoint:

```text
http://localhost:8000/api/v1/profile/files/preview
```

Endpoint nÃ y khÃ´ng tá»“n táº¡i trong backend cÅ© láº«n backend hiá»‡n táº¡i.

2. Sau khi frontend Ä‘Ã£ Ä‘Æ°á»£c sá»­a quay vá» endpoint Ä‘Ãºng:

```text
http://localhost:8000/api/v1/profile/file/schema
```

browser váº«n bÃ¡o `Failed to fetch` vÃ¬ `.env` local Ä‘ang override CORS, chá»‰ cho:

```text
http://localhost:3000
http://127.0.0.1:3000
```

Trong khi Vite frontend Ä‘ang cháº¡y á»Ÿ:

```text
http://localhost:5173
```

Do Ä‘Ã³ request tá»« browser bá»‹ CORS cháº·n. `curl` váº«n gá»i Ä‘Æ°á»£c vÃ¬ `curl` khÃ´ng bá»‹ chÃ­nh sÃ¡ch CORS cá»§a browser Ã¡p dá»¥ng.

## Fix Ä‘Ã£ lÃ m

### 1. Frontend gá»i láº¡i Ä‘Ãºng flow backend cÅ©

Khi báº¥m **Preview schema**, frontend gá»i:

```text
POST /api/v1/profile/file/schema
POST /api/v1/profile/file/preview
```

KhÃ´ng cÃ²n gá»i:

```text
POST /api/v1/profile/files/preview
```

### 2. Sá»­a CORS trong `.env`

ÄÃ£ thÃªm origin cá»§a Vite:

```text
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
```

### 3. Sá»­a parser CORS trong backend

Trong `src/main.py`, Ä‘á»•i tá»«:

```python
allow_origins=settings.cors_origins.split(",")
```

sang:

```python
allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
```

Viá»‡c nÃ y trÃ¡nh lá»—i náº¿u `.env` cÃ³ dáº¥u cÃ¡ch hoáº·c pháº§n tá»­ rá»—ng.

### 4. Sá»­a frontend hiá»ƒn thá»‹ lá»—i rÃµ hÆ¡n

Frontend hiá»‡n nÃ©m lá»—i kÃ¨m URL request, vÃ­ dá»¥:

```text
college_sleep_and_gpa.csv: Failed to fetch (http://localhost:8000/api/v1/profile/file/schema)
```

Toast Ä‘á» cÅ©ng hiá»ƒn thá»‹ message tháº­t thay vÃ¬ chá»‰ hiá»‡n khá»‘i Ä‘á» trá»‘ng.

## Báº±ng chá»©ng kiá»ƒm tra

### 1. Backend compile pass

Lá»‡nh Ä‘Ã£ cháº¡y:

```powershell
.\.venv\Scripts\python.exe -m py_compile src\api\routes.py src\config.py
```

Káº¿t quáº£: khÃ´ng lá»—i.

### 2. Frontend build pass

Lá»‡nh Ä‘Ã£ cháº¡y:

```powershell
cd frontend
npm.cmd run build
```

Káº¿t quáº£: build thÃ nh cÃ´ng.

### 3. Backend live tráº£ schema thÃ nh cÃ´ng

Lá»‡nh Ä‘Ã£ cháº¡y:

```powershell
curl.exe -s -i -F "file=@dataset/college_sleep_and_gpa.csv" -F "user_id=codex-check" -H "Origin: http://localhost:5173" http://localhost:8000/api/v1/profile/file/schema
```

Káº¿t quáº£ chÃ­nh:

```text
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:5173
source_name: college_sleep_and_gpa.csv
row_count: 634
column_count: 22
```

### 4. CORS preflight tá»« browser origin pass

Lá»‡nh Ä‘Ã£ cháº¡y:

```powershell
curl.exe -s -i -X OPTIONS "http://localhost:8000/api/v1/profile/file/schema" -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST"
```

Káº¿t quáº£ chÃ­nh:

```text
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:5173
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
```

### 5. TestClient backend xÃ¡c nháº­n CORS config má»›i

Káº¿t quáº£ kiá»ƒm tra báº±ng FastAPI TestClient:

```text
200
http://localhost:5173
DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
```

## CÃ¡ch cháº¡y láº¡i Ä‘á»ƒ nháº­n fix

Sau khi sá»­a `.env`, backend pháº£i restart Ä‘á»ƒ Ä‘á»c láº¡i config CORS.

Terminal backend:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Terminal frontend:

```powershell
cd frontend
npm.cmd run dev
```

Sau Ä‘Ã³ hard refresh browser:

```text
Ctrl + Shift + R
```

Náº¿u váº«n tháº¥y request tá»›i `/profile/files/preview`, nghÄ©a lÃ  browser hoáº·c Vite váº«n Ä‘ang giá»¯ bundle cÅ©. Khi Ä‘Ã³ cáº§n táº¯t háº³n terminal frontend cÅ© rá»“i cháº¡y láº¡i `npm.cmd run dev`.
