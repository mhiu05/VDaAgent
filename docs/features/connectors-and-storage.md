# Connector, upload và storage

> Đã đối chiếu với implementation P0-05 ngày 2026-09-15.

## Nguồn dữ liệu được hỗ trợ trong pilot

| Loại | Cách dùng |
| --- | --- |
| CSV/TSV | Upload trực tiếp vào canonical storage |
| Parquet | Upload trực tiếp vào canonical storage |
| JSON | Upload trực tiếp vào canonical storage |
| Google Drive | OAuth, chọn file, rồi import một lần vào canonical storage |

MySQL, MongoDB và DuckDB **không phải connector khả dụng trong pilot**. DuckDB vẫn là compute engine cho CSV/Parquet/JSON đã vào canonical storage; điều này không cho phép người dùng mở file `.duckdb` do họ chọn trên server.

## Boundary connector database

Backend từ chối create, update, test, reuse và materialize cho mọi database connector với mã lỗi ổn định `database_connectors_disabled`. Guard chạy trước khi resolve hostname, mở file, giải mã credential hoặc tạo socket, kể cả từ `datasource://<connection_id>` trong worker hay service nội bộ.

Các route tương thích cũ vẫn triển khai nhưng ẩn khỏi OpenAPI để client cũ nhận được lỗi có audit thay vì 404. Trường `available` không quảng bá provider database. Không có feature flag được hỗ trợ để bật lại connector này.

## Connection legacy và artifact đã ingest

Metadata connection cũ vẫn được list ở trạng thái `disabled`, với `unavailable: true`, không có host, path, URI hoặc credential. Owner có thể xóa/disconnect để dọn credential; không thể test, sửa, dùng lại hay refresh connection.

Dataset đã được ingest trước đó vẫn dùng canonical artifact bất biến và có thể đọc/profile theo artifact đó. Hệ thống không tự xóa artifact, không giải mã config cũ để render UI, và không materialize lại nguồn database.

Khi rollout, operator phải inventory số connection legacy và số dataset tham chiếu trước/sau migration, rồi theo dõi audit event `database_connector.rejected`. Không ghi decrypted config, URI có secret hoặc đường dẫn server vào log/audit.

## Upload và materialization

Upload đi qua backend vào canonical storage bằng credential server-side. Google Drive là import adapter, không phải canonical storage provider; revoke OAuth không làm hỏng dataset đã import thành công.

Khi profiling, worker materialize canonical artifact hoặc Google Drive import hợp lệ vào file tạm có byte limit, thực hiện compute file-backed bằng DuckDB/pandas/scientific Python, rồi cleanup file tạm. Temporary path không được lưu vào evidence.

## Cấu hình liên quan

- `CANONICAL_STORAGE_PROVIDER` (`supabase` cho production, `local` chỉ development/test)
- `SUPABASE_STORAGE_BUCKET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- `APP_DATA_DIR`, `SECURITY_MAX_UPLOAD_MB`
- `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`

Runtime không giải mã metadata database legacy. Dù rollout CLI xác nhận không còn credential, `Settings.missing_required()` và workflow Azure vẫn yêu cầu `DATASOURCE_ENCRYPTION_KEY` ở production; không revoke/remove key cho deployment hiện tại trước khi có application/release change gỡ yêu cầu này. `DATABASE_CONNECTORS_ENABLED=true` làm process không khởi động; tái mở connector phải có security design riêng với egress, sandbox, TLS, resource limit và test độc lập.
