# Connector, upload và storage

VDaAgent tách connector metadata, thông tin xác thực và dữ liệu nguồn. Trình duyệt không nhận database credential hoặc storage secret; backend là bên duy nhất kết nối nguồn và đọc object.

## Nguồn dữ liệu được hỗ trợ

| Loại | Cách dùng hiện tại |
| --- | --- |
| MySQL | kiểm tra kết nối, chọn bảng rồi ingest một lần vào artifact nội bộ |
| MongoDB | kiểm tra kết nối, chọn collection rồi ingest một lần vào artifact nội bộ |
| DuckDB | đọc nguồn connector rồi ingest một lần vào artifact nội bộ |
| CSV/TSV | upload trực tiếp vào canonical storage |
| Parquet | upload trực tiếp vào canonical storage |
| JSON | upload trực tiếp vào canonical storage |
| Google Drive | kết nối OAuth, chọn file và import vào canonical storage |

Google Drive là connector/import adapter tùy chọn, không phải canonical storage provider. Sau khi import thành công, revoke OAuth không làm hỏng dataset đã nhập. Google Calendar không thuộc phạm vi hiện tại.

## Connector API

Các route dưới `/api/v1/connectors` hỗ trợ list, get, create datasource connector, patch, test và soft-delete. Các route `/api/v1/datasets/datasource*` giữ luồng tương thích từ màn hình dataset.

Credential được mã hóa trước khi lưu. Response chỉ trả metadata đã làm sạch, không echo mật khẩu, URI chứa secret hoặc token. Update dùng version để tránh ghi đè im lặng; delete là soft-delete để giữ audit/provenance. Với MongoDB, có thể tạo connection trước rồi chọn collection ở bước sử dụng.

## Upload và materialization

Upload production ưu tiên session hai bước: backend tạo object key theo workspace và signed upload authorization ngắn hạn, browser gửi file thẳng tới Supabase Storage, rồi backend verify size/object và finalize. `POST /api/v1/datasets/upload` vẫn là API tương thích và cũng tạo cùng canonical artifact. Backend không trả service-role credential cho browser.

Drive và database connector được materialize trong ingestion, upload vào canonical storage rồi mới chuyển dataset sang `ready`. Khi profiling bắt đầu:

1. source reference được resolve ở backend;
2. dữ liệu remote/local được stream vào file tạm với giới hạn byte;
3. CSV/TSV được chuẩn hóa UTF-8 khi cần;
4. DuckDB đọc trực tiếp file tạm và chỉ project các cột cần thiết;
5. file tạm luôn được dọn sau khi hoàn tất hoặc lỗi;
6. Profile Run giữ `artifact_id` bất biến; retry, statistical test và Official analysis resolve đúng artifact này;
7. query/provenance không lưu đường dẫn tạm.

Thiết kế này tránh tải toàn bộ dataset vào RAM. Pandas chỉ được nạp lại cho các cột được yêu cầu khi chạy statistical test riêng.

## Quyền sở hữu storage

- `supabase`: canonical internal dataset object storage trong production; bucket private, backend dùng server credential.
- `local`: canonical adapter chỉ cho development/test.
- `google_drive`: external import connector qua `/api/v1/google-drive/*`; metadata nguồn nằm trong provenance của artifact.

Tên object phải nằm dưới prefix theo workspace/dataset. Download qua backend phải kiểm tra membership và quyền sở hữu dataset trước khi trả dữ liệu. Không public bucket chứa dữ liệu người dùng.

## Cấu hình quan trọng

- `CANONICAL_STORAGE_PROVIDER` (`supabase` production, `local` development/test)
- `SUPABASE_STORAGE_BUCKET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- `APP_DATA_DIR`, `SECURITY_MAX_UPLOAD_MB`
- `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`
- khóa mã hóa connector credential

`STORAGE_PROVIDER` còn được đọc như bridge cấu hình cũ, nhưng deployment mới phải dùng `CANONICAL_STORAGE_PROVIDER`.

## Legacy Drive và vận hành

Dataset `gdrive://` cũ vẫn được nhận. Lần profile đầu tiên hoặc command migration sẽ copy file sang canonical storage, verify, tạo artifact và bind Profile Run; retry sau đó không đọc Drive nữa. Alembic chỉ tạo schema, không chạy network copy.

```powershell
python scripts/migrate_storage_to_supabase.py --dry-run --batch-size 100
python scripts/migrate_storage_to_supabase.py --execute --resume-after <dataset-id>
python scripts/reconcile_storage.py --workspace-id <workspace-id> --scan-objects
```

Migration command idempotent và có filter workspace/dataset, batch/resume, JSON-lines progress. Reconciliation chỉ báo object thiếu, ingestion stale và object chưa có record; nó không tự xóa dữ liệu.

Xem [Cấu hình](../operations/configuration.md) cho thứ tự ưu tiên và cấu hình theo môi trường.

## Nguồn triển khai

- `backend/src/api/connector_routes.py`
- `backend/src/api/google_drive_routes.py`
- `backend/src/api/routes.py`
- `backend/src/services/storage.py`
- `backend/src/services/ingestion.py`
- `backend/src/services/datasource.py`
- `backend/src/services/tabular_source.py`
- `scripts/migrate_storage_to_supabase.py`
- `scripts/reconcile_storage.py`
