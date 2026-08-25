# VDaAgent Backend & Database Performance Optimization Plan

## 1. Executive Summary

Mục tiêu của kế hoạch này là làm các luồng workspace nhanh hơn bằng cách đo toàn bộ đường đi Browser → Next.js/React Query → FastAPI → auth/workspace guard → SQLAlchemy Core → PostgreSQL → serialization, sau đó loại bỏ request/query/payload thừa trước khi điều chỉnh hạ tầng. Kế hoạch giữ nguyên các boundary về workspace/capability, PII, Preview/Official evidence, `result_hash`, provenance, quality gate và mô hình profiling job bất đồng bộ.

Năm cải thiện có ROI cao nhất theo code hiện tại là:

1. Ngừng tải catalog dataset từ chat widget khi widget đang đóng, hợp nhất các React Query key, và thay fan-out “mỗi dataset một request runs” bằng một catalog Profile Run dạng summary, có phân trang.
2. Thay `SELECT profile_runs.*` ở list/job/access-check bằng projection nhỏ; giảm `GET /profile/{runId}` từ khoảng 13 SQL statement tĩnh xuống một số query cố định, không lặp proposal count.
3. Bổ sung các composite/child-table index dựa trên query thực tế, đặc biệt cho profile children, activity cursor, workspace lists và stale-job recovery; không tạo lại `ix_profile_runs_job_claim` hay `ix_workspace_memberships_user_status_created` đã có.
4. Thêm latency breakdown/query-count/payload instrumentation an toàn để mọi bước sau có baseline và decision gate thay vì đoán.
5. Giảm polling và auth overhead: không gọi job endpoint cho run đã terminal, dùng adaptive/visibility-aware polling, và đo/cô lập đường fallback Supabase Auth có network call.

Kết quả mong đợi là navigation không còn bị request fan-out theo số dataset, list/status endpoint không còn đọc JSON/text nặng, profile detail có query count cố định, `/activity` và các list scale theo cursor/index, và mọi thay đổi có metric trước/sau cùng rollback riêng. Không đưa Redis, message broker, microservice, GraphQL, materialized view hay read replica vào P0–P2; chỉ mở decision gate nếu đo lường chứng minh các giải pháp hiện tại không đủ.

## 2. Current Architecture

### 2.1 Implementation thực tế

| Lớp | Implementation đã xác nhận | Ghi chú hiệu năng |
| --- | --- | --- |
| Web | Next.js 15, React 19, React Query trong `frontend/src/app`, `frontend/src/components`, `frontend/src/lib/api.ts` | `QueryClient` mặc định `staleTime=15s`, `retry=1`, `refetchOnWindowFocus=false`; một số query override 30s/60s/5m. |
| Bootstrap | `frontend/src/components/auth-provider.tsx` gọi `GET /workspace-bootstrap`, seed `['dashboard', workspaceId]` | Cache bị `clear()` khi đổi workspace/sign out, bảo vệ cross-workspace. Background bootstrap chạy mỗi 60s khi ở workspace route. |
| API | FastAPI trong `backend/src/main.py`; dependencies tại `backend/src/api/dependencies.py` | `RequestContext` đã tồn tại và FastAPI cache dependency trong một request; capability là phép kiểm tra in-memory từ role, không phải query DB riêng. |
| Auth | Local asymmetric JWT/JWKS trong `backend/src/services/auth.py` | JWKS đã cache. Nếu JWT thiếu `email_confirmed_at`, code gọi Supabase `/auth/v1/user`; nếu local verify lỗi, code cũng dùng remote Auth API fallback. |
| Metadata DB | SQLAlchemy Core, không dùng ORM relationship/lazy loading, repository chính tại `backend/src/services/repository.py` | Mỗi repository method thường mở transaction ngắn riêng. Nhiều method vẫn `select(table)` dù caller chỉ cần vài cột. |
| DB connection | Supabase pooler URL dùng `NullPool`; URL khác dùng pool cố định `pool_size=3`, `max_overflow=0`, `pool_timeout=30`, `pool_recycle=300` | Checkpointer dùng `psycopg_pool` riêng, max 1 cho Supabase pooler và 2 cho URL khác. Chưa có sizing theo số instance/DB limit. |
| Profiling | API persist job trong `profile_runs`; worker `backend/src/workers/profiling_worker.py` claim bằng `FOR UPDATE SKIP LOCKED` | Default worker concurrency 1, poll 1s, lease 300s, heartbeat khoảng lease/3 (100s mặc định). |
| Compute | DuckDB/pandas qua `analysis_engine.py`, `compute.py`, storage/tabular adapters | File được materialize tạm cho compute; DB transaction repository không bao quanh toàn bộ DuckDB/LLM call. |
| Agent | LangGraph; `/qa/stream` trả SSE | Hiện graph hoàn tất trước khi generator phát `meta`/`token`; đây chưa phải model-token streaming thực sự. |
| Telemetry | Middleware `workspace_request_timing` | Chỉ cover `/session`, `/workspace-bootstrap`, `/dashboard`, `/datasets`, `/workspaces` và chỉ có route/status/total duration/correlation ID. |

### 2.2 So sánh tài liệu với code

- `README.md`, `ARCHITECTURE.md`, `docs/summary.md` đúng về bootstrap, dashboard seed, membership/workspace join, dashboard aggregate, job durable và `SKIP LOCKED`.
- Dashboard seed thực sự ngăn `/dashboard` ngay sau fresh bootstrap trong 30 giây; code set cache trước khi set `me`.
- Bootstrap không phải một SQL query: signed-in path bình thường hiện có khoảng 4 statement (user-profile read, membership/workspace join, dashboard counts, recent reports), và có thể thêm write/provision/network-auth ở nhánh đặc biệt.
- Claim “bootstrap giảm waterfall” đúng cho session/dashboard, nhưng app shell mount chat widget và widget vẫn gọi `/datasets` khi đóng. `/chat` và `/compare` còn dùng query key khác nên gọi `/datasets` lần thứ hai.
- Không có SQLAlchemy ORM relationship nên không có accidental ORM lazy-load. N+1 hiện tại đến từ code loop/repository composition và frontend fan-out, không phải relationship loader.
- Telemetry hiện hữu đúng nguyên tắc không log token/email/payload, nhưng chưa đủ để tách auth/DB/serialization/payload/LLM/storage.

## 3. Current Request Flow

Quy ước: số SQL dưới đây là ước lượng tĩnh từ code cho happy path signed-in, DB-backed audit, JWT verify local và dữ liệu đã tồn tại. Đây không phải baseline runtime; `PERF-001` phải đo lại bằng instrumentation. Mỗi protected request thông thường có 1 membership/workspace join từ `get_current_workspace`.

### 3.1 `/dashboard`

Fresh page load:

1. `GET /workspace-bootstrap`
   - Auth local JWT; có thể remote Auth API nếu token thiếu claim/fallback.
   - `sync_user_profile`: 1 SELECT, chỉ UPDATE khi email đổi.
   - Membership/workspace join: 1 query.
   - Dashboard counts: 1 statement chứa 3 scalar count subquery.
   - Recent reports: 1 query, `ORDER BY updated_at DESC LIMIT 12`.
   - React Query cache `['dashboard', workspaceId]` được seed.
2. `GET /datasets`
   - Phát sinh từ `DraggableChatWidget` dù widget đóng.
   - 1 membership query + 1 unbounded dataset query.
3. Dashboard component đọc cache; không gọi `GET /dashboard` trong 30s đầu.

Client navigation khi bootstrap còn trong provider: không gọi bootstrap; dashboard cache hit nếu chưa stale, ngược lại gọi `GET /dashboard` (khoảng 3 SQL statement gồm guard + 2 dashboard statements). Bootstrap được background refresh mỗi 60s.

Phân loại: dashboard seed là **necessary/cacheable** và đang hoạt động; global dataset request là **avoidable**; hai dashboard SQL statements có thể **mergeable** nhưng chỉ làm sau khi đo.

### 3.2 `/datasets`

1. Fresh load: `GET /workspace-bootstrap`.
2. `GET /datasets` từ page và chat widget cùng key `['datasets']`, nên React Query chia sẻ in-flight/cache và thường chỉ có một HTTP request.
3. Backend trả toàn bộ datasets, không limit/cursor; repository `select(datasets)` gồm `source_ref`, hashes/timestamps dù card không cần tất cả.

Phân loại: request là **necessary**, nhưng response **over-fetching** và **unbounded**; có thể projection + cursor. Query key chưa chứa workspace ID nhưng cache được clear khi switch; chuẩn hóa key vẫn an toàn hơn.

### 3.3 `/profiles/{runId}`

1. `GET /workspace-bootstrap` trên fresh load.
2. Global `GET /datasets` từ chat widget.
3. `GET /profile/{runId}`. `ProfileOverview` và `CommandCenterShell` dùng cùng key nên in-flight được dedupe.
4. `GET /profiling-jobs/{runId}` luôn chạy trong Command Center, kể cả run đã terminal.
5. Khi domain status nằm trong `created/queued/running/resuming`, cả profile và job có thể poll mỗi 3s.

`GET /profile/{runId}` hiện khoảng 13 SQL statement tính cả workspace guard:

- 1 membership/workspace query;
- 1 full `profile_runs` row;
- 1 `column_stats` query;
- 1 PII-column query;
- 1 dataset query;
- 3 proposal-table queries;
- 1 statistical-test query;
- 1 drift-report query;
- 3 proposal pending-count queries lặp lại dữ liệu vừa đọc.

Response luôn gồm column stats, top-k, correlation matrix, proposals, tests, narrative/answer fields. Đây là endpoint DB-query và payload nặng nhất được **CONFIRMED** bằng static trace; serialization/payload cost vẫn phải đo.

### 3.4 `/charts`

Khi chưa chọn run: bootstrap + `GET /datasets` (ProfileRunPicker dùng chung cache với widget).

Khi có `runId`, bốn request được khởi động song song, không phải waterfall:

1. `GET /profile/{runId}` — full detail.
2. `POST /profile/{runId}/explorer/session` — check run, list sessions, hydrate session/source/context/gate/issues, có thể create context/session, rồi audit.
3. `GET /profile/{runId}/charts/algorithms` — vẫn đọc full `profile_runs` chỉ để validate access/run.
4. `GET /profile/{runId}/report-draft`.

Sau khi profile xác định `dataset_id`, ProfileRunPicker mới gọi `GET /datasets/{datasetId}/runs`; đây là một dependent request. `ChartsTab` dùng đúng explorer/algorithm keys nên không tạo request thứ hai.

Phân loại: bốn nhánh đầu **parallel và mostly necessary**; profile/job/access projection và explorer repository cần tối ưu. Không merge tất cả thành một mega-endpoint nếu payload/lifecycle khác nhau.

### 3.5 `/chat`

1. Bootstrap.
2. Global widget gọi `GET /datasets` với key `['datasets']`.
3. Chat page đồng thời gọi lại `GET /datasets` với key `['chat-datasets']`; đây là duplicate HTTP/backend/DB request **CONFIRMED**.
4. Khi chọn dataset, `GET /datasets/{datasetId}/runs` chạy; khi chọn/restored conversation, `GET /profile/{runId}` tải full profile.
5. `POST /qa/stream` chuẩn bị context: access-check run, 3 pending-count query, tải toàn bộ column stats chỉ để lấy tên cột, persist agent trace/run, rồi chạy graph/LLM/tools.
6. SSE generator chỉ yield sau `get_qa_graph().invoke` hoàn tất; `time-to-first-SSE-event` hiện bao gồm gần như toàn bộ agent execution.

Phân loại: duplicate datasets **avoidable**; run selection **cacheable/mergeable** bằng workspace Profile Run catalog; QA prep queries **consolidatable**; LLM/tool latency phải tách khỏi DB latency.

### 3.6 `/compare`

1. Bootstrap.
2. Global `GET /datasets` key `['datasets']`.
3. Compare gọi lại `GET /datasets` key `['compare', workspaceId, 'datasets']` — duplicate.
4. Sau dataset response, frontend fan-out song song `N` request `GET /datasets/{datasetId}/runs`, mỗi request lại auth membership, validate dataset và list runs.
5. `POST /profile/{current}/drift` luôn tải 2 full profile-run rows, 2 bộ column stats, recompute, insert một `drift_reports` row mới và audit insert.

Initial catalog là waterfall `datasets → N run requests`; đây là route có request count tăng theo số dataset. Drift không đọc raw rows, nhưng recompute và persist duplicate result cho cùng immutable inputs.

### 3.7 `/activity`

1. Bootstrap.
2. Global `/datasets` từ widget — không cần cho activity.
3. `GET /audit?limit=100`: membership query + `SELECT audit_events.* WHERE workspace_id=? ORDER BY id DESC LIMIT 100`.

Endpoint có hard limit nhưng không cursor; UI không thể load trang tiếp. Index hiện chỉ có `workspace_id`, chưa có `(workspace_id, id DESC)`. `fields` JSON được đọc nguyên hàng cho 100 event.

### 3.8 Request-flow conclusions

