# Connector và storage

## Tích hợp được hỗ trợ

Datasource connector hiện hỗ trợ đúng `mysql`, `mongodb` và `duckdb`. Google Drive là storage integration riêng, không phải datasource kind; Google Calendar chưa được runtime/migration hiện tại hỗ trợ.

Connector API nằm dưới `/api/v1/connectors`: list/get safe metadata, tạo datasource, test connection mới hoặc đã lưu, patch bằng optimistic versioning và soft-delete. Credential/OAuth token được mã hóa ở server, không xuất hiện trong `ConnectorOut` và không gửi tới browser. Connector status là `connected`, `attention_required`, `expired` hoặc `disconnected`.

## An toàn của datasource

MySQL yêu cầu host/port/user/password/database cùng table hoặc `SELECT`/`WITH` chỉ đọc. MongoDB yêu cầu URI `mongodb://` hoặc `mongodb+srv://`, database, collection và JSON filter. DuckDB nhận file path cùng table hoặc read-only query. Mutating SQL word bị reject. Materialization tối đa 1.000.000 row và tạo representation tạm thời rồi xóa sau khi dùng. Fingerprint hỗ trợ deduplication.

## File và object storage

Upload nhận `.csv`, `.tsv`, `.parquet` và `.json`; filename được normalize và loại path traversal. Read dùng chunk. Supabase Storage và Google Drive có retry/resumable behavior riêng; local storage chỉ dành cho development và guest flow, còn non-guest local upload bị reject trong production. Guest object chịu size limit và retention đã cấu hình.

Google Drive dùng scope `drive.file` và lưu refresh state đã mã hóa. Reference `gdrive://workspace/file/filename` được kiểm tra workspace. OAuth configuration bắt buộc được validate trước khi provider production được dùng.

## Vị trí source code và kiểm chứng

- Connector API: [`backend/src/api/connector_routes.py`](../../backend/src/api/connector_routes.py).
- Datasource adapter: [`backend/src/services/datasource.py`](../../backend/src/services/datasource.py).
- Storage: [`backend/src/services/storage.py`](../../backend/src/services/storage.py), [`google_drive.py`](../../backend/src/services/google_drive.py), [`security.py`](../../backend/src/services/security.py).
- Test: tìm trong `tests/` với `connector`, `datasource`, `storage`, `upload`, `gdrive` và `encryption`.

Xem [configuration](../operations/configuration.md) về provider setting và [privacy](../security/workspace-isolation-and-privacy.md) về raw data.
