# Plan

Ưu tiên cần cải thiện nhất tiếp theo là **P0-05/B-03: vô hiệu hóa toàn bộ database connector không an toàn trong pilot**. DuckDB hiện có thể vượt ranh giới filesystem của server, còn MySQL/MongoDB có thể probe mạng nội bộ hoặc đích Internet chưa được duyệt; việc giới hạn thao tác cho Owner chỉ giảm số người khai thác chứ không đóng trust boundary. Hướng triển khai là fail closed ở backend, loại các connector này khỏi contract/UI pilot, đồng thời giữ đường xem và xóa an toàn cho connection legacy.

## Scope

- In: chặn create/update/test/reuse/materialize đối với `mysql`, `mongodb` và `duckdb`; khóa cả route chuẩn lẫn route legacy và đường `datasource://`; loại provider khỏi UI/OpenAPI pilot; xử lý connection đã lưu; bổ sung audit, test bảo mật và rollout fail-closed.
- Out: thiết kế sandbox DuckDB, arbitrary SQL, hostname/egress allowlist, private endpoint, TLS policy để tái mở connector; thay đổi canonical upload hoặc Google Drive; lifecycle xóa dataset của P0-06; verification PostgreSQL còn lại của P0-04.

## Action items

[ ] Định nghĩa một policy duy nhất trong `src/backend/src/config.py` và `src/backend/src/services/datasource.py`: database connector mặc định bị tắt; cấu hình production/pilot phải từ chối khởi động nếu cố bật `mysql`, `mongodb` hoặc `duckdb`, thay vì cho phép một environment flag vô tình mở lại boundary chưa harden.

[ ] Thêm guard fail-closed dùng chung trước mọi `normalize_config`, `probe` và `materialize_connection`; trả domain error ổn định như `database_connectors_disabled` và bảo đảm `datasource://<connection_id>` không thể kích hoạt network/filesystem materialization từ job, script hoặc service nội bộ ngoài HTTP route.

[ ] Đóng cả hai họ endpoint tại `src/backend/src/api/routes.py` và `src/backend/src/api/connector_routes.py`: chặn test/create/update/reuse/test-saved cho database datasource trước khi resolve host, mở file, giải mã credential hoặc tạo socket; loại provider database khỏi trường `available`. Chỉ giữ list metadata đã redacted và delete/disconnect cho connection legacy để Owner có thể dọn credential.

[ ] Xử lý dữ liệu legacy bằng migration hoặc command idempotent: inventory connection và dataset đang tham chiếu, chuyển mọi database connection sang trạng thái `disconnected`/`disabled`, không log config đã giải mã, không tự xóa canonical artifact đã ingest, và ghi rõ dataset cũ còn đọc được nhưng không được refresh/materialize lại từ nguồn.

[ ] Thu hẹp contract tại `src/backend/src/models/schemas.py`, OpenAPI và type frontend: database kinds không còn là lựa chọn tạo mới trong pilot; nếu cần giữ type nội bộ để đọc row legacy thì tách khỏi request schema công khai và đánh dấu response legacy là unavailable thay vì quảng bá connector đang dùng được.

[ ] Gỡ UI tạo hoặc dùng lại MongoDB/MySQL/DuckDB tại `src/frontend/src/app/connectors/`, `src/frontend/src/app/datasets/new/` và các API helper liên quan; giữ upload/Google Drive làm nguồn ingest hỗ trợ, hiển thị connection legacy ở trạng thái đã tắt cùng hành động xóa cho Owner, và không chỉ dựa vào việc ẩn control để bảo vệ backend.

[ ] Bổ sung test bảo mật table-driven cho Owner và Analyst trên mọi route chuẩn/legacy: đều không thể create/test/update/reuse database connector; mock `socket`, `MongoClient`, SQLAlchemy MySQL engine và `duckdb.connect` để assert không có network/file access; test direct `datasource://`, saved connection legacy, cross-workspace ID, list `available`, cleanup và error contract.

[ ] Cập nhật test frontend/Playwright để xác nhận không còn provider picker hoặc datasource mode database, connection legacy chỉ có trạng thái disabled và cleanup phù hợp; cập nhật tài liệu architecture, connector/storage, configuration, deployment và audit để tuyên bố rõ các nguồn được hỗ trợ trong pilot.

[ ] Dọn dependency chỉ phục vụ connector đã tắt (`pymysql`, `pymongo`) khỏi production dependency/lock nếu không còn caller; giữ `duckdb` nếu compute CSV/Parquet/JSON vẫn cần nó, nhưng thêm regression search/test để không còn code path mở DuckDB database do user chọn.

[ ] Triển khai backend guard trước frontend, chạy inventory connection legacy trước và sau deploy, theo dõi audit/metric cho request bị từ chối, rồi xác minh bằng `uvx ruff check`, `python -m compileall`, backend API/service tests, OpenAPI drift check, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` và connector-focused Playwright. Không rollback sang trạng thái tự động tái bật connector; việc tái mở phải là một security design riêng có egress/sandbox/TLS/resource tests.

## Open questions

- Không có cho phạm vi pilot hiện tại; giả định nguồn được hỗ trợ là upload canonical và Google Drive, còn mọi database connector đều bị tắt cho đến khi có nhu cầu đã duyệt và một thiết kế hardening riêng.