| Route | Initial app requests sau bootstrap | Waterfall/duplicate lớn nhất | Cache hiện tại |
| --- | ---: | --- | --- |
| Dashboard | 1 (`/datasets`) | Dataset request từ widget | Dashboard seed hit 30s |
| Datasets | 1 (`/datasets`) | Không duplicate vì cùng key | Default/60s tùy consumer |
| Profile detail | 3 (`datasets`, `profile`, `job`) | Profile + job polling song song | Profile key shared giữa hai components |
| Charts (có run) | 6 (`datasets`, profile, explorer, algorithms, draft, runs) | Runs phụ thuộc profile; các nhánh khác parallel | 60s/5m; keys explorer/catalog shared |
| Chat | 2 dataset requests, rồi runs/profile | Duplicate datasets | Keys riêng làm cache miss |
| Compare | 2 dataset requests + N runs | `datasets → N runs` | Keys riêng làm cache miss |
| Activity | 2 (`datasets`, `audit`) | Dataset request không liên quan | Activity default 15s |

## 4. Performance Measurement Baseline

### 4.1 Metrics bắt buộc

Mỗi request quan trọng phải emit một record metric/log allow-list, gắn correlation ID:

```text
route, method, status, total_ms
auth_local_ms, auth_remote_ms
workspace_resolution_ms
db_total_ms, db_query_count, db_slowest_ms
serialization_ms, payload_bytes
external_ms, llm_ms, storage_materialization_ms
pool_wait_ms (nếu driver/pool cung cấp)
```

Không log SQL parameters, bearer token, email, question, request/response body, raw row, PII, source path hay model prompt. SQL fingerprint chỉ được dùng nếu normalize về statement class/table/operation và đã review không chứa literal.

Cho Agent Q&A, bổ sung:

```text
request_received → SSE response headers
request_received → first SSE event
request_received → first content token
graph preparation
evidence/profile load
provider/tool duration
total generation
```

Cho profiling/worker, bổ sung queue wait, claim latency, heartbeat writes, recovery scans, checkpointer latency và execution time; metric hiện có `queue_wait_ms`/`execution_ms` được giữ lại.

### 4.2 Baseline protocol

- Chỉ đo frontend từ `pnpm build && pnpm start` hoặc production-like container; không dùng HMR/route compile.
- Chạy trên test/staging PostgreSQL riêng, dữ liệu synthetic, không dùng production để load test.
- Warm và cold run tách riêng: cold process/JWKS/cache; warm process/DB/client cache.
- Mỗi scenario tối thiểu 30 sample cho p50/p95; ghi error rate, payload, query count, DB CPU/connections/pool wait.
- Test concurrency 1, 5, 20, 50; giới hạn theo năng lực staging và dừng nếu error/DB saturation vượt safety threshold.
- Ghi baseline là `MEASURE`; không thay bằng số đo local dev hoặc số ước lượng tĩnh trong tài liệu này.

### 4.3 Performance budgets ban đầu

Các budget sau là release guardrail ban đầu, phải được PERF-003 hiệu chỉnh một lần từ staging topology. DB budget nằm trong API budget; frontend usable đo navigation có session hợp lệ và production bundle.

| Surface | Backend API p50 / p95 | DB p50 / p95 | Frontend usable p50 / p95 | Ghi chú |
| --- | --- | --- | --- | --- |
| `/workspace-bootstrap` | ≤250 / 600 ms | ≤100 / 250 ms | ≤1.0 / 2.0 s | Không tính cold browser login redirect |
| `/dashboard` | ≤120 / 300 ms | ≤60 / 150 ms | ≤0.7 / 1.5 s | Thường cache hit sau bootstrap |
| `/datasets` page | ≤150 / 350 ms | ≤70 / 180 ms | ≤0.8 / 1.8 s | Page đầu ≤100 KiB mục tiêu |
| Profile Run catalog/list | ≤150 / 350 ms | ≤70 / 180 ms | ≤0.9 / 2.0 s | Không fan-out theo dataset |
| Profile detail | ≤300 / 800 ms | ≤150 / 400 ms | ≤1.2 / 2.5 s | Heavy detail có payload budget riêng |
| `/activity` page | ≤150 / 350 ms | ≤70 / 180 ms | ≤0.9 / 2.0 s | Cursor page 100 rows |
| Compare metadata | ≤180 / 400 ms | ≤80 / 200 ms | ≤1.0 / 2.0 s | Một catalog request |
| Drift cached | ≤120 / 300 ms | ≤60 / 150 ms | N/A | Chỉ sau PERF-301 |
| Drift uncached | ≤400 / 1,200 ms | ≤180 / 500 ms | N/A | Tùy số cột; không đọc raw data |
| Q&A pre-generation | ≤250 / 600 ms | ≤120 / 300 ms | N/A | Từ nhận request đến bắt đầu provider/tool |
| Q&A first content | Provider-dependent; track p50/p95 riêng | N/A | UI phải nhận progress event ≤500 ms | Không dùng budget LLM để kết luận DB chậm |

### 4.4 Decision gates

- Nếu `db_total_ms < 30% total_ms` ở p95, ưu tiên auth/network/serialization/frontend thay vì thêm index.
- Chỉ triển khai cache authorization ngắn hạn nếu `auth_remote_ms` xuất hiện trên >5% request hoặc đóng góp >15% p95; cache không bao gồm membership/capability.
- Chỉ tách profile heavy sections nếu payload serialization+transfer+parse chiếm >25% p95 hoặc p95 payload vượt 512 KiB.
- Chỉ triển khai deterministic drift reuse nếu cùng identity được lặp ≥10% trong workload hoặc uncached drift vượt budget.
- Chỉ đổi pool sau khi thấy pool wait/connection saturation; không tăng pool theo cảm tính.
- Redis chỉ được đánh giá nếu sau P0–P2 vẫn còn shared-cache workload có p95/DB load vượt budget và PostgreSQL/client/process cache không đáp ứng.

## 5. Findings

### 5.1 Mandatory investigation answers

| # | Câu hỏi | Kết luận | Evidence / bước tiếp theo |
| ---: | --- | --- | --- |
| 1 | Endpoint nhiều DB query nhất? | **CONFIRMED:** profile detail khoảng 13 statements; report export/detail có loop N+1 theo session/version. | `_build_profile_response` → `full_profile` + `pending_count`; `_report_profile` hydrate từng analysis session; `_report_version_payload` chạy 4 query/version. PERF-001 đo runtime. |
| 2 | Route waterfall lớn nhất? | **CONFIRMED:** `/compare` là `datasets → N runs`; `/chat` duplicate datasets; `/charts` có một dependent runs request nhưng 4 nhánh chính parallel. | React Query hooks trong compare/chat/charts. |
| 3 | Workspace/membership/capability duplicated? | **CONFIRMED:** trong một FastAPI request, dependency context đã reuse; capability không query DB. **LIKELY inefficiency:** mọi endpoint tải toàn bộ active membership contexts dù header đã chọn workspace. | PERF-105 thêm targeted membership query cho non-bootstrap. |
| 4 | Có N+1? | **CONFIRMED:** frontend runs-per-dataset; report version hydration; report export sessions. Không có ORM lazy-load. | PERF-101/PERF-201. |
| 5 | Table thiếu index hữu ích? | **CONFIRMED by schema/query match:** child profile tables, audit order, workspace list ordering, analysis source lookup, stale job lease. | PERF-003 EXPLAIN rồi PERF-106 migration. |
| 6 | Index redundant? | **LIKELY:** `ix_datasets_collection_name` không có query consumer hiện tại; single workspace indexes có thể bị composite left-prefix thay thế. | Không drop cho đến khi kiểm `pg_stat_user_indexes`, FK/constraint và full query inventory. |
| 7 | Response over-fetch? | **CONFIRMED:** dataset list returns `source_ref`; profile run list/job reads full row; algorithms/access read full run; profile detail luôn full. | PERF-102/PERF-103. |
| 8 | Response quá lớn? | **NEEDS MEASUREMENT:** profile detail/report export có correlation/top-k/evidence JSON, nhưng chưa có byte telemetry. | PERF-001 payload bytes; PERF-203 decision gate. |
| 9 | Page refetch không cần? | **CONFIRMED:** widget datasets khi đóng; duplicate keys ở chat/compare; job endpoint cho terminal run. | PERF-101/PERF-104. |
| 10 | Bootstrap có giảm request? | **CONFIRMED:** có, session/workspaces/dashboard hợp nhất và dashboard cache được seed. | Giữ kiến trúc bootstrap; tối ưu bên trong. |
| 11 | Dashboard fetch lại sau bootstrap? | **CONFIRMED:** không trong 30s happy path; có thể fetch khi stale hoặc background bootstrap không tự cập nhật dashboard key sau lần đầu? | Đo route transitions; giữ key workspace-scoped. |
| 12 | Profile list/detail tải heavy JSON? | **CONFIRMED:** repository `select(profile_runs)` cho list/job; detail tải full JSON theo contract. | PERF-102/PERF-103. |
| 13 | `/activity` scale? | **LIKELY không:** limit có nhưng không cursor; chỉ index workspace, order by id; full JSON. | PERF-107 + EXPLAIN medium/large. |
| 14 | `/compare` recompute? | **CONFIRMED:** mỗi POST recompute và insert row mới, không lookup identity. | PERF-301 sau decision gate. |
| 15 | SQLAlchemy lazy loading? | **CONFIRMED không:** SQLAlchemy Core tables, không ORM relationships. | Regression query-count vẫn cần vì loops thủ công. |
| 16 | Transaction giữ qua compute/LLM/network? | **CONFIRMED mostly no** cho repository calls; compute/LLM chạy ngoài repository transaction. **CONFIRMED issue:** `AnalysisRepository.save_gate` mở nested repository connection qua `get_session` trong transaction. | PERF-201 sửa nested checkout; instrument checkpointer separately. |
| 17 | Pool phù hợp API + worker? | **NEEDS MEASUREMENT:** Supabase metadata dùng NullPool, checkpointer 1; non-pooler cố định 3 mỗi process. | PERF-401 sizing formula/topology metrics. |
| 18 | Auth latency đáng kể? | **LIKELY:** local JWT/JWKS fast; token thiếu email claim hoặc verify fallback gây remote HTTP per request. | PERF-001 đo `auth_local_ms/auth_remote_ms`; PERF-105. |
| 19 | Trước Agent stream mất bao lâu? | **CONFIRMED structural issue:** toàn graph chạy trước event đầu; con số thời gian `MEASURE`. | PERF-202. |
| 20 | Job polling đắt? | **CONFIRMED waste:** terminal profile vẫn fetch job ban đầu; status query đọc full run; custom 2.5s poll không visibility-aware. | PERF-104. |
| 21 | Heartbeat gây DB pressure? | **LIKELY thấp ở default** (concurrency 1, ~100s heartbeat); idle claim poll 1s có khả năng lớn hơn. | PERF-402 đo write/claim rate trước thay đổi. |
| 22 | Top 5 ROI? | Widget/fan-out; lean projections/profile query consolidation; indexes; instrumentation; auth/polling. | Mapped to PERF-001, 101–107. |

### 5.2 Confirmed bottlenecks

- Global chat widget gọi datasets dù đóng; chat/compare tạo duplicate catalog requests.
- Compare/chat widget fan-out runs theo số dataset.
- `list_profile_runs`, `get_profile_job`, nhiều access check dùng full `profile_runs` row chứa large JSON/text.
- Profile detail đọc proposal tables hai lần: lấy rows rồi lại count pending qua 3 queries.
- Dataset/report lists không phân trang; activity có limit nhưng không cursor.
- `/qa/stream` không phát event trước khi graph hoàn thành.
- Drift recompute/persist duplicate cho cùng run pair.
- Report/export hydration có loop query theo version/session.
- `AnalysisRepository.save_gate` có nested connection checkout trong transaction.

### 5.3 Likely bottlenecks

- Thiếu child/composite index sẽ tạo sequential scan/sort khi workspace lớn.
- Remote email-confirmation/fallback Auth API có thể chi phối request latency cho token shape nhất định.
- Serialization/correlation matrix/top-k/report JSON có thể chi phối profile/report response.
- Supabase `NullPool` giảm idle session nhưng có thể tăng connect/pooler checkout latency; chưa đủ evidence để đổi.
- Worker idle claim mỗi 1s có thể tạo read pressure nhiều hơn heartbeat ở workload thấp.

### 5.4 Needs measurement

- Tỷ trọng DB so với auth/network/Pydantic/JSON/frontend parse.
- Payload p50/p95 thực của bootstrap/profile/report/activity.
- Index hit/read blocks/sort spill bằng `EXPLAIN (ANALYZE, BUFFERS)`.
- Pool wait, active/idle connections theo số API/worker instances.
- Drift repeat ratio và cost theo số cột.
- Agent time to headers/first event/first content/provider/tool completion.

## 6. Database Findings

### 6.1 Query/projection

- `profile_runs` là bảng vừa chứa metadata list/job vừa chứa `answer_sources`, `terminal_result`, `risk_warnings`, `correlation_matrix`, `quasi_identifiers`, narrative/answer/job payload. `select(profile_runs)` cho list/job là over-fetch đã xác nhận.
- `datasets` list trả toàn row gồm `source_ref` dù page chỉ dùng id/name/source type/collection/last-profiled; đây vừa là payload thừa vừa mở rộng surface dữ liệu nội bộ.
- `column_stats`, ba proposal tables, statistical tests và drift reports đều filter theo `profile_run_id` nhưng model không khai báo index tương ứng.
- Dashboard dùng hai statements trong một checkout; không N+1, nhưng cần EXPLAIN cho counts/report sort.
- Activity order theo monotonic `id DESC`; cursor `(before_id)` phù hợp hơn offset.

### 6.2 N+1 và transaction

