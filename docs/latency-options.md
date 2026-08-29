# Ba phương án cải thiện latency và UX cho user flow

## Mục tiêu và phạm vi review

Tài liệu này được lập sau khi đối chiếu `README.md`, `docs/summary.md`,
`ARCHITECTURE.md` và code frontend/backend hiện tại. Mục tiêu là rút ngắn **thời
gian cảm nhận được kết quả đầu tiên**, giảm số lần người dùng phải chuyển màn hình
hoặc bấm lại, nhưng vẫn giữ các ranh giới an toàn của sản phẩm:

- Profile Run, workspace và capability vẫn phải được backend xác thực.
- PII/candidate key chưa được Analyst duyệt không được đi vào Chart, Agent,
  Report hoặc export.
- Preview chỉ là kết quả bounded/approximate; Official evidence vẫn phải có
  context version, quality gate, result hash và provenance.
- Không tắt email confirmation, không bỏ idempotency và không cho browser gửi
  SQL/Python tùy ý chỉ để đổi lấy tốc độ.

## Nhận định về user flow hiện tại

Luồng chính đang là:

```text
login → workspace-bootstrap → upload → POST /profile (202)
      → worker queue → profiling graph → pending_review (nếu có)
      → PATCH /confirm → worker resume → completed
      → explorer/session → auto-plan hoặc auto-profile-pack
      → Preview → Official → Agent insight → pin vào Report Draft
      → snapshot → PDF/JSON
```

Các điểm khiến người dùng phải chờ trung gian:

| Đoạn | Evidence trong code | Tác động UX |
| --- | --- | --- |
| Auth/workspace | `AuthProvider` đợi `getSession()`, sau đó gọi `/workspace-bootstrap`; bootstrap có watchdog 45 giây | Màn hình shell chưa thể hiện dữ liệu thật trong lúc xác thực/provision |
| Upload rồi mới tạo job | `datasets/new/page.tsx` gọi upload trước, lưu collection, sau đó `createProfile()`; nhiều file được submit profiling tuần tự | Người dùng có cảm giác phải hoàn tất một form rồi mới bắt đầu xử lý |
| Theo dõi job | `command-center-shell.tsx` refetch profile/job mỗi 3 giây; `waitForProfilingJob()` poll mỗi 2,5 giây | Có thể trễ tối đa gần một chu kỳ poll và tạo hai nguồn trạng thái |
| HITL | Graph cố ý interrupt ở `hitl_review`; candidate key và PII luôn chờ Analyst | Đây là gate nghiệp vụ hợp lệ, nhưng hiện được thể hiện như một trang trung gian riêng |
| Sau review | `review/page.tsx` gọi `waitForProfileReady()` với interval mặc định 2 giây | Sau khi bấm lưu vẫn phải chờ một vòng resume/narrative riêng |
| Vào Charts | `/charts` có các query profile, explorer session, forecast catalog, report draft; sau đó `ChartsTab` chạy workflow | Nhiều request và trạng thái “đang đọc context” nối tiếp nhau |
| Auto profile pack | `charts-tab.tsx` chạy vòng lặp tuần tự Preview → Official → insight cho từng chart | 5–8 chart tạo thành chuỗi chờ dài; chart đầu tiên không tận dụng được chart sau để chạy song song |
| Profile response | `Repository.full_profile()` gọi `get_profile_run`, proposals, stats, dataset, test results, drift reports tuần tự | Cold load nặng; response full cũng được dùng cho các màn chỉ cần summary |

### Khoảng cách giữa báo cáo latency và snapshot code

Các con số trong `docs/latency.md` nên được coi là **mục tiêu/benchmark cần tái
đo**, chưa phải trạng thái mặc định của code hiện tại. Cụ thể:

- `full_profile()` vẫn là chuỗi lời gọi tuần tự ở
  `backend/src/services/repository.py`; chưa thấy `ThreadPoolExecutor` hay
  `_FULL_PROFILE_CACHE` cho response này.
