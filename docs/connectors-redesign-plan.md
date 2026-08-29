# Plan

Thiết kế lại `/connectors` thành Integration Center gọn và dễ thao tác: mỗi connector được hiển thị như một card/tile nhỏ, còn cấu hình và thông tin chi tiết mở trong popup (dialog/sheet) theo từng bước. Đồng thời xử lý tận gốc việc MongoDB xuất hiện hai lần bằng cách nhận diện bản ghi trùng ở backend, hợp nhất an toàn các bản ghi hiện có và ngăn duplicate phát sinh từ thao tác lưu lặp.

## Scope
- In: audit dữ liệu/API hiện tại; dedupe datasource MongoDB (và các datasource khác theo cùng nguyên tắc); idempotency và unique constraint; redesign `/connectors` cards, provider picker, detail dialog và connection wizard; giữ hành vi test/save/disconnect và luồng dùng connector ở `/datasets/new`; accessibility, responsive UI và kiểm thử hồi quy.
- Out: thay đổi cách materialize/profiling datasource; thêm provider mới ngoài catalog hiện có; thay đổi OAuth/storage backend ngoài phần hiển thị trạng thái và deep-link cần thiết.

## Action items
[ ] Kiểm tra và chốt dữ liệu trùng: đối chiếu `frontend/src/app/connectors/page.tsx`, `frontend/src/components/datasource-connector.tsx`, `backend/src/api/connector_routes.py` và `backend/src/services/repository.py`; lập báo cáo các row cùng workspace/kind/cấu hình chuẩn hóa, xác định bản ghi giữ lại theo health mới nhất, thời gian cập nhật và số dataset đang tham chiếu.
[ ] Chuẩn hóa fingerprint connector ở backend: canonicalize config theo provider rồi tạo fingerprint có khóa (không lưu/ghi log credential); bổ sung cột/index unique có điều kiện cho connector chưa bị soft-delete, đồng thời backfill fingerprint cho row cũ qua migration an toàn.
[ ] Viết thao tác hợp nhất duplicate trong transaction: chuyển `datasets.datasource_connection_id` sang survivor, bảo toàn audit/health cần thiết, soft-delete row dư và trả về một connector duy nhất; không tự xóa connector đang có dataset nếu không có bước xác nhận rõ ràng.
[ ] Hoàn thiện idempotency cho `POST /connectors/datasource`: lưu/kiểm tra `Idempotency-Key` và request hash, trả lại kết quả cũ khi client retry; xử lý race bằng unique constraint và response lỗi chuẩn (ví dụ `DUPLICATE_CONNECTOR`) để double-click không tạo row mới.
[ ] Tách UI `/connectors` thành catalog/provider registry và danh sách connected: group theo provider nhưng chỉ hiển thị một instance cho mỗi fingerprint, hiển thị số instance/dataset khi còn nhiều cấu hình khác nhau; giữ filter All/Data/Storage/Productivity, summary count và trạng thái loading/error.
[ ] Refactor `ConnectorCard` thành tile compact có icon, tên, category, trạng thái, target đã che credential và một primary action; toàn bộ card phải là button/link có keyboard support, không render URI/password/token, và không làm mất các action test, edit/reconnect, use as dataset, disconnect.
[ ] Thêm `ConnectorDetailDialog`/sheet cho thao tác khi click card: hiển thị safe target, owner scope, dataset count, last tested/success/error và action phù hợp; dùng focus trap, đóng bằng Escape/overlay, restore focus, `aria-live` cho kết quả test/save và full-screen sheet trên mobile.
[ ] Thêm `ConnectionWizard` dùng lại form provider: luồng `Configure → Test → Select collection → Save → Ready`; chọn provider từ popup “Add connector”, mở form MongoDB với URI/database trước, tải collection sau khi test và giữ filter trong state tạm thời, không ghi secret vào localStorage/URL; `DatasourceConnector` tiếp tục là compatibility wrapper cho `/datasets/new` nhưng không tự profiling trong Connector Center.
[ ] Cập nhật React Query/cache và contract types: invalidate sau save/test/disconnect/merge, loại bỏ card cũ ngay sau workspace switch, cập nhật `frontend/src/lib/api.ts` và generated schema nếu response/error contract thay đổi; giữ deep-link `/datasets/new` hoạt động.
[ ] Kiểm thử và nghiệm thu: backend unit/integration cho canonicalization, migration/backfill, workspace isolation, idempotency/race, merge và `connection_in_use`; Vitest cho grouping/card/dialog/wizard/status/error; Playwright mocked-provider cho click card → popup → test/save, duplicate MongoDB chỉ còn một card, retry không tạo row mới, responsive/keyboard/dark-light; chạy `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build` và pytest liên quan.

## Open questions
- Khi có hai MongoDB cùng endpoint nhưng khác credential hoặc khác collection, muốn gộp theo toàn bộ config hay cho phép nhiều instance và chỉ gộp bản ghi hoàn toàn giống nhau? - Trả lời: cho phép nhiều instance và chỉ gộp bản ghi hoàn toàn giống nhau
- Popup mặc định dialog side sheet; không cần thêm route chi tiết `/connectors/:id` để deep-link/share
- Có cần nút “Hợp nhất duplicate” cho admin sau migration, hay migration sẽ tự động hợp nhất mọi duplicate đã xác định chắc chắn? - Trả lời: Tự động hợp nhất mọi duplicate