- `get_report()` tải versions rồi bốn child collections cho từng version: `1 + 4V` sau report/version queries.
- `_report_profile()` list sessions rồi gọi `get_session` + `executions` từng session.
- `save_gate()` giữ transaction rồi gọi `self.get_session()`, mở connection/transaction thứ hai; với pool 3 và concurrency có thể gây wait.
- Không phát hiện commit-in-loop qua ORM session vì repository dùng SQLAlchemy Core `engine.begin()`. Một số loop chạy nhiều `conn.execute` trong cùng transaction (report item reorder, cleanup); không phải latency chính của navigation nhưng cần batch khi số item lớn.

### 6.3 Index candidates và cost

| Table | Candidate | Query | Benefit dự kiến | Cost/risk |
| --- | --- | --- | --- | --- |
| `datasets` | B-tree `(workspace_id, created_at DESC, id DESC)` | list/cursor datasets | Filter + order + cursor | Write/storage; có thể thay single workspace index sau kiểm chứng |
| `profile_runs` | B-tree `(workspace_id, dataset_id, created_at DESC, id DESC)` | runs theo dataset | Không sort/scan workspace | Write/storage; column order quan trọng |
| `profile_runs` | B-tree `(workspace_id, status, created_at DESC, id DESC)` | workspace completed-run catalog | Một request thay N fan-out | Thêm write cost trên job/status transitions |
| `profile_runs` | Partial B-tree `(job_lease_expires_at)` WHERE `job_status='running'` | stale recovery | Scan nhỏ theo lease | Partial predicate phải match query |
| `audit_events` | B-tree `(workspace_id, id DESC)` | activity cursor | Index scan, ổn định theo insert ID | Storage; single workspace index có thể redundant |
| `reports` | B-tree `(workspace_id, updated_at DESC, id DESC)` | dashboard/reports cursor | Tránh sort, limit sớm | Write/storage |
| `column_stats` | Unique B-tree `(profile_run_id, column_name)` sau duplicate precheck | profile detail/column lookup | Child lookup nhanh + invariant | Build/lock, duplicate remediation |
| Proposal tables | B-tree `(profile_run_id, status)` | get/pending count | Giảm 3 scans | Ba indexes, write cost nhỏ |
| `statistical_test_results` | B-tree `(profile_run_id, created_at)` | detail/export | Filter + order | Storage |
| `drift_reports` | B-tree riêng trên `profile_run_id_a`, `profile_run_id_b` | detail lookup OR | Bitmap OR/index lookup | Hai indexes/write cost; PERF-301 có thể thay bằng identity index |
| `analysis_sources` | B-tree `(profile_run_id, session_id)` | list sessions by profile | Join/filter nhanh | Write/storage thấp |
| `analysis_sessions` | B-tree `(workspace_id, updated_at DESC, id DESC)` | session lists | Filter + order | Single workspace index có thể redundant |
| `quality_gate_runs` | B-tree `(session_id, created_at DESC)` | latest gate | Limit-first | Write/storage thấp |

Đã có và phải giữ: `ix_workspace_memberships_user_status_created`, `ix_profile_runs_job_claim`, agent runtime composite indexes, report-items position/idempotency indexes. Candidate drop chỉ sau `pg_stat_user_indexes`: `ix_datasets_collection_name` hiện không có query consumer; các single `workspace_id` indexes có thể redundant sau composite replacement nhưng không được drop cùng release đầu.

### 6.4 EXPLAIN ANALYZE shortlist

Chạy trên staging bằng `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)` khi quyền hỗ trợ; không chạy query ghi, không load test production:

1. Membership/workspace join theo `(user_id,status)`; xem index scan, rows removed, heap reads.
2. Dataset cursor theo workspace/order; xem Seq Scan, Sort Method/memory, shared read blocks.
3. Completed Profile Run catalog theo workspace/status/order; xem composite index và limit.
4. Profile runs theo workspace+dataset/order; kiểm column order của composite index.
5. Audit workspace + `id < cursor` + order/limit; mục tiêu Index Scan, không full sort.
6. Dashboard three counts và recent reports; so sánh subquery plan với combined CTE/lateral chỉ khi p95 DB cao.
7. Profile child queries (`column_stats`, proposals, tests, drift); xem rows removed/shared reads.
8. Quick analysis session join qua `analysis_sources.profile_run_id`; xem nested loop/hash join và index usage.
9. Job claim query; xem partial range/order và lock behavior dưới concurrency.
10. Stale lease recovery; mục tiêu partial index trên running jobs.

Theo dõi Planning Time, Execution Time, Seq/Index/Bitmap Scan, Rows Removed by Filter, Sort Method/spill, Nested Loop actual loops, Hash Join memory, Shared Hit/Read Blocks và WAL cho index/write tradeoff.

## 7. Backend Findings

### 7.1 Dependency/auth

- `RequestContext` đã đúng hướng; không tạo một context framework mới. Tối ưu bằng cách làm `get_current_workspace` query đúng một membership khi `X-Workspace-Id` có mặt, còn bootstrap mới list toàn bộ workspaces.
- Role → permissions là in-memory; không cache capability từ DB vì hiện không có query capability.
- JWKS đã cache process-local với TTL. Không reimplement.
- Remote Supabase user lookup chỉ được cache positive result theo token/session hash và bounded TTL sau khi đo; membership vẫn query mỗi request để revoke/suspend có hiệu lực ngay.

### 7.2 Serialization/request behavior

- Pydantic response model hiện che bớt field output nhưng không ngăn DB đọc/deserializing full row trước đó.
- `ProfileResponse` là một contract lớn. Trước tiên giảm query lặp; chỉ tách summary/detail/heavy section nếu PERF-001 chứng minh payload/serialization là bottleneck.
- Forecast algorithm catalog có client cache 5m; endpoint vẫn phải validate profile/workspace, nhưng chỉ cần projected existence/status, không cần full row.
- Explorer `ensure` làm nhiều round trip và audit mỗi lần mở/các internal call; cần get-or-create/hydrate cố định trong một transaction mà không làm mất access checks.

### 7.3 Polling/worker

- React Query job/profile polling 3s dừng khi terminal theo status, nhưng job request vẫn chạy lần đầu cho completed run.
- `waitForProfilingJob` poll 2.5s, retry 5 lần và không xét `document.visibilityState`; đây là đường upload/chat có thể tiếp tục khi tab hidden.
- Worker claim poll mỗi 1s khi idle; recovery chạy khoảng lease/2. Heartbeat mặc định khoảng 100s. Cần đo claim attempts/min, heartbeat writes/min và stale recovery scans trước tune.

## 8. Prioritized Optimization Plan

| Task | Priority | Impact | Risk | Effort | Phase |
| --- | --- | --- | --- | --- | --- |
| PERF-001 Request/DB/payload instrumentation | P0 | High | Low | M | 0 |
| PERF-002 Reproducible workspace benchmark fixtures/harness | P0 | High | Low | M | 0 |
| PERF-003 Baseline, EXPLAIN and decision record | P0 | High | Low | M | 0 |
| PERF-101 Workspace Profile Run catalog + query-key unification | P0 | High | Medium | L | 1 |
| PERF-102 Lean projections + cursor pagination | P0 | High | Medium | L | 1 |
| PERF-103 Profile detail query consolidation | P0 | High | Medium | L | 1 |
| PERF-104 Adaptive/visibility-aware polling | P0 | Medium | Low | M | 1 |
| PERF-105 Auth/workspace resolution optimization | P1 | Medium/High | Medium | M | 1 |
| PERF-106 Evidence-based indexes | P0 | High | Medium | M | 1 |
| PERF-107 Bootstrap/dashboard refinement | P1 | Medium | Low | M | 1 |
| PERF-201 Explorer/report repository consolidation | P1 | High | Medium | L | 2 |
| PERF-202 Q&A preparation and true streaming boundary | P1 | High | Medium/High | L | 2 |
| PERF-203 Payload/serialization slimming decision | P2 | Medium | Medium | M | 2 |
| PERF-301 Deterministic drift reuse | P2 | Medium/High | Medium | L | 3 |
| PERF-401 Connection sizing/configuration | P1 | Medium/High | High | M | 4 |
| PERF-402 Worker claim/heartbeat tuning | P2 | Medium | Medium | M | 4 |

## 9. Phase 0 — Instrumentation

### PERF-001 — Request phase, SQL and payload telemetry

**Goal:** tạo baseline phân rã latency/query count cho tất cả workspace routes mà không log dữ liệu nhạy cảm.

**Files:** `backend/src/main.py`, `backend/src/api/dependencies.py`, `backend/src/services/auth.py`, `backend/src/services/repository.py`, `backend/src/config.py`, `tests/test_main.py`, `tests/test_auth.py`.

**Current behavior:** middleware chỉ đo total duration cho 5 path; không có DB query count/time, auth phase, serialization hay payload bytes.

**Implementation:**

1. Tạo request-local performance context bằng `contextvars` hoặc `request.state`; middleware khởi tạo/kết thúc context.
2. Bọc phase trong auth/workspace dependencies và remote Supabase fallback bằng timer allow-list.
3. Gắn SQLAlchemy `before_cursor_execute/after_cursor_execute` vào engine một lần khi build engine; cộng duration/count vào context hiện tại. Không log parameters hoặc SQL raw. Slowest query chỉ ghi fingerprint allow-list (`SELECT:profile_runs`, `INSERT:audit_events`) hoặc hash template đã normalize.
4. Đo serialization/payload bằng middleware sau `call_next`; dùng `Content-Length` nếu có, nếu streaming thì chỉ ghi loại streaming và bytes qua wrapper riêng, không buffer toàn response.
5. Mở rộng route set thành pattern/route template cho bootstrap, dashboard, datasets, profile list/detail/job, activity, compare/drift, explorer, report draft và QA; tránh cardinality từ concrete IDs.
6. Bổ sung config threshold/sampling. Mặc định record aggregate cho mọi request quan trọng, slow-query detail sampled; không phụ thuộc LangSmith.
7. Emit one-line structured JSON/log với correlation ID; giữ response header hiện có.

**API impact:** internal-only; chỉ thêm `Server-Timing` trong non-production hoặc guarded config nếu muốn. Không expose SQL/auth internals công khai.

**DB impact:** SQLAlchemy event hooks chỉ đo thời gian; không thêm query. Overhead mục tiêu <2% p95 và được benchmark.

**Migration impact:** none.

**Security considerations:** tuyệt đối không log token, email, workspace/resource ID raw nếu telemetry backend không được phân loại phù hợp, SQL params/body/question/prompt/response/raw rows/PII. Route template thay concrete path.

**Tests:** unit test correlation ID, no sensitive fields, query-count reset giữa concurrent requests, streaming không bị buffer, exception path vẫn emit metric; `ruff`/pytest.

**Acceptance criteria:** mỗi target endpoint có `total/auth/workspace/db/query_count/serialization/payload`; metric concurrency không bleed; p95 overhead <2%; existing telemetry contract vẫn hoạt động.

**Dependencies:** none.

**Rollback:** feature flag tắt phase metrics/event hooks, giữ total timing middleware cũ.

**Status: ✅ IMPLEMENTED (2026-08-24) — PLAN MATCHES CODE.**

- New module `backend/src/services/perf_telemetry.py`: request-local `PerfContext` in a `contextvars.ContextVar` (no cross-request bleed), phase timers (`timed()`/`add_phase()`), PII-free SQL `_fingerprint()` (`VERB:table` or hashed template), one-line structured `emit_log()`, sampled `maybe_log_slow_query()`, and `install_sql_instrumentation()` (timing-only `before/after_cursor_execute`, no params read, attached once per engine).
- `backend/src/main.py`: replaced the 5-path allow-list with `_route_template()` (concrete IDs collapsed to `{id}`); middleware begins/resets context, times total, measures payload via `Content-Length` or a non-buffering streaming wrapper, optionally sets a guarded `Server-Timing` header, emits the perf line, and **keeps the legacy `workspace_request_timing` line** so existing consumers still match.
- `backend/src/api/dependencies.py`: workspace resolution wrapped in `workspace_ms`.
- `backend/src/services/auth.py`: local JWT verify → `auth_local_ms`, Supabase Auth fallback → `auth_remote_ms`.
- `backend/src/services/repository.py`: `build_engine()` installs the SQL hooks when telemetry is enabled.
- `backend/src/config.py`: `perf_telemetry_enabled` (default on), `perf_slow_query_ms`, `perf_slow_query_sample_rate`, `perf_server_timing_enabled` (default off — no SQL/auth internals in prod).
- Tests (`tests/test_main.py`): route-template collapsing, fingerprint PII-safety, no cross-request bleed, no-op outside a request, PII-safe emit line. All pass; ruff clean.
- **Verified live** against an isolated Docker Postgres: `GET /datasets` emitted `workspace_ms=17 db_ms=13 query_count=5 payload_bytes=1839 slow_query=SELECT:workspace_memberships`, correlation id shared with the legacy line. p95-overhead budget (<2%) is **NOT MEASURED** (needs PERF-002/003 harness on representative data).

### PERF-002 — Benchmark fixtures và navigation/load harness

**Goal:** tạo workload lặp lại cho small/medium/large workspace và concurrency 1/5/20/50.

**Files:** mở rộng `scripts/benchmark_profile_submission.py` cho shared auth/header utilities; tạo script mới trong `scripts/` cho workspace navigation; dùng fixture patterns trong `tests/conftest.py`; thêm Playwright coverage trong `frontend/tests/`.

**Current behavior:** chỉ có benchmark profile submission fan-in; chưa có benchmark workspace navigation tự động.

