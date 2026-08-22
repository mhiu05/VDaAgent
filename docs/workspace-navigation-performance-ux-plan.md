# Plan

Giảm thời gian chờ khi chuyển chức năng trong workspace mà không nới lỏng kiểm
tra quyền, PII policy hoặc evidence boundary. Kế hoạch ưu tiên loại bỏ waterfall
session/dashboard và round-trip PostgreSQL dư thừa, sau đó làm navigation phản
hồi ngay bằng prefetch/cache/skeleton; số đo baseline hiện tại là khoảng 3,6 giây
để vào dashboard và khoảng 3,2 giây cho lần mở route Datasets đầu tiên ở local
development.

## Scope

- In: đo telemetry không chứa PII; tối ưu AuthProvider, workspace authorization,
  repository query, dashboard read model, cache/prefetch và loading UX; kiểm thử
  guest lẫn authenticated workspace; rollout có quan sát và rollback.
- Out: thay đổi RBAC/capability, giảm kiểm tra quyền phía backend, đổi data model
  report/Profile Run, hoặc mở raw SQL/raw-row access.

## Action items

[ ] Thiết lập baseline và performance budget bằng Playwright cho guest và authenticated user: ghi mốc click, đổi URL, first feedback, first content và duration từng API; chạy cả `pnpm dev` lẫn production build để tách compile/HMR khỏi latency runtime.

[ ] Bổ sung request timing có cấu trúc tại FastAPI cho `/session`, `/dashboard`, `/datasets` và các route workspace chính; phân rã auth, workspace resolution, pool checkout, từng repository query và response serialization, chỉ lưu route/status/duration/correlation id chứ không lưu bearer, PII hay payload.

[ ] Refactor bootstrap workspace để không tạo waterfall `/session` rồi `/dashboard`: thiết kế một bootstrap/read-model trả session, permission và dashboard summary cần thiết, hoặc khởi động các phần độc lập song song sau khi session hợp lệ; giữ cache workspace phía client và chỉ revalidate nền khi an toàn.

[ ] Giảm round-trip PostgreSQL trong authorization: truy vấn membership và workspace bằng một join workspace-scoped; giữ capability check trên mọi request, nhưng không mở nhiều `engine.begin()` tuần tự cho cùng một context; đánh giá lại `pool_pre_ping`, pool size và pooler mode từ số đo thực tế.

[ ] Tối ưu guest request path: biến `ensure_guest_workspace` thành thao tác idempotent không cập nhật membership khi role/trạng thái không đổi, tránh write transaction ở mọi request, và kiểm thử việc chuyển/kết thúc guest session vẫn cô lập hoàn toàn dữ liệu.

[ ] Tối ưu dashboard và các list route: gộp/count bằng read model phù hợp, giới hạn payload report/activity theo nhu cầu màn hình và thêm index/query-plan check cho predicate `workspace_id`, membership status và sort phổ biến.

[ ] Cải thiện perceived performance ở frontend: giữ AppShell ổn định sau bootstrap, hiển thị route-level skeleton ngay khi click, prefetch các route sidebar/chunk dữ liệu khi browser idle hoặc hover, và cấu hình React Query theo workspace-scoped key, `staleTime`, `gcTime` và invalidation khi đổi workspace/mutation.

[ ] Loại bỏ chi phí chỉ có ở development khỏi đánh giá UX production: xác nhận `pnpm build && pnpm start` hoặc container frontend dùng precompiled bundles; ghi rõ HMR/route compile không phải regression production và thiết lập smoke benchmark trên image/deployment candidate.

[ ] Thêm test cho authorization cache, workspace switching, guest cleanup, stale response và retry/timeout; xác nhận cache không thể hiển thị dữ liệu workspace cũ, role revoke vẫn có hiệu lực ở backend, và loading/error state không che UI quá lâu.

[ ] Roll out theo feature flag/percentage, theo dõi p50/p95 navigation/API/error rate và rollback nhanh về bootstrap/query path cũ nếu vượt budget; chỉ hoàn tất khi feedback sau click dưới 150 ms, navigation warm có content hoặc skeleton hữu ích dưới 750 ms p95, và bootstrap dashboard giảm đáng kể so với baseline 3,6 giây.

## Open questions

- PostgreSQL hiện dùng direct connection, transaction pooler hay session pooler, và region của database có gần backend production không?
- Dashboard có được phép hiển thị snapshot cache rồi revalidate nền, hay mọi số đếm phải chờ dữ liệu mới nhất?
- Mục tiêu latency cần áp dụng riêng cho local development, staging và production như thế nào?