- Local SQLAlchemy engine đang dùng `pool_size=3`, `max_overflow=0`; Supabase
  pooler dùng `NullPool` trong `build_engine()`. Không nên giả định pool 20.
- Global TanStack Query mặc định là `staleTime: 15_000`; một số query riêng là
  60 giây hoặc 5 phút. Chưa có cấu hình global 2 phút/30 phút như báo cáo.
- UI Command Center poll profile/job mỗi 3 giây; helper chờ profiling poll mỗi
  2,5 giây; worker mặc định poll 1 giây. Đây chưa phải realtime 300/100 ms.
- Local JWT/JWKS cache đã có, nhưng production vẫn bắt buộc
  `AUTH_REQUIRE_EMAIL_CONFIRMED=true`; không dùng việc tắt cờ này làm giải pháp.

Telemetry PII-safe đã tồn tại (`phase timing`, query count, payload và slow-query
fingerprint), nhưng `PERF_SERVER_TIMING_ENABLED` mặc định tắt. Mọi mục tiêu bên
dưới cần được đo bằng p50/p95 theo correlation ID trên bundle production
(`pnpm build` + `pnpm start`), không đo bằng HMR/dev server.

## Phương án 1 — Một “Analysis Command Center” với progressive results và event stream

### Ý tưởng

Giữ một route/one journey từ lúc upload đến khi có kết quả đầu tiên. Server trả về
`run_id` ngay khi dataset đã được lưu, UI chuyển thẳng tới Command Center và nhận
các milestone qua SSE (fallback polling): `queued → ingesting → profiling →
review_required → resuming → ready`. Không đổi các security gate; chỉ đổi cách
hiển thị và cách phân phối kết quả.

Trong lúc profile đang chạy:

1. Hiển thị shell, tên dataset, scan mode và tiến độ từ trạng thái durable thay
   vì spinner toàn trang.
2. Khi summary/column stats an toàn đã có, render “first useful result” ngay.
3. Nếu có proposal cần người duyệt, mở review drawer ngay trên Command Center;
   không bắt người dùng rời sang một trang rồi quay lại.
4. Sau khi quyết định được lưu, giữ nguyên drawer và chuyển trạng thái sang
   `resuming`; khi `completed`, tự enable Charts/Chat/Report.

### Thay đổi kỹ thuật đề xuất

- Thêm endpoint orchestration sau upload, ví dụ `POST /datasets/{id}/profile`
  (idempotent), trả `run_id`, `job_id`, trạng thái và `next_action` trong một
  response. Với batch file, nhận danh sách dataset và tạo các job trong một
  transaction thay vì vòng lặp `createProfile()` ở browser.
- Thêm `GET /profiling-jobs/{job_id}/events` dạng SSE. Sự kiện phải được ghi
  durable (job event table hoặc outbox) để reconnect không mất trạng thái; giữ
  polling làm fallback khi SSE bị proxy chặn.
- Tách contract `ProfileSummary` nhỏ (status, counts, warnings, pending count,
  context version) khỏi `Profile` đầy đủ. Summary có thể render trước; full
  column stats/correlation tải lazy theo tab.
- Gộp profile/job status thành một state machine ở client. Không để một query
  poll profile và một query poll job cùng quyết định cùng một spinner.
- Tự động đi qua các proposal low-risk đã đủ confidence như logic hiện tại;
  candidate key/PII vẫn dừng ở `review_required`.

### UX và mục tiêu đo lường

- Shell sau khi `POST` thành công: p95 < 300 ms (không tính thời gian compute).
- Có summary đầu tiên: p95 < 2 s với sample scan trên dataset chuẩn staging.
- Từ khi worker ghi milestone đến khi UI hiển thị: p95 < 1 s.
- Sau review, không có chuyển route bắt buộc; người dùng luôn thấy trạng thái,
  retry và “tiếp tục khi sẵn sàng”.

### Trade-off và rollout

Đây là phương án có tác động UX lớn nhất nhưng cần thêm SSE, event durability,
reconnect và test quyền truy cập theo workspace. Rollout theo cờ:

1. Phát hành `ProfileSummary` + Command Center state machine, vẫn polling.
2. Thêm SSE cho một nhóm staging, kiểm tra reconnect/401/workspace switch.
3. Bật review drawer và batch orchestration; giữ route cũ làm fallback.

## Phương án 2 — Profile read model theo phiên bản, cache đúng chỗ và tải theo nhu cầu

### Ý tưởng

Không bắt mọi màn hình đọc lại toàn bộ hồ sơ từ PostgreSQL. Khi graph ghi một
milestone, tạo read model immutable theo `profile_run_id + context_version_id`:

```text
profile_summary       → status, counts, warnings, pending proposals
profile_context       → dimensions, measures, time fields, safe metadata
profile_column_stats  → phân trang/lazy theo nhóm cột
profile_evidence      → test, correlation, drift, provenance
```

Mỗi object có version/hash và được invalidated khi review/resume tạo context mới.
Charts chỉ cần `profile_context` để mở Explorer; Profile overview mới tải phần
chi tiết nặng khi người dùng mở tab tương ứng.

### Thay đổi kỹ thuật đề xuất

- Refactor `Repository.full_profile()` để tránh chuỗi query tuần tự: ưu tiên một
  query join/aggregate cho metadata nhỏ, sau đó truy vấn bounded cho phần lớn;
  chỉ dùng concurrency có giới hạn khi đã đo pool/DB. Không tăng pool mù quáng,
  đặc biệt với Supabase `NullPool`.
- Persist sẵn `ProfileSummary` và `ExplorerContext` trong transaction hoàn tất
  milestone. `/charts` nhận context version từ bootstrap/profile response thay
  vì tạo session trong một round trip riêng nếu context đã tồn tại.
- Dùng cache server có key theo workspace/run/context version. Nếu chưa muốn
  thêm Redis, bắt đầu bằng read model PostgreSQL + cache client TanStack Query;
  không dùng cache RAM process-local làm source of truth khi có nhiều instance.
- Thay `cache: "no-store"` cho mọi GET bằng ETag/`If-None-Match` dựa trên version
  nếu endpoint cho phép; mutation/review phải invalidate chính xác.
- Trả `ProfileSummary` cho list/run picker và report navigation; chỉ gọi full
  profile khi người dùng mở detail.

### UX và mục tiêu đo lường

- `/profiles/{runId}` hiển thị status/metrics cơ bản trước phần bảng cột.
- `/charts` có thể render selector và context trong một request/cache hit; không
  hiển thị màn hình trắng chỉ vì correlation hoặc report draft chưa sẵn sàng.
- Kích thước payload profile ban đầu giảm tối thiểu 50% trên fixture lớn; p95
  TTFB summary < 500 ms khi cache hit; p95 full detail < 1,5 s ở staging.

### Trade-off và rollout

Read model làm tăng schema/migration và yêu cầu chiến lược invalidation rõ ràng.
Đổi lại, đây là nền tảng bền vững cho nhiều instance backend và giảm cả DB load
lẫn payload. Rollout an toàn nhất là thêm endpoint summary song song với endpoint
cũ, đối chiếu kết quả bằng hash trong shadow mode, rồi mới chuyển UI.

## Phương án 3 — Chạy DAG phân tích theo batch, song song có giới hạn và bỏ delay giả

### Ý tưởng

Sau khi Profile Run đã `completed`, phần Chart hiện đang là chuỗi nhiều request.
Chuyển thành một DAG bounded:

```text
auto-plan/auto-profile-pack
        ├─ preview chart 1 ─┐
        ├─ preview chart 2  ├─ promote Official (concurrency giới hạn)
        ├─ preview chart N ─┘
        └─ insight stream theo từng Official result
```

Chart nào xong thì xuất hiện ngay; lỗi một chart không chặn các chart còn lại.
Evidence binding, idempotency và quality gate vẫn kiểm tra độc lập cho từng chart.