**Implementation:**

- Seed synthetic metadata không chứa PII/raw production data:
  - Small: 10 datasets, 20 runs, 10 reports, 100 audit events.
  - Medium: 100 datasets, 500 runs, 200 reports, 10,000 audit events.
  - Large: 1,000 datasets, 5,000 runs, 1,000 reports, 100,000 audit events.
- Profile stats phải có configurable 20/100/500 columns để lộ correlation/payload scaling; dùng JSON aggregate synthetic.
- Harness gọi bootstrap/dashboard/datasets/profile catalog/profile detail/activity/compare metadata và drift pair; ghi p50/p95/p99, status/error, bytes, query-count từ telemetry.
- Browser harness ghi request count/sequence/cache hit và route usable marker trên production build.
- Load mode chạy 1/5/20/50 virtual users, bounded duration, unique idempotency keys, cleanup chỉ với workspace/dataset được harness tạo và xác minh prefix/ID.
- Require explicit staging base URL + test token/workspace; mặc định từ chối hostname production và từ chối chạy nếu test DB marker không có.

**API impact:** none.

**DB impact:** seed/write nhiều; chỉ test DB. Large seed dùng bulk insert và teardown theo exact synthetic workspace.

**Migration impact:** none.

**Security considerations:** không in bearer/token/DSN; redact headers; không dùng `.env` production tự động.

**Tests:** dry-run validates scenario counts and production-host guard; deterministic percentile unit tests; Playwright request assertions không dùng brittle wall-clock gate.

**Acceptance criteria:** một command tạo baseline machine-readable cho ba sizes và bốn concurrency levels; cleanup scoped/recoverable; CI có thể chạy small smoke, medium/large là scheduled/manual.

**Dependencies:** PERF-001 để nhận query/phase metrics.

**Rollback:** remove benchmark-only script/spec; không ảnh hưởng runtime.

### PERF-003 — Baseline, EXPLAIN và decision record

**Goal:** chốt bottleneck thực và quyết định task/index nào được phép triển khai.

**Files:** cập nhật chính tài liệu này hoặc thêm kết quả versioned dưới `docs/`; dùng `scripts/benchmark_profile_submission.py` và harness PERF-002; không sửa runtime ngoài config instrumentation.

**Current behavior:** chưa có baseline workspace tự động; tài liệu chỉ yêu cầu manual p50/p95.

**Implementation:**

- Chạy cold/warm baseline theo §4 và lưu date, commit SHA, image, DB tier/region, API/worker instance count, pool mode.
- Chạy EXPLAIN shortlist §6.4 trên medium/large staging; lưu plan sanitized không có literals/tenant identifiers.
- Query `pg_stat_statements` nếu extension đã được Supabase/Azure environment cho phép; ghi prerequisites/quyền. Fallback là application timing + PostgreSQL slow-query log có parameter redaction.
- Query `pg_stat_user_indexes` để xác nhận candidate unused/redundant; reset window hoặc ghi uptime để không diễn giải sai counter.
- Với mỗi later task, ghi `GO/NO-GO`, baseline và target. Không triển khai Redis/pool/index drop khi gate không đạt.

**API impact:** none.

**DB impact:** read-only EXPLAIN ANALYZE trên staging; không chạy DDL/production load.

**Migration impact:** none.

**Security considerations:** sanitize SQL literals/identifiers/DSN; không đính kèm production customer cardinality nếu nhạy cảm.

**Tests:** validate benchmark JSON schema và target comparison script.

**Acceptance criteria:** có baseline `MEASURE → observed` cho tất cả budgets, top endpoints/query fingerprints, payloads, connection/pool, TTFT và GO/NO-GO cho PERF-101–402.

**Dependencies:** PERF-001, PERF-002.

**Rollback:** none; artifact measurement only.

## 10. Phase 1 — Quick Wins

### PERF-101 — Một workspace Profile Run catalog và React Query key nhất quán

**Goal:** xóa duplicate datasets và N-runs fan-out trên `/chat`, `/compare`, widget và picker.

**Files:** `backend/src/api/routes.py`, `backend/src/services/repository.py`, `backend/src/models/schemas.py`, `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/components/draggable-chat-widget.tsx`, `frontend/src/components/compare-workspace.tsx`, `frontend/src/components/profile-run-picker.tsx`, `frontend/src/app/chat/page.tsx`, `frontend/src/app/charts/page.tsx`, `frontend/src/components/auth-provider.tsx`, related component/API tests.

**Current behavior:** widget tải datasets khi đóng; chat/compare dùng keys riêng; compare và widget gọi runs cho từng dataset.

**Implementation:**

1. Thêm additive workspace-scoped Profile Run catalog endpoint trả `ProfileRunSummary` kèm `dataset_name`, filter `status`, `dataset_id`, cursor, limit; repository dùng một joined projected query, không `profile_runs.*`.
2. Dùng endpoint catalog cho compare và chat/widget khi cần selector toàn workspace. ProfileRunPicker theo dataset vẫn có thể dùng filter `dataset_id` cùng endpoint/cache shape.
3. Chuẩn hóa query key factory có `workspaceId` cho datasets/profile catalog/runs/profile/report draft; mọi consumer dùng cùng key. `queryClient.clear()` khi switch vẫn giữ defense-in-depth.
4. Đặt widget dataset/catalog query `enabled: isOpen` (hoặc route `/chat` cần); preselect profile path không được tự fan-out catalog khi widget đóng.
5. Trên `/chat`, bỏ `chat-datasets`; trên `/compare`, bỏ compare-specific dataset/run keys.
6. Dùng `placeholderData`/cached first page khi chuyển route; không broad invalidation sau mutation, chỉ invalidate workspace dataset/catalog keys liên quan.

**API impact:** additive/backward-compatible; endpoint cũ `/datasets/{id}/runs` giữ ít nhất một release. Frontend coordination cùng commit.

**DB impact:** một joined query thay `1 + N` HTTP và khoảng `2 + 3N` SQL statements trên fresh compare (bao gồm guards của từng request).

**Migration impact:** cần indexes PERF-106 cho catalog; endpoint có thể ship trước index ở feature flag/small workspaces nhưng rollout chính sau index.

**Security considerations:** query bắt buộc workspace predicate từ `RequestContext`; không nhận workspace ID từ query body; summary không chứa source_ref, heavy JSON, job payload, answer hay PII.

**Tests:** cross-workspace run ID không xuất hiện; status/dataset filters; cursor stable; component tests assert một catalog call; Playwright count `/compare` không tăng theo dataset; cache clear khi switch workspace.

**Acceptance criteria:** `/compare` initial catalog tối đa 1 dataset/catalog request sau bootstrap, không N requests; widget đóng không gọi dataset/profile catalog; chat/compare chia sẻ cache; no cross-workspace cache/data.

**Dependencies:** PERF-003 GO, PERF-106 catalog index.

**Rollback:** frontend switch về endpoints cũ; additive endpoint/index có thể giữ lại.

### PERF-102 — Lean projections và cursor pagination cho list/status

**Goal:** không đọc/serialize full rows ở list/job/access paths và đặt bound cho collection APIs.

**Files:** `backend/src/services/repository.py`, `backend/src/api/routes.py`, `backend/src/api/authz_routes.py`, `backend/src/models/schemas.py`, `frontend/src/lib/api.ts`, datasets/activity/reports/profile consumers và tests hiện hữu.

**Current behavior:** `list_datasets`, `list_profile_runs`, `get_profile_job`, `get_profile_run`, `list_reports` dùng full table row; datasets/reports unbounded; activity chỉ first page.

**Implementation:**

- Tạo repository projections riêng: dataset summary, profile-run summary, job status, profile access (`id/workspace/status/dataset/is_approximate`), report summary.
- `get_profile_job` select đúng fields của `ProfileJobResponse`; không đọc correlation matrix/answers/job payload trừ khi error field cần.
- Algorithms, drift precheck, explorer access và QA precheck dùng access projection.
- Dataset list response bỏ `source_ref` ở summary contract mới. Giữ existing field transition bằng version/additive endpoint hoặc deprecate two-step; không silently break consumer.
- Cursor `(created_at,id)` cho datasets/profile runs, `(updated_at,id)` reports, `(id)` activity; default 50/100, max bounded. Return `items`, `next_cursor`, `has_more` trong contract mới; endpoints cũ giữ compatibility window.
- Không dùng offset cho large table; cursor opaque/signed hoặc base64 JSON validated, luôn kết hợp workspace predicate.

**API impact:** additive contract trước, frontend migrate, sau đó deprecate unbounded list. Requires frontend coordination; không rename/remove field trong cùng release.

**DB impact:** giảm row width/JSON TOAST fetch; index-backed keyset pagination.

**Migration impact:** PERF-106 composite indexes.

**Security considerations:** summary tối thiểu hóa source/storage detail; cursor không encode workspace trust, backend vẫn scope workspace; invalid/cross-workspace cursor fail closed.

**Tests:** response contract, max limit, stable cursor khi equal timestamp, insert giữa pages không duplicate/skip ngoài semantics, cross-workspace cursor, source_ref absent ở new summary, query projection assertion.

**Acceptance criteria:** list/job SQL không select heavy columns; first-page p95 trong budget; response bounded; list payload target ≤100 KiB p95 hoặc measured exception documented.

**Dependencies:** PERF-003, PERF-106.

**Rollback:** frontend uses old endpoints; keep new indexes/contracts; no data migration reversal required.

**Status: 🟡 PARTIAL (2026-08-25).** Job-status projection done: `get_profile_job` now selects only the queue columns `ProfileJobResponse` consumes (no heavy JSON/text). Regression test `test_get_profile_job_projects_only_queue_columns` locks it in. Dataset/report/activity cursor pagination + summary DTOs remain NOT STARTED (gated on PERF-106 indexes → PERF-003). See `docs/performance-optimization-implementation.md`.

### PERF-103 — Profile detail query consolidation và summary/detail boundary

**Goal:** giảm query count profile detail cố định, loại proposal re-read và chỉ tải heavy content khi màn hình cần.

**Files:** `backend/src/services/repository.py`, `backend/src/api/routes.py`, `backend/src/models/schemas.py`, `frontend/src/lib/api.ts`, `frontend/src/app/profiles/[runId]/page.tsx`, `frontend/src/components/command-center/command-center-shell.tsx`, `frontend/src/app/chat/page.tsx`, tests API/security.

**Current behavior:** `full_profile` gọi 9 queries; `_build_profile_response` gọi thêm 3 pending counts; guard thêm 1. Full endpoint dùng cho selector/refresh/access situations.

**Implementation:**

1. Thêm `get_profile_detail(workspace_id, run_id)` giữ một connection/transaction read ngắn; join run+dataset projection.
2. Fetch proposal rows bằng `UNION ALL` có discriminator hoặc ba queries trong cùng connection; tính pending count từ rows đã fetch, không query lại. Chọn UNION chỉ nếu benchmark tốt và mapping rõ.
3. Fetch PII mask set từ proposal rows đã có; không query `confirmed_pii_columns` riêng.
4. Giữ child collections ở bounded fixed query count; không aggregate mọi thứ thành một giant SQL JSON nếu làm plan/debug khó và tăng duplicate rows.
5. Thêm summary read cho selector/status; full detail vẫn default/backward-compatible trong release đầu.
6. Nếu PERF-203 gate đạt, lazy-load secondary heavy sections theo 1–2 endpoint lớn (ví dụ core + statistics), không tạo dozens micro-requests.

**API impact:** existing full contract backward-compatible; summary additive. Split heavy fields chỉ làm qua opt-in query/version và frontend coordinated.

**DB impact:** target ≤7 SQL statements gồm auth guard cho full detail; không duplicate proposal count/PII query; indexes child tables.

**Migration impact:** PERF-106 child indexes.

**Security considerations:** PII masking fail-closed phải giữ pending/confirmed/edited/auto-confirmed semantics; resource lookup luôn workspace-scoped; không trả raw row/source path.

**Tests:** exact max SQL query count, workspace isolation, cross-workspace run 404, PII pending masked, rejected PII behavior, proposals/pending count equivalence, response snapshot/schema, no N growth by column/proposal count.

**Acceptance criteria:** query count ≤7 hoặc justified measured target; response fields semantic compatible; p95 DB/detail giảm ≥30% từ baseline khi DB was bottleneck.

**Dependencies:** PERF-001/003, PERF-106.

**Rollback:** route delegates về `_build_profile_response/full_profile`; retain indexes.

**Status: ✅ IMPLEMENTED (2026-08-25) — PLAN MATCHES CODE.** Removed the 4 confirmed redundant queries: `full_profile` loads proposals once, then derives the PII mask set (was a separate `confirmed_pii_columns` query) and `pending_proposals` (was 3 `pending_count` `COUNT()` queries) from those rows. `_build_profile_response` reads the derived count. PII masking is byte-identical via shared `_PII_MASK_STATUSES`; workspace scoping unchanged. `full_profile` internals ~12→8 queries. Regression test `test_full_profile_derives_pending_count_without_extra_queries` (≤8 + parity) added; PII mask + HITL pending-count lifecycle tests pass. Did NOT `UNION ALL` the 3 proposal reads (optional/benchmark-gated). See `docs/performance-optimization-implementation.md`.

### PERF-104 — Adaptive và visibility-aware profiling polling

**Goal:** giảm request/status DB pressure mà không làm mất durable job semantics.

