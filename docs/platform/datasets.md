# Datasets và snapshot

**Status: Implemented cho dữ liệu tồn kho CSV.** “Dataset” trong UI/context chỉ dữ liệu có thể chọn để phân tích; database lưu `imports` và `snapshots`, không có bảng dataset tổng quát. `csv-v1` yêu cầu header/schema cố định và tối đa 10.000 rows trong một import.

Một import tạo manifest với file hash, source name, row count, schema version và Storage path. Snapshot theo unit/ngày là bất biến; import cùng hash trong tổ chức được trả lại, còn unit/ngày trùng từ file khác bị chặn. CSV nguồn ở private bucket `source-imports`; các snapshot dùng cho run được chốt vào `run_snapshots` lúc tạo run. Semantic chọn bản mới nhất tại hoặc trước `data_as_of` theo scope dự án/phân khu.

Data quality/coverage và các công thức thuộc semantic `mvp-inventory-v0.1` nên được đọc cùng limitation trong artifact. Warehouse mock có thêm bảng giao dịch/giá/reservation nhưng workflow phân tích hiện dùng snapshot. Xem [dataset processing](../workflows/dataset-processing.md) để theo dõi từng bước và lỗi.

Code: `src/backend/packages/contracts/src/imports/inventory.ts`, `src/backend/packages/db/src/repositories/import-repository.ts`, `src/backend/packages/semantic/src/selection/latest-snapshot.ts`, `src/backend/supabase/schemas`.
