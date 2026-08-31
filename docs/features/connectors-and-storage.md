# Connector, upload và storage

VDaAgent tách connector metadata, thông tin xác thực và dữ liệu nguồn. Trình duyệt không nhận database credential hoặc storage secret; backend là bên duy nhất kết nối nguồn và đọc object.

## Nguồn dữ liệu được hỗ trợ

| Loại | Cách dùng hiện tại |
| --- | --- |
| MySQL | kiểm tra kết nối, lưu connector, chọn bảng và profiling |
| MongoDB | kiểm tra kết nối, lưu connector, chọn collection và profiling |
| DuckDB | kết nối nguồn tương thích với contract datasource |
| CSV/TSV | upload hoặc chọn từ storage |
| Parquet | upload hoặc chọn từ storage |
| JSON | upload hoặc chọn từ storage |

Google Drive là storage provider/OAuth integration, không phải datasource engine. Google Calendar không thuộc phạm vi hiện tại.

## Connector API

Các route dưới `/api/v1/connectors` hỗ trợ list, get, create datasource connector, patch, test và soft-delete. Các route `/api/v1/datasets/datasource*` giữ luồng tương thích từ màn hình dataset.

Credential được mã hóa trước khi lưu. Response chỉ trả metadata đã làm sạch, không echo mật khẩu, URI chứa secret hoặc token. Update dùng version để tránh ghi đè im lặng; delete là soft-delete để giữ audit/provenance. Với MongoDB, có thể tạo connection trước rồi chọn collection ở bước sử dụng.

## Upload và materialization

`POST /api/v1/datasets/upload` nhận file hợp lệ, kiểm tra loại/kích thước và ghi qua storage adapter. Khi profiling bắt đầu:

1. source reference được resolve ở backend;
2. dữ liệu remote/local được stream vào file tạm với giới hạn byte;
3. CSV/TSV được chuẩn hóa UTF-8 khi cần;
4. DuckDB đọc trực tiếp file tạm và chỉ project các cột cần thiết;
5. file tạm luôn được dọn sau khi hoàn tất hoặc lỗi;
6. query/provenance được lưu bằng source reference ổn định, không lưu đường dẫn tạm.

Thiết kế này tránh tải toàn bộ dataset vào RAM. Pandas chỉ được nạp lại cho các cột được yêu cầu khi chạy statistical test riêng.

## Storage provider

- `local`: chỉ dùng cho phát triển; object nằm trong thư mục local đã cấu hình.
- `supabase`: dùng bucket private; backend truy cập bằng server credential.
- `google_drive`: dùng OAuth của workspace; route kết nối ở `/api/v1/google-drive/*`.

Tên object phải nằm dưới prefix theo workspace/dataset. Download qua backend phải kiểm tra membership và quyền sở hữu dataset trước khi trả dữ liệu. Không public bucket chứa dữ liệu người dùng.

## Cấu hình quan trọng

- `STORAGE_PROVIDER`
- `LOCAL_STORAGE_DIR`
- `STORAGE_BUCKET`
- `MAX_UPLOAD_BYTES`
- `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`
- khóa mã hóa connector credential

Xem [Cấu hình](../operations/configuration.md) cho thứ tự ưu tiên và cấu hình theo môi trường.

## Nguồn triển khai

- `backend/src/api/connector_routes.py`
- `backend/src/api/google_drive_routes.py`
- `backend/src/api/routes.py`
- `backend/src/services/storage.py`
- `backend/src/services/datasource.py`
- `backend/src/services/storage.py`
- `backend/src/services/tabular_source.py`