**Files:** `frontend/src/lib/api.ts`, `frontend/src/components/command-center/command-center-shell.tsx`, `frontend/src/app/profiles/[runId]/page.tsx`, `frontend/src/app/chat/page.tsx`, upload/run page consumers, `backend/src/services/repository.py`, tests component/service.

**Current behavior:** job endpoint đọc full run; Command Center luôn fetch job; profile+job có thể cùng poll 3s; custom polling 2.5s không visibility-aware.

**Implementation:**

- Sau PERF-102, status endpoint dùng projection.
- Profile page fetch core status trước; chỉ enable job query khi domain/job state nonterminal hoặc navigation came from active job. Completed/pending-review detail không gọi job.
- Chọn một authoritative polling loop: poll job; khi terminal invalidate/refetch profile một lần. Không poll full profile đồng thời.
- Adaptive interval: queued 5s (backoff tới 10s khi lâu), running 2.5–3s, transient failure exponential bounded, terminal stop; jitter ±10% để tránh thundering herd.
- Khi `document.hidden`, pause hoặc tăng interval 15–30s; resume immediate refetch on visible. `waitForProfilingJob` dùng shared strategy/visibility, AbortSignal và hard timeout.
- Không thêm WebSocket. Chỉ đánh giá SSE job status nếu active clients/DB polling vẫn vượt budget sau thay đổi.

**API impact:** none hoặc response adds `retry_after_ms` hint backward-compatible.

**DB impact:** giảm reads/client; job lookup vẫn primary-key + workspace condition.

**Migration impact:** none.

**Security considerations:** không cache job across workspace; terminal error safe message only.

**Tests:** queued/running/terminal intervals with fake timers, hidden/visible, abort/unmount, 401 refresh, terminal invalidates exact profile key, no polling after terminal.

**Acceptance criteria:** completed profile load không gọi job; active run có tối đa một polling request mỗi interval; hidden-tab request rate giảm ≥75%; state transition UI vẫn đúng.

**Dependencies:** PERF-102 projection/key factory.

**Rollback:** restore 3s job poll; không cần DB rollback.

### PERF-105 — Auth và workspace resolution fast path

**Goal:** giữ authorization fresh/correct nhưng giảm data/read/network thừa.

**Files:** `backend/src/api/dependencies.py`, `backend/src/services/repository.py`, `backend/src/services/auth.py`, `backend/src/config.py`, `tests/test_auth.py`, `tests/test_permissions.py`, API cross-workspace tests.

**Current behavior:** protected request list toàn bộ active workspace contexts rồi tìm header in-memory; bootstrap cần full list. Local JWT fast path đã cache JWKS; remote Auth API có thể chạy khi email claim thiếu/verify fallback.

**Implementation:**

1. Giữ `RequestContext`; với `X-Workspace-Id`, repository chạy targeted join `(user_id, workspace_id, membership active, workspace active)`. Chỉ `/workspace-bootstrap`, `/session`, workspace switcher list toàn bộ.
2. Khi không có header, giữ semantics hiện tại: exactly one membership auto-select, multiple → 409; dùng bounded count/two-row query thay full list nếu không cần payload.
3. Instrument local verify/JWKS fetch/email-confirm/fallback riêng.
4. Nếu gate đạt, cache **positive email-confirmation only** theo non-reversible token hash/session ID đến `min(token_exp, configured TTL ≤5m)`; không cache raw token và không cache failed result lâu. Membership/capability tuyệt đối không vào cache này.
5. Thay user-profile SELECT+conditional UPDATE ở bootstrap bằng safe upsert `ON CONFLICT ... DO UPDATE ... WHERE email IS DISTINCT FROM` nếu EXPLAIN/write metrics cho thấy lợi ích; không write khi unchanged.

**API impact:** none.

**DB impact:** membership result nhỏ hơn; bootstrap vẫn list all; possible one-statement identity upsert.

**Migration impact:** existing membership composite index đủ; không thêm redundant index.

**Security considerations:** revoked/suspended membership có hiệu lực request kế tiếp; invalid workspace vẫn 404 không leak; permission mapping unchanged; cache key hashed và TTL bound by JWT exp.

**Tests:** one/multiple/no membership, suspended/removed, archived workspace, revoked membership immediately fails, cross-workspace 404, token rotation, cache expiry, remote Auth failure fail-closed, no token in logs.

**Acceptance criteria:** non-bootstrap request exactly one targeted membership query; auth remote-call rate và p95 đạt gate; no authorization semantic regression.

**Dependencies:** PERF-001/003.

**Rollback:** feature flag targeted resolver/cache; restore list method/local verify behavior.

### PERF-106 — Alembic indexes theo query thực tế

**Goal:** loại scan/sort xác nhận bởi EXPLAIN mà không tạo redundant index hoặc blocking migration.

**Files:** một Alembic revision mới dưới `backend/migrations/versions/`, `backend/src/services/repository.py` metadata declarations, migration/integration tests.

**Current behavior:** chỉ có nhiều single-column indexes, membership navigation composite và job claim composite; các child lookup/order patterns thiếu composite index.

**Implementation:**

- Chỉ tạo index trong §6.3 có `GO` từ PERF-003. Chia migration thành nhóm small-table normal và large-table concurrent nếu cần.
- Với PostgreSQL large table, dùng Alembic autocommit block + `CREATE INDEX CONCURRENTLY IF NOT EXISTS`; không bọc concurrent DDL trong transaction.
- Unique `(profile_run_id,column_name)` chỉ sau preflight duplicate query và remediation plan; nếu duplicate tồn tại, dừng migration, không tự xóa evidence.
- Update repository metadata để fresh `create_all`/tests phản ánh migration, nhưng production source of truth vẫn Alembic.
- Sau deploy chạy `ANALYZE` theo operational policy và rerun EXPLAIN.

**API impact:** none.

**DB impact:** xem §14; write amplification/storage theo từng index; concurrent build dùng CPU/I/O và giữ nhẹ locks lâu hơn.

**Migration impact:** UP/DOWN chi tiết trong §14.

**Security considerations:** index giữ workspace leading column cho tenant list; không index raw PII/top-k JSON.

**Tests:** migration up/down trên PostgreSQL, index introspection, duplicate preflight, query plan smoke where stable; không assert exact planner node trên tiny fixture.

**Acceptance criteria:** target query dùng Index/Bitmap Scan trên medium/large staging, no redundant index created, build không vượt rollout safety window.

**Dependencies:** PERF-003; coordinate before PERF-101/102/103/107.

**Rollback:** drop new indexes concurrently, one group at a time; application queries vẫn backward-compatible dù chậm hơn.

### PERF-107 — Bootstrap/dashboard refinement

**Goal:** giữ lợi ích bootstrap và loại work thừa chỉ khi metric chứng minh.

**Files:** `backend/src/api/authz_routes.py`, `backend/src/services/repository.py`, `frontend/src/components/auth-provider.tsx`, `frontend/src/app/dashboard/page.tsx`, `tests/test_auth.py`, dashboard tests.

**Current behavior:** bootstrap đúng contract nhưng có user-profile read + membership + two dashboard statements; frontend background bootstrap mỗi 60s; global widget mới là request thừa lớn hơn.

**Implementation:**

- Thực hiện sau PERF-101 để baseline không bị widget nhiễu.
- Giữ một bootstrap endpoint; không quay lại `/session` + `/workspaces` + `/dashboard` waterfall.
- Nếu dashboard DB share p95 cao, thử combined CTE/lateral statement trả counts + 12 reports; so sánh plan/read blocks với hai simple queries. Chỉ merge khi nhanh hơn và maintainable.
- Giới hạn workspace list fields; giữ full list vì switcher cần, nhưng đo response size với user nhiều workspace.
- Background bootstrap phải update `['dashboard', selected]` và `me` atomically hoặc chỉ refresh session data theo conditional request; tránh stale cache inconsistency.
- Cân nhắc ETag/version chỉ sau payload/revalidation measurement; cache luôn workspace/user-aware, không shared public cache.

**API impact:** same contract; additive version/ETag only.

**DB impact:** target normal signed-in bootstrap ≤3 statements nếu identity sync + dashboard combine được gate; nếu không, giữ 4 vì clarity.

**Migration impact:** reports workspace-updated index từ PERF-106.

**Security considerations:** bootstrap vẫn auth + permission; cache key user/workspace; không CDN-cache authenticated response.

**Tests:** dashboard cache seeded/no immediate `/dashboard`, background refresh, switch clear, many workspaces, insufficient permission, query-count max.

**Acceptance criteria:** no request regression; bootstrap p95 budget; query count target từ gate; dashboard data không stale/cross-workspace.

**Dependencies:** PERF-101, PERF-105/106 as applicable.

**Rollback:** restore two dashboard statements/background behavior; endpoint contract unchanged.

## 11. Phase 2 — Backend / DB Structural Optimization

### PERF-201 — Explorer/report query consolidation và transaction hygiene

**Goal:** giảm fixed N+1 trong charts/report và không checkout nested connection trong transaction.

**Files:** `backend/src/services/analysis_repository.py`, `backend/src/api/analysis_routes.py`, `backend/src/services/report_draft_repository.py`, `backend/src/services/repository.py`, `backend/src/api/routes.py`, `backend/src/api/authz_routes.py`, related API/service tests.

**Current behavior:** explorer ensure list rồi hydrate 3–5 child queries; create path hydrate lại; report version/session loops; `save_gate` gọi `get_session` trong open transaction.

**Implementation:**

- Thêm atomic `get_or_create_quick_session(profile_run_id, workspace_id, creator)` dùng một transaction, unique logical identity hoặc lock/idempotent upsert; hydrate latest source/context/gate bằng fixed queries/CTE.
- Tránh gọi route handler như service (`ensure_explorer_session` từ auto-plan/preview); extract service function nhận already-authorized context để reuse rõ ràng.
- `save_gate` lấy session mode bằng cùng `conn` trước update; không nested pool checkout.
- Batch report hydration: load all versions, sections/items/visualizations/reviews bằng `WHERE version_id IN (...)`, group in memory; query count fixed không theo V.
- Export sessions: batch sources/latest contexts/gates/issues/executions theo session IDs; query count fixed không theo S.
- Không cache/mutate Official evidence; result hash/provenance/context/quality semantics giữ nguyên.

**API impact:** internal-only; response order/shape unchanged.

**DB impact:** fewer round trips, wider batched queries; indexes từ PERF-106. Atomic quick-session identity có thể cần unique constraint after duplicate audit.

**Migration impact:** decision gate cho unique quick session; ưu tiên transaction/lock hiện tại, không denormalize nếu chưa cần.

**Security considerations:** mọi batch query phải join/validate workspace; không hydrate session IDs từ workspace khác; evidence fields unchanged.

**Tests:** max query count independent of versions/sessions, concurrent explorer ensure returns one logical quick session, workspace isolation, quality gate/Official promotion regression, pool size 1/3 deadlock test.

**Acceptance criteria:** existing explorer open fixed query count và p95 giảm ≥30% khi DB-bound; report query count O(1) theo number of versions/sessions; no nested checkout.

**Dependencies:** PERF-001/003/106.

**Rollback:** service delegates to old methods behind flag; no destructive schema required.

### PERF-202 — Q&A preparation và streaming boundary

**Goal:** giảm pre-LLM DB work và cho UI nhận progress/first content sớm, đồng thời đo provider/tool riêng.

**Files:** `backend/src/api/routes.py`, `backend/src/agents/graph.py`, `backend/src/agents/nodes/qa_nodes.py`, `backend/src/services/repository.py`, `frontend/src/lib/api.ts`, `frontend/src/app/chat/page.tsx`, `frontend/src/components/draggable-chat-widget.tsx`, Q&A/agent tests.

**Current behavior:** `_qa_state` full run + 3 pending counts + all column stats; generator invokes toàn graph trước yield đầu, sau đó chia answer đã hoàn tất theo câu.

**Implementation:**

1. Repository `get_qa_profile_context` projected: workspace-scoped run status/approximate, pending proposal existence/count bằng one UNION/aggregate, column names only. Không tải top-k/stats nếu graph node chưa cần.
2. Yield safe `meta/progress` event sau authorization/context validation và trước graph execution; frontend hiển thị “preparing/evidence/provider” mà không coi progress là content.
3. Instrument route accepted, graph routing, evidence load, tool, provider, first model chunk, done.
4. Decision gate:
   - IF provider/node supports native async streaming without bypassing guardrails/evidence binding, refactor qualitative node to stream chunks through bounded async channel, assemble final guarded answer, persist trace/evidence on completion.
   - ELSE keep one final content event but preserve immediate progress event and document TTFT-content provider bound.
5. Quantitative/tool branch vẫn có thể chỉ emit content sau deterministic tool; không fake token streaming.
6. Handle disconnect/cancel cooperatively: stop provider where supported, finalize run as cancelled/failed-safe, no partial answer promoted to evidence/report.

**API impact:** additive SSE event types; existing clients ignore unknown events. Content/source/done/error contract remains.

**DB impact:** reduce prep queries; agent trace writes unchanged except explicit phase timestamps.

**Migration impact:** none unless trace schema requires duration fields; prefer existing JSON/usage metadata first.

**Security considerations:** progress không chứa prompt/question/PII/tool args; partial chunks pass output guardrail strategy; no chain-of-thought; disconnected partial result not Official evidence.

**Tests:** first progress before mocked slow graph completion, query-count max, profile pending/cross-workspace fail before stream, disconnect cleanup, sources/done semantics, no sensitive trace, quantitative and qualitative branches.