### Thay đổi kỹ thuật đề xuất

- Thêm batch endpoint nhận tối đa 8 `QuerySpec` đã được backend validate, trả
  từng execution/status. Preview có thể chạy bounded-concurrent; Official chỉ
  chạy sau khi preview tương ứng hợp lệ.
- Cho phép insight stream theo từng Official execution, concurrency nhỏ (ví dụ
  2) để không làm nghẽn LLM provider. Không gửi raw row/PII vào prompt.
- Với nhiều file upload, tạo batch Profile Run và để worker chạy concurrency
  2–4 sau khi đo CPU/RAM/DB; hiện `handleProfile()` submit tuần tự và worker mặc
  định chỉ xử lý 1 job.
- Thay `setTimeout(..., 3000/3500)` trong `charts-tab.tsx` bằng trạng thái dựa
  trên event/result thật. Progress chỉ phản ánh completed/total, không “ngủ” sau
  khi request đã xong.
- Prefetch theo intent (hover/viewport/link từ Profile), lazy-load chart renderer
  nặng và virtualize bảng cột dài. Chỉ prefetch context cần cho hành động kế
  tiếp, tránh tạo thêm tải cạnh tranh với job đang chạy.

### UX và mục tiêu đo lường

- Chart đầu tiên hiển thị ngay khi execution đầu tiên hoàn thành; không chờ cả
  pack.
- Với 6 chart, tổng thời gian batch giảm theo p95 tối thiểu 40% so với baseline
  tuần tự trên cùng provider/fixture.
- Không còn khoảng chờ nhân tạo sau khi progress đạt 100%; lỗi có retry từng
  chart và không làm mất các chart đã thành công.

### Trade-off và rollout

Song song hóa tăng áp lực lên DuckDB/pandas, PostgreSQL và quota LLM. Cần
semaphore, timeout, cancellation, backpressure và giới hạn theo workspace.
Bắt đầu bằng Preview batch (deterministic, dễ đo), sau đó bật Official/insight
theo canary. Không đổi rate limit bảo mật thành một con số cao chỉ để che dấu
polling dư thừa.

## Khuyến nghị ưu tiên

Nếu chỉ có một sprint, chọn **Phương án 1 phiên bản polling trước**: nó giải
quyết cảm giác “phải đi qua nhiều màn hình” ngay, ít đụng schema và có thể giữ
fallback hiện tại. Tiếp theo triển khai **Phương án 2** để giảm cold load và làm
cho nhiều instance ổn định. Sau khi có read model và telemetry tin cậy, triển khai
**Phương án 3** để rút ngắn thời gian tạo nhiều chart.

Thứ tự thực tế:

1. Đo baseline p50/p95 cho upload, bootstrap, queue wait, compute, review resume,
   explorer, preview, official, insight và report export; bật Server-Timing chỉ
   trên staging.
2. Hợp nhất state machine + progressive shell, sau đó thêm SSE/fallback.
3. Thêm summary/context read model, ETag và invalidation theo context version.
4. Thêm batch analysis và bounded concurrency; loại bỏ timer giả.
5. Chỉ nâng các target latency sau khi benchmark production-like và kiểm tra
   regression security/evidence.

## Definition of Done chung

- Mỗi request/job có correlation ID và phase timing; dashboard có p50/p95, không
  chỉ một con số “sau cải thiện”.
- Refresh, mở lại tab, đổi workspace, SSE reconnect và retry idempotent không làm
  resurrect dữ liệu proposal cũ hoặc trộn run khác workspace.
- Các endpoint mới có test authorization, workspace isolation, stale context,
  duplicate request và partial failure.
- Playwright kiểm tra: upload → first useful result, review inline → ready,
  first chart appears, batch chart partial success và offline/reconnect fallback.
- Giữ nguyên các invariant evidence/PII trong `docs/summary.md` và
  `ARCHITECTURE.md`; tốc độ không được biến Preview thành Official hoặc cho phép
  Agent suy diễn ngoài evidence.