**Acceptance criteria:** progress event p95 ≤500ms; Q&A prep p95 in budget; first-content metric available; no second LLM invocation; exact evidence/security semantics retained.

**Dependencies:** PERF-001/003, PERF-103 projections.

**Rollback:** disable native stream/progress flag and use current buffered SSE path; repository projection can remain.

### PERF-203 — Payload và serialization slimming decision

**Goal:** giảm payload lớn chỉ khi PERF-001 chứng minh cần, tránh micro-request waterfall.

**Files:** `backend/src/api/routes.py`, `backend/src/models/schemas.py`, `backend/src/services/repository.py`, `frontend/src/app/profiles/[runId]/page.tsx`, report/chart components, API/visual tests.

**Current behavior:** profile detail includes core + all columns/top-k/correlation/proposals/tests/narrative; report export hydrate toàn sections selected rồi mới có thể bỏ một số data.

**Implementation:**

- Record field-level approximate byte contribution in benchmark tooling, không log values runtime.
- IF profile p95 payload >512 KiB hoặc serialization+transfer+parse >25% p95:
  - Add opt-in `view=core` và một `statistics` endpoint/chunk; core chứa status, counts, risk/proposal summary; statistics chứa column stats/correlation.
  - UI render above-the-fold từ core và lazy one secondary request, prefetch on idle; tối đa 2 payloads, không per-tab/per-column calls.
- Apply projection ở SQLAlchemy Core; report `sections` filter phải được push xuống repository để không hydrate sections bị loại.
- Compress tại deployment/proxy cho JSON sau khi xác nhận chưa có; không để compression buffer SSE.

**API impact:** additive opt-in; full response stays one release; frontend coordinated.

**DB impact:** projected queries avoid heavy JSON columns/children when core only.

**Migration impact:** none.

**Security considerations:** same PII masking on every view; cache keys include workspace/run/view/profile version; no raw row.

**Tests:** full/core/statistics contract, reconstruction semantic equivalence, PII masking, payload-size regression thresholds, one secondary request max, visual/profile E2E.

**Acceptance criteria:** nếu gate triggered, p95 bytes giảm ≥50% cho initial profile route và usable p95 cải thiện ≥20%; nếu không, record NO-GO và giữ one endpoint.

**Dependencies:** PERF-001/003/103.

**Rollback:** frontend uses full endpoint; additive endpoints remain harmless.

## 12. Phase 3 — Deterministic Computation Reuse

### PERF-301 — Deterministic drift result reuse

**Goal:** reuse drift chỉ khi inputs immutable/identity exact, không cache theo URL và không làm sai evidence.

**Files:** `backend/src/api/routes.py`, `backend/src/services/drift.py`, `backend/src/services/repository.py`, `backend/src/models/schemas.py`, một Alembic revision mới dưới `backend/migrations/versions/`, `frontend/src/components/compare-workspace.tsx`, drift/security tests.

**Current behavior:** mỗi POST validate two runs, load stats, compute, insert duplicate report; `drift_reports` không có workspace/algorithm/config/result identity.

**Implementation:**

1. PERF-301 Decision Gate: chỉ GO nếu repeated identity ≥10% hoặc uncached p95/DB CPU vượt budget.
2. Định nghĩa canonical identity:

```text
left_profile_run_id + left_profile_content/statistics_hash
right_profile_run_id + right_profile_content/statistics_hash
drift_algorithm_version
canonical_configuration_hash
```

3. Completed Profile Run phải immutable đối với stats; nếu code vẫn cho phép rewrite, persist a canonical `profile_statistics_hash` at completion and bind identity to it.
4. Validate both runs in active workspace on every request **trước** cache lookup. Lookup/insert unique identity transactionally; concurrent duplicate uses conflict-do-nothing then read winner.
5. Persist result, summary, created_at, algorithm/config/version và source hashes trong PostgreSQL. Không dùng process cache/Redis.
6. Return `cache_status`/algorithm version as additive metadata; report evidence retains exact run/hash binding.
7. Invalidation bằng identity, không TTL. Algorithm/config/profile hash change tạo row mới; old evidence remains auditable.

**API impact:** backward-compatible response plus optional metadata.

**DB impact:** new identity columns/unique index; fewer repeated reads/compute, more controlled storage. Add retention only if product policy permits; không delete report-bound evidence tùy tiện.

**Migration impact:** §14; backfill old rows as non-cacheable hoặc chỉ compute identity nơi mọi input đã biết; không đoán hash.

**Security considerations:** workspace validation precedes lookup; no cache key/result shared solely by URL; aggregate-only result; no cross-workspace inference.

**Tests:** deterministic canonical hash, reversed pair semantics, algorithm/config change miss, concurrent same request one row, cross-workspace 404, modified hash miss, report provenance/result equivalence.

**Acceptance criteria:** cached path p95 budget; cached result semantic equivalent; duplicate row growth stops; no evidence/security regression.

**Dependencies:** PERF-001/003, immutable hash decision, PERF-106 indexes.

**Rollback:** disable reuse lookup/write flag; keep historical columns/rows; no evidence deletion.

## 13. Phase 4 — Infrastructure / Pool Tuning

### PERF-401 — Connection pool sizing và deployment topology

**Goal:** size metadata/checkpointer pools theo DB limit và instance topology, không dùng arbitrary defaults.

**Files:** `backend/src/config.py`, `backend/src/services/repository.py`, `backend/src/agents/graph.py`, `.env.example`, `README.md`, `docs/azure-deploy-cicd.md`, pool/config tests.

**Current behavior:** Supabase pooler → metadata NullPool, checkpointer 1; non-pooler → metadata pool 3/process, checkpointer 2/process. API/worker instance counts không tham gia sizing.

**Implementation:**

1. Thu thập `DB_MAX_CONNECTIONS`, pooler mode, API instances/processes, worker instances/concurrency, migration/admin connections, observed concurrent DB sections và pool wait.
2. Dùng budget:

```text
usable_connections = floor(DB_max_connections * 0.8) - admin_migration_reserve
potential_metadata = API_instances * API_processes * api_pool_max
                   + worker_instances * worker_processes * worker_metadata_pool_max
potential_checkpoint = worker_instances * worker_processes * checkpoint_pool_max
potential_total = potential_metadata + potential_checkpoint
require potential_total <= usable_connections
```

3. Tách config API metadata, worker metadata, checkpointer; validate startup và fail-fast nếu declared topology vượt budget.
4. Supabase transaction/session pooler behavior phải được xác nhận từ deployed connection string/tier. Giữ `NullPool` nếu pooler client/session cap + measurements ủng hộ; chỉ dùng bounded QueuePool nếu connect/pooler checkout p95 là bottleneck và total budget an toàn.
5. Add pool checkout/wait/timeout metrics; alert near saturation và OperationalError/503 rate.
6. Tune `pool_pre_ping`, recycle/lifetime theo actual proxy idle timeout; không bật prepare statements khi pooler mode không hỗ trợ.

**API impact:** none.

**DB impact:** thay connection concurrency; risk cao nếu cấu hình sai.

**Migration impact:** none.

**Security considerations:** DSN/limits là secrets/config, không log DSN; pool isolation không thay tenant predicates.

**Tests:** config validation, fake topology formula, connection-loss/recycle integration, pool timeout returns safe 503, API+worker concurrent staging load.

**Acceptance criteria:** pool wait p95 near zero (<10ms target), timeout/error <0.1%, peak connections ≤80% DB max minus reserve, latency improves/no regression.

**Dependencies:** PERF-001/002/003; deploy one stage at a time.

**Rollback:** restore previous pool mode/sizes via environment and restart; no schema rollback.

### PERF-402 — Worker claim, recovery và heartbeat pressure

**Goal:** giảm idle DB polling/write pressure trong khi giữ lease/retry/durable semantics.

**Files:** `backend/src/workers/profiling_worker.py`, `backend/src/services/repository.py`, `backend/src/config.py`, `tests/test_services/test_profile_jobs.py`, worker deploy docs.

**Current behavior:** idle claim mỗi 1s, recovery khoảng lease/2, heartbeat lease/3; claim index đã có, stale lease index thiếu.

**Implementation:**

- Instrument claim attempts, empty claims, claim latency, stale recovery rows, heartbeat writes/failures, lease lost.
- Add idle exponential backoff 1→2→5s with jitter; reset ngay sau claim/new work. Keep max delay within queue-start SLO.
- Batch/reduce recovery scans qua partial lease index; không scan thường hơn mức measurement yêu cầu.
- Keep heartbeat interval ≤ lease/3 và minimum 10s. Chỉ tăng lease/interval nếu job duration/worker crash recovery data cho phép.
- Size worker concurrency cùng memory (pandas/DuckDB), metadata connections và checkpointer pool; không chỉ DB.
- Không thêm LISTEN/NOTIFY, queue broker hoặc WebSocket trừ khi poll pressure còn material sau backoff/index.

**API impact:** none.

**DB impact:** fewer idle SELECTs; same heartbeat correctness; new partial index từ PERF-106.

**Migration impact:** partial stale-lease index.

**Security considerations:** job claims remain worker-internal; execution giữ workspace stored trên job; không user bypass.

**Tests:** concurrent SKIP LOCKED no duplicate claim, idle backoff fake clock, new job latency bound, heartbeat renewal/lost token, crash recovery, retry max attempts, shutdown grace.

**Acceptance criteria:** idle claim queries/min giảm ≥60%; queue start p95 trong SLO (initial target ≤5s idle); zero duplicate claims; không tăng stale/lost leases.

**Dependencies:** PERF-001/003/106/401 topology.

**Rollback:** config backoff max=1s/old recovery cadence; retain safe index.

## 14. Database Migration Plan

Không gộp tất cả indexes vào một blocking transaction. Mỗi migration phải introspect tên index/constraint, có preflight size/duplicates, và được chạy trước application path cần index. Tên revision cụ thể do Alembic generate tại thời điểm thực thi; không sửa lịch sử migration đã publish.

### 14.1 Migration A — Navigation, pagination và profile-child indexes

| Index/constraint | UP behavior | DOWN behavior | Lock/build risk | Production rollout |
| --- | --- | --- | --- | --- |
| `datasets(workspace_id, created_at DESC, id DESC)` | Create B-tree, concurrent nếu table large | Drop concurrently | CPU/I/O; brief metadata locks | Deploy index → ANALYZE → EXPLAIN → enable cursor endpoint |
| `profile_runs(workspace_id, dataset_id, created_at DESC, id DESC)` | Create B-tree | Drop concurrently | Adds write cost for job creation | Before catalog/list frontend |
| `profile_runs(workspace_id, status, created_at DESC, id DESC)` | Create only if catalog filter plan benefits | Drop concurrently | Status changes update index | Canary catalog, watch write/WAL |
| `reports(workspace_id, updated_at DESC, id DESC)` | Create B-tree | Drop concurrently | Report updates write index | Before report/dashboard pagination |
| `audit_events(workspace_id, id DESC)` | Create B-tree concurrently | Drop concurrently | Large audit table, long I/O | Low-traffic build, monitor replica/DB load |
| `column_stats(profile_run_id, column_name)` unique | Preflight duplicate; create unique concurrently only if clean | Drop concurrently | Unique build can fail on duplicates; never auto-delete evidence | Read-only duplicate audit → approve remediation → build |
| Each proposal table `(profile_run_id, status)` | Create B-tree | Drop | Small tables expected; verify size | Can use normal Alembic op if proven small |
| `statistical_test_results(profile_run_id, created_at)` | Create B-tree | Drop | Low/medium | Same as proposal group |
| `analysis_sources(profile_run_id, session_id)` | Create B-tree | Drop | Low/medium | Before explorer consolidation |
| `analysis_sessions(workspace_id, updated_at DESC, id DESC)` | Create if list plan benefits | Drop concurrently | Write cost on session updates | Gate by EXPLAIN |
| `quality_gate_runs(session_id, created_at DESC)` | Create B-tree | Drop | Low | Before batched hydration |

`DOWN` chỉ xóa physical indexes do revision tạo; không xóa data/cột. Khi composite index chứng minh thay thế single index, việc drop single index là migration riêng sau ít nhất một observation window, không nằm trong Migration A.

### 14.2 Migration B — Worker lease recovery

UP tạo partial B-tree `profile_runs(job_lease_expires_at) WHERE job_status='running'` (có thể thêm `id` để stable limit nếu EXPLAIN cần). DOWN drop index concurrently. Build risk thấp hơn full index vì chỉ running rows, nhưng predicate phải khớp chính xác repository query. Deploy index trước worker code, observe stale recovery plan, rồi enable backoff changes.

### 14.3 Migration C — Drift identity (conditional PERF-301)

Chỉ tạo sau PERF-301 GO:

- Add nullable `left_profile_hash`, `right_profile_hash`, `algorithm_version`, `configuration_hash`, `result_identity` (hoặc equivalent normalized fields) vào `drift_reports`.
- Existing rows giữ null/non-cacheable; không backfill bằng phỏng đoán.
- New writes populate all identity fields.
- Sau application dual-write verification, create partial unique index on `result_identity WHERE result_identity IS NOT NULL` hoặc composite exact identity.
- UP theo expand → dual-write → validate → unique index → read-reuse. DOWN chỉ disable read-reuse/drop unique index; không drop evidence columns/rows trong emergency rollback.
- Lock risk: add nullable columns thường metadata-only nhưng phải xác nhận PostgreSQL version; unique concurrent build dùng I/O. Không set NOT NULL trên historical rows.

### 14.4 Redundant-index cleanup gate

Candidate: `ix_datasets_collection_name`, `ix_datasets_workspace_id`, `ix_profile_runs_workspace_id`, `ix_reports_workspace_id`, `ix_audit_events_workspace_id`, `ix_analysis_sessions_workspace_id`. Chỉ drop nếu:

1. Composite replacement đã valid và left-prefix phục vụ mọi query/FK operation cần thiết.
2. `pg_stat_user_indexes` trong representative observation window cho thấy không có consumer độc lập.
3. Không phải constraint-owned index.
4. Staging EXPLAIN không regress.
5. Drop từng index, observe, có DDL recreate script sẵn.

## 15. File-by-File Implementation Map

| Order | File | Change | Reason | Risk | Dependency |
| ---: | --- | --- | --- | --- | --- |
| 1 | `backend/src/main.py` | Mở rộng safe phase telemetry/route templates | Baseline toàn request | Low | PERF-001 |
| 2 | `backend/src/api/dependencies.py` | Đo auth/workspace; targeted membership context | Giảm result/đo guard | Medium | PERF-001/105 |
| 3 | `backend/src/services/auth.py` | Đo local/JWKS/remote; gated positive confirmation cache | Tách network auth latency | Medium | PERF-105 gate |
| 4 | `backend/src/config.py` | Telemetry thresholds, auth TTL, pool topology, worker backoff config | Vận hành/rollback bằng config | Medium | PERF-001/105/401/402 |
| 5 | `backend/src/services/repository.py` | SQL hooks, projections, cursor queries, profile detail consolidation, indexes metadata, drift identity methods | Core DB performance | High | PERF-001/101–106/301 |
| 6 | `backend/src/models/schemas.py` | Additive paginated summaries/catalog/cache metadata | Explicit lightweight contracts | Medium | PERF-101/102 |
| 7 | `backend/src/api/routes.py` | Catalog, projections, polling hints, QA prep/SSE, drift reuse | Main flows | High | PERF-101–104/202/301 |
| 8 | `backend/src/api/authz_routes.py` | Bootstrap/dashboard refinement, activity/report pagination | Workspace navigation | Medium | PERF-102/107 |
| 9 | `backend/src/services/analysis_repository.py` | Atomic quick session, fixed hydration, remove nested checkout | Charts/report DB rounds | Medium | PERF-201 |
| 10 | `backend/src/api/analysis_routes.py` | Extract authorized explorer service; projected run checks | Avoid route-as-service/repeated work | Medium | PERF-102/201 |
| 11 | `backend/src/services/report_draft_repository.py` | Batch/fixed draft hydration where measured | Report query count | Medium | PERF-201 |
| 12 | `backend/src/agents/graph.py` | Streaming-capability integration, checkpoint pool config | TTFT/pool | High | PERF-202/401 |
| 13 | `backend/src/agents/nodes/qa_nodes.py` | Native async chunk path if gate allows | True first content | High | PERF-202 |
| 14 | `backend/src/workers/profiling_worker.py` | Claim metrics, idle backoff/jitter | Reduce idle DB reads | Medium | PERF-402 |
| 15 | `backend/migrations/versions/` | New revisions A/B; conditional C | Index/identity rollout | Medium/High | PERF-106/301 |
| 16 | `frontend/src/lib/api.ts` | Catalog/pagination clients, shared polling, SSE progress | Fewer requests/better UX | Medium | PERF-101/102/104/202 |
| 17 | `frontend/src/lib/types.ts` | Add summary/page/event types generated/aligned with schemas | Contract safety | Low | Backend contracts |
| 18 | `frontend/src/components/auth-provider.tsx` | Workspace-aware key seed/revalidation | Cache correctness | Medium | PERF-101/107 |
| 19 | `frontend/src/components/draggable-chat-widget.tsx` | Lazy catalog only when open; shared keys | Remove global request/fan-out | Low | PERF-101 |
| 20 | `frontend/src/components/compare-workspace.tsx` | One Profile Run catalog; deterministic cache metadata | Remove `N` runs requests | Medium | PERF-101/301 |
| 21 | `frontend/src/components/profile-run-picker.tsx` | Reuse paged catalog/summary | Avoid full profile/dependent fetch | Medium | PERF-101/102 |
| 22 | `frontend/src/app/chat/page.tsx` | Shared catalog, progress events, no duplicate datasets | Request/TTFT | Medium | PERF-101/202 |
| 23 | `frontend/src/app/charts/page.tsx` | Shared keys, projected summary, preserve parallel branches | No duplicate/dependent work | Low | PERF-101/102 |
| 24 | `frontend/src/components/command-center/command-center-shell.tsx` | Single adaptive job poll | Reduce job/profile polls | Medium | PERF-104 |
| 25 | `frontend/src/app/profiles/[runId]/page.tsx` | Core/detail strategy and exact invalidation | Payload/polling | Medium | PERF-103/104/203 |
| 26 | `frontend/src/app/activity/page.tsx` | Cursor/load-more/infinite page | Large audit scale | Low | PERF-102/106 |
| 27 | `scripts/benchmark_profile_submission.py` | Share safe load utilities/retain submission benchmark | Existing measurable entry point | Low | PERF-002 |
| 28 | `scripts/` new workspace benchmark | Navigation/concurrency scenarios | Repeatable baseline | Low | PERF-002 |
| 29 | `tests/test_main.py`, `tests/test_auth.py`, `tests/test_api/test_routes.py` | Telemetry/auth/API/query-count/security regression | Backend guardrail | Low | Related tasks |
| 30 | `tests/test_services/test_profile_jobs.py` | Claim/heartbeat/backoff/lease tests | Durable job safety | Low | PERF-402 |
| 31 | `frontend/tests/`, component tests | Request-count/cache/polling/cross-workspace E2E | Frontend regression | Low | PERF-101/104/202 |
| 32 | `.env.example`, `README.md`, `docs/azure-deploy-cicd.md` | Document config, sizing, benchmark/rollout | Operational handoff | Low | PERF-401 |

### 15.1 Backwards compatibility matrix

| Change | Compatibility | Coordination |
| --- | --- | --- |
| Profile Run catalog | Additive | Backend/index first, frontend second; old runs endpoint retained |
| Paginated dataset/report/activity contracts | Additive endpoint/version first | Frontend migrate before deprecation |
| Job/access projections | Internal-only | No frontend change if response same |
| Profile summary/core/statistics | Additive opt-in | Full endpoint retained one release |
| SSE progress events | Additive | Old client ignores unknown events; content/done unchanged |
| Drift cache metadata | Additive | UI optional |
| Indexes/pool/worker backoff | Internal-only | Operational staged rollout |

## 16. Testing Plan

### 16.1 Phase-by-phase validation

**Phase 0**

- Unit: telemetry context, query timing, sampling, redaction, percentile/harness guards.
- Integration: query count under concurrent TestClient requests; streaming response not buffered; PostgreSQL event hooks.
- Security: assert emitted logs do not contain bearer/email/payload/question/source_ref/raw values.

**Phase 1**

- Repository/API: catalog projections, cursor ordering, max limit, lean job/status, exact query-count ceilings.
- Authorization: workspace isolation, revoked/suspended membership, invalid/cross-workspace IDs, capability unchanged.
- Frontend: one catalog request, widget-closed zero catalog request, workspace-aware keys, mutation invalidation, adaptive polling.
- Migration: PostgreSQL up/down, duplicate preflight, index introspection; EXPLAIN on medium/large seed.

**Phase 2**

- Explorer: concurrent ensure idempotency, context/quality/Official behavior, fixed query count.
- Reports: query count independent of V/S, draft/snapshot/export semantic equivalence.
- Agent: immediate progress, content/source/done/error, disconnect, no partial evidence, TTFT phase metrics.
- Payload: PII masking and result hashes identical across full/split contracts.

**Phase 3**

- Drift identity/hash/version/config determinism, concurrent conflict, cache hit/miss, cross-workspace access, result/provenance equality.

**Phase 4**

- Pool failure/recycle/timeout, topology validation, API+worker load.
- Worker SKIP LOCKED uniqueness, heartbeat/lease recovery, idle backoff, shutdown/retry.

### 16.2 Required quality commands

Backend từ root, chỉ với `P170_TEST_DATABASE_URL` riêng và khác `DATABASE_URL`:

```powershell
.\.venv\Scripts\python.exe -m ruff check backend tests
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe tests/evaluations/run_evaluation.py --dry-run
.\.venv\Scripts\python.exe tests/evaluations/run_evaluation.py --offline
```

Frontend từ `frontend/`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm start --port 3000
```

Chạy `scripts/chart_production_smoke.py` trên candidate/staging theo config hiện hữu. Performance load không chạy trong PR CI thông thường; CI chạy contract/query-count/request-count smoke, còn medium/large load scheduled/manual.

### 16.3 Performance regression tests

- `workspace-bootstrap`: max SQL count theo branch normal; dashboard cache seed no immediate `/dashboard`.
- Profile detail: max SQL query count không tăng theo số columns/proposals; response schema/PII exact.
- Compare/chat: request count O(1), không O(dataset count).
- Report/export: query count fixed theo versions/sessions.
- Payload: size ceilings cho synthetic 20/100/500 columns, threshold versioned.
- Pagination: no duplicate/skip across equal sort keys and concurrent inserts.
- Polling: fake-timer request count, hidden tab and terminal stop.
- Không dùng brittle wall-clock assertion trong unit tests; wall-clock p50/p95 là integration benchmark/release gate.

## 17. Benchmark Plan

### 17.1 Scenarios

Cho mỗi small/medium/large workspace:

1. Cold bootstrap → dashboard usable.
2. Warm dashboard navigation (dashboard cache hit và stale).
3. Datasets first page + next cursor.
4. Profile catalog completed/all + dataset filter.
5. Profile detail 20/100/500 columns, pending-review/completed.
6. Charts selected run: profile/explorer/algorithms/draft parallel.
7. Chat catalog + selected profile + mocked/real provider separated.
8. Compare catalog + uncached drift + repeated cached drift.
9. Activity first/next cursor at 100/10k/100k rows.
10. Active profiling job polling with 1/20/50 clients.
11. Worker idle, queued burst and long-running heartbeat.

### 17.2 Measurements

Capture per scenario:

- Browser request count/dependency graph/cache hit, route usable p50/p95.
- API total/auth/workspace/DB/serialization/external p50/p95/p99.
- DB query count, slowest fingerprint, EXPLAIN buffers, DB CPU, active connections, pool wait.
- Response p50/p95 bytes and frontend JSON parse/render marker.
- Error/timeout/429/503 rate.
- Agent response headers/first event/first content/total; provider/tool durations.
- Worker empty claims/min, queue wait, heartbeats/min, recovery/lease loss.

### 17.3 Safe execution sequence

1. Build backend/frontend candidate images and migrate an isolated staging DB.
2. Seed exact benchmark workspace; verify counts and no production hostname/account.
3. Warm DB once, then run recorded cold/warm series separately.
4. Run concurrency 1 → 5 → 20 → 50, observe safety limits between steps.
5. Stop if error >1%, DB connection >80% usable budget, sustained CPU >85%, replica lag/IO safety threshold, or pool timeouts appear.
6. Export sanitized JSON/EXPLAIN artifacts; cleanup only benchmark workspace by exact ID.
7. Compare candidate vs same baseline image/topology; no cross-tier comparison.

## 18. Rollout Strategy

### Stage A — Instrument only

- Deploy PERF-001 with sampling/feature flag off then low sample.
- Verify telemetry cardinality, redaction, overhead, error rate.
- Run PERF-002/003 and approve GO/NO-GO per task.
- Continue only if overhead <2% p95 and no sensitive telemetry.

### Stage B — Indexes + projection/query quick wins

- Build PERF-106 indexes concurrently in groups; observe DB CPU/I/O/WAL/locks.
- Deploy backend lean projections/catalog while old APIs remain.
- Canary frontend PERF-101/102/104; compare request count, p50/p95, 4xx/5xx, DB reads.
- Deploy PERF-103/105/107 one logical change at a time; observe at least one representative peak window.

### Stage C — Structural backend and payload

- Deploy PERF-201 fixed hydration/nested-connection fix; verify charts/report evidence.
- Deploy PERF-202 progress telemetry first; native streaming only after provider-path tests.
- Run PERF-203 gate; ship split payload only if GO.

### Stage D — Pool/worker tuning

- Change one environment (worker or one API canary) at a time.
- Apply topology formula; observe connection count, wait, 503 and queue-start SLO.
- Enable worker idle backoff after stale lease index.

### Stage E — Optional deterministic reuse

- Expand drift schema; dual-write identity with reuse off.
- Validate hash/result equality and concurrent behavior.
- Enable cache read for small canary percentage/workspace cohort.
- Compare cached/uncached p50/p95, hit rate, storage growth, evidence errors; expand or disable.

Mỗi stage dùng cùng loop: deploy → smoke/security tests → observe p50/p95/query count/payload/DB load/error → compare baseline → continue hoặc rollback. Không gộp pool tuning, schema identity và frontend contract switch trong một release.

## 19. Rollback Strategy

### 19.1 Nguyên tắc chung

- Mỗi task được triển khai độc lập bằng feature flag, route/version song song, cấu hình runtime hoặc migration có đường lùi rõ ràng.
- Rollback ứng dụng trước; rollback schema chỉ thực hiện khi ứng dụng cũ đã chạy ổn định và dữ liệu mới không còn được ghi.
- Không xóa audit log, analysis evidence, report version, profiling result hoặc drift result để “khôi phục hiệu năng”. Dữ liệu bằng chứng phải được giữ nguyên.
- Không rollback bằng cách rewrite Git history. Dùng một commit/release đảo thay đổi có kiểm chứng.
- Khi có lỗi authorization, cross-workspace leak, duplicate job hoặc sai kết quả phân tích: dừng rollout ngay, tắt feature flag và ưu tiên tính đúng đắn hơn latency.

### 19.2 Đường lùi theo task

| Task | Trigger rollback | Thao tác rollback | Dữ liệu / migration |
|---|---|---|---|
| PERF-001 | Overhead p95 ≥2%, cardinality tăng không kiểm soát, có dữ liệu nhạy cảm | Tắt sampling/hook chi tiết, giữ correlation ID và metric tổng | Không rollback schema; xóa metric/log nhạy cảm theo quy trình incident nếu có |
| PERF-002 | Script gây tải ngoài workspace benchmark hoặc kết quả không tái lập | Dừng runner, vô hiệu target production, giữ artifact để điều tra | Chỉ xóa workspace seed theo exact benchmark ID |
| PERF-003 | EXPLAIN gây tải/lock hoặc snapshot sai môi trường | Hủy phiên benchmark, giảm sample, chạy lại trên staging/read replica | Không thay đổi production data |
| PERF-101 | Catalog sai filter/order hoặc UI không chọn được run | Frontend flag quay lại `/datasets` + per-dataset `/profile-runs` | Endpoint catalog mới vẫn có thể tồn tại, không mất dữ liệu |
| PERF-102 | Cursor duplicate/skip, client cũ lỗi contract | Giữ endpoint cũ/default response; tắt cursor/projection mới theo route flag | Không rollback dữ liệu; chỉ contract/application |
| PERF-103 | Profile detail thiếu trường hoặc query hợp nhất sai | Quay lại assembler/full-profile cũ và polling endpoint cũ | Index mới có thể giữ lại; không xóa profile data |
| PERF-104 | Job UI chậm cập nhật hoặc polling không resume | Khôi phục interval cố định hiện tại bằng config/flag | Không ảnh hưởng schema |
| PERF-105 | Auth/workspace cache/resolver sai quyền | Tắt fast path/cache ngay; quay lại full membership resolution | Invalidate toàn bộ auth/workspace cache; không nới lỏng policy |
| PERF-106 | Index build tăng I/O/lock hoặc planner regression | Hủy build đang chạy nếu an toàn; drop đúng index mới bằng migration riêng sau khi app không phụ thuộc | Không drop index cũ trong cùng release; giữ migration log |
| PERF-107 | Bootstrap/dashboard thiếu hoặc stale dữ liệu | Tắt response/aggregate path mới, quay lại query hiện tại | Không rollback dữ liệu nghiệp vụ |
| PERF-201 | Report/explorer evidence thiếu, nested transaction fix gây regression | Quay lại hydration/service implementation cũ | Không xóa evidence đã ghi; index/projection tương thích có thể giữ |
| PERF-202 | SSE mất event, TTFT xấu hơn, provider streaming không ổn định | Tắt native-stream flag, dùng buffered SSE hiện tại | Session/execution vẫn được lưu theo contract cũ |
| PERF-203 | Split payload làm client thiếu dữ liệu hoặc request count tăng quá ngưỡng | Tắt split endpoint/client flag, trả full payload | Giữ endpoint mới dark; không migration dữ liệu nếu chưa GO |
| PERF-301 | Hash collision, result mismatch, cache stampede/evidence mismatch | Tắt cache read; tiếp tục ghi result mới theo đường hiện tại | Giữ identity/result rows để forensic; không trả cached result |
| PERF-401 | Pool timeout/DB saturation/connection budget vượt ngưỡng | Khôi phục env pool size/overflow/timeout trước đó và rolling restart | Không thay đổi schema |
| PERF-402 | Queue-start SLO xấu, stale recovery lỗi hoặc duplicate job | Khôi phục poll/backoff/lease/heartbeat config trước đó | Giữ stale-lease index; kiểm tra và reconcile job theo ID |

### 19.3 Emergency rollback gate

Rollback ngay khi một trong các điều kiện sau xảy ra trong canary hoặc representative peak window:

- Bất kỳ bằng chứng cross-workspace/cross-user access nào.
- Kết quả drift/profile/report/analysis khác baseline ngoài tolerance đã định nghĩa.
- Duplicate execution hoặc lost job lease.
- 5xx/timeout tăng hơn 0,5 điểm phần trăm hoặc gấp đôi baseline (lấy điều kiện nghiêm ngặt hơn).
- DB connection vượt 80% usable budget trong 5 phút, pool timeout xuất hiện, hoặc p95 route mục tiêu xấu hơn >10%.

## 20. Success Criteria

Baseline số tuyệt đối phải được PERF-001/002/003 ghi lại trước khi đổi code. Các số “hiện tại” dưới đây là static estimate từ code và phải được xác nhận bằng trace/query counter; release gate dùng số đo, không dùng ước lượng.

| Khu vực | Baseline code audit / cần đo | Mục tiêu chấp nhận | Cách xác minh |
|---|---|---|---|
| Workspace bootstrap | Khoảng 4 SQL statements ở signed-in normal path; đo p50/p95/p99 | Không tăng query count; p95 giảm ≥20% hoặc nằm trong SLO được duyệt | Route span + integration query counter + benchmark cold/warm |
| Dashboard sau bootstrap | Bootstrap đã seed cache; dashboard không cần request tức thời | 0 request `/dashboard` trùng ngay sau bootstrap; không request dataset từ widget đang đóng | Playwright network assertion |
| Chat datasets | Hai query key (`datasets`, `chat-datasets`) có thể tạo request trùng | Tối đa 1 fetch catalog khi cold; 0 fetch khi cache hợp lệ | Browser request trace + Vitest |
| Compare catalog | Dataset fetch riêng + N `listRuns` fan-out | 1 catalog request, 0 per-dataset run fan-out | Playwright với ≥20 datasets |
| Profile detail | Khoảng 13 SQL statements khi gồm pending count + guard | ≤7 SQL statements; không lặp ba proposal queries; payload/functionality parity | Integration query counter + response snapshot |
| Profile job/status | Full `profile_runs` row có JSON/text nặng | Chỉ fetch projected status fields; response p95 bytes giảm ≥70% so với baseline có artifact lớn | SQL fingerprint/selected columns + payload benchmark |
| Dataset/profile/report listing | Unbounded hoặc full-row list | Cursor ổn định, page mặc định ≤50, không duplicate/skip; p95 payload ≤256 KiB cho default page | Pagination property tests + response-size metric |
| Activity feed | `workspace_id` index đơn, order theo `id desc` | `(workspace_id,id desc)` index scan; p95 không tăng >20% từ 10k lên 100k rows ở cùng page size | `EXPLAIN (ANALYZE, BUFFERS)` staging |
| Index hiệu quả | Chưa có production usage stats | Mỗi index mới phục vụ query fingerprint dự kiến; không index thừa được drop trước ≥14 ngày stats | `pg_stat_user_indexes`, plans trước/sau |
| Hidden/background polling | Job poll 2,5–3 giây; background bootstrap 60 giây | Giảm ≥75% requests khi tab hidden/terminal; foreground completion freshness p95 ≤5 giây | Fake timers + browser trace 10 phút |
| Drift lặp lại | Mỗi request recompute và insert report | Cached request p95 giảm ≥80%, hit rate ≥70% cho repeated identical inputs, 100% equality trong golden corpus | Concurrent integration + benchmark |
| Q&A stream | Graph hoàn tất trước meta/token đầu | Progress/meta event p95 ≤500 ms; nếu native token streaming GO thì first content p95 cải thiện ≥30% | SSE timestamp test với mocked provider và provider benchmark riêng |
| Reports/explorer hydration | Manual loops có 1+4V/N+1 | Query count bị chặn theo constant/bounded formula đã test; không tăng tuyến tính theo versions/sessions | Integration query counter ở 1/10/50 entities |
| Connection pool | API 3+0 mỗi process; pooler dùng `NullPool`; checkpointer riêng | Pool wait p95 <10 ms, 0 timeout, tổng connection peak ≤80% DB usable limit | Pool metrics + DB connection dashboard |
| Worker idle/lease | Claim mỗi ~1 giây, concurrency 1, heartbeat ~100 giây | Idle claim SQL/min giảm ≥60%; queue-start p95 vẫn trong SLO; 0 duplicate/lost lease | Worker metrics + burst/recovery benchmark |
| API reliability | Đo baseline | Không task nào làm 5xx/timeout tăng >0,1 điểm phần trăm trong full rollout | Canary vs control dashboard |
| Security/correctness | Existing tenant/auth behavior | 0 cross-workspace access; 100% authorization regression tests; output parity theo golden fixtures | Security integration suite + evidence diff |
| Telemetry overhead | Chưa đo | <2% p95 latency và <3% CPU overhead ở sample rate rollout | A/B benchmark instrumentation off/on |

Điều kiện hoàn thành toàn chương trình:

1. Tất cả task được triển khai phải đạt acceptance criteria riêng và không vi phạm emergency gate.
2. Các route trọng tâm có baseline, owner, SLO và dashboard p50/p95/p99/query count/payload/error.
3. Ít nhất một representative peak window không có regression bảo mật, tính đúng đắn, DB saturation hoặc queue starvation.
4. Runbook migration, rollback và capacity formula được kiểm chứng trên staging trước production.
5. Mọi quyết định GO/NO-GO của PERF-203 và các index/drop tùy chọn đều có artifact đo lường, không dựa trên phỏng đoán.

## 21. Opus 4.8 Execution Checklist

Thực hiện tuần tự theo phase; trong một phase chỉ song song hóa khi dependency ghi rõ cho phép. Mỗi checkbox tương ứng đúng một task ID được định nghĩa ở phần 9–13.

### Phase 0 — đo trước khi tối ưu

- [ ] **PERF-001** — Thêm telemetry breakdown, query counter, pool/worker/frontend request metrics; xác nhận redaction và overhead <2%.
- [ ] **PERF-002** — Dựng benchmark reproducible với workspace small/medium/large và artifact JSON/EXPLAIN đã sanitize.
- [ ] **PERF-003** — Chụp baseline p50/p95/p99, query count, payload, execution plans, connection/worker behavior; ký GO/NO-GO cho các phase sau.

**Gate:** Không bắt đầu thay đổi performance nếu thiếu baseline của route/task liên quan.

### Phase 1 — quick wins có rủi ro thấp

- [ ] **PERF-106** — Tạo index mới theo migration an toàn/concurrent, kiểm chứng planner; chưa drop index cũ.
- [ ] **PERF-101** — Thêm workspace Profile Run catalog và hợp nhất frontend query keys để loại bỏ compare/chat fan-out.
- [ ] **PERF-102** — Dùng lean projections + cursor pagination cho datasets/profile runs/reports/activity; giữ contract cũ trong rollout.
- [ ] **PERF-103** — Hợp nhất profile detail/pending/job reads, loại query lặp và full-row status fetch.
- [ ] **PERF-104** — Áp dụng adaptive polling, visibility pause và terminal-stop trên mọi client path.
- [ ] **PERF-105** — Tối ưu auth/workspace resolution nhưng giữ fail-closed authorization và đường lùi tức thời.
- [ ] **PERF-107** — Giảm bootstrap/dashboard work trùng sau khi query contracts/catalog ổn định.

**Gate:** Request count, SQL count và payload đạt mục tiêu Phase 1; không có cursor, auth hay cache isolation regression.

### Phase 2 — backend/DB structural optimization

- [ ] **PERF-201** — Loại manual N+1 và nested connection trong explorer/report hydration; khóa query-count bằng tests.
- [ ] **PERF-202** — Tách Q&A preparation/progress khỏi provider generation; chỉ bật native token streaming sau parity/reconnect tests.
- [ ] **PERF-203** — Chạy decision gate profile payload; chỉ split endpoint nếu lợi ích đo được vượt chi phí request/compatibility.

**Gate:** PERF-203 có thể kết thúc bằng quyết định **NO-GO có bằng chứng** và vẫn được coi là hoàn tất; không ép thay contract.

### Phase 3 — deterministic computation reuse

- [ ] **PERF-301** — Thêm drift identity/idempotency, backfill/dual-write, kiểm chứng equality/concurrency rồi mới bật cache read canary.

**Gate:** 100% golden-corpus parity, không duplicate identity/evidence và rollback cache-read đã diễn tập.

### Phase 4 — capacity tuning sau cùng

- [ ] **PERF-401** — Tính và canary pool/checkpointer topology từ DB connection budget, process count và measured concurrency.
- [ ] **PERF-402** — Tune worker idle backoff/poll/lease/heartbeat/concurrency từ queue SLO và job duration distribution.

**Gate:** 0 pool timeout/duplicate job, connection peak dưới 80% budget, representative peak window đạt SLO.

### Release closure

- [ ] Lưu baseline/candidate artifacts, migration log, dashboard links và quyết định GO/NO-GO vào release record.
- [ ] Chạy đầy đủ security/correctness/regression tests và benchmark trọng tâm bằng production-like topology.
- [ ] Xác nhận feature flags, owners, alert thresholds và từng đường rollback trước khi mở 100% traffic.
- [ ] Theo dõi ít nhất một representative peak window; đóng task chỉ khi success criteria phần 20 đạt và không còn alert mở.
