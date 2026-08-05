# API Profiling hiện tại

Các API file upload nhận input dạng `multipart/form-data` với field `file` là file `.csv`. Các API database nhận input dạng JSON, trong đó `connection` chứa thông tin kết nối SQL Server hoặc PostgreSQL.

## `POST /api/v1/profile/file`

Chạy full profiling cho file CSV bằng DuckDB.  
Input: form-data `file=<dataset.csv>`.  
Output: `profile_metadata`, `source`, `dataset_summary`, `columns`, `relationships.correlations`, `findings`, `quality_summary`.

## `POST /api/v1/profile/file/schema`

Đọc nhanh schema của file CSV và đếm số dòng.  
Input: form-data `file=<dataset.csv>`.  
Output: `source_name`, `source_type`, `row_count`, `column_count`, `columns[{name,data_type}]`.

## `POST /api/v1/profile/file/columns`

Trả metric chi tiết cho từng cột trong CSV.  
Input: form-data `file=<dataset.csv>`.  
Output: null/distinct count + ratio, min/max/avg/stddev, median, p25/p75, sample/top values, PII detection, regex pattern cho non-numeric, outlier IQR cho numeric liên tục.

## `POST /api/v1/profile/file/correlations`

Tính Pearson correlation giữa các cột numeric liên tục trong CSV.  
Input: form-data `file=<dataset.csv>`.  
Output: `correlations[{left_column,right_column,coefficient,strength}]`; bỏ qua cột ID, binary và categorical.

## `POST /api/v1/profile/file/findings`

Trả các nhận xét tự động từ kết quả profiling CSV.  
Input: form-data `file=<dataset.csv>`.  
Output: `findings[{severity,column,message}]`, với severity gồm `info`, `warning`, `critical`; identifier chỉ là candidate và cần HITL xác nhận.

## `POST /api/v1/profile/database/test`

Kiểm tra backend có kết nối được tới SQL Server hoặc PostgreSQL không.  
Input: JSON `DatabaseConnectionConfig` gồm `type`, `host`, `database`, `username`, `password`, `port`, optional `driver`.  
Output: `status`, `database_type`, `database`.

## `POST /api/v1/profile/database/tables`

Lấy danh sách bảng có thể đọc trong database.  
Input: JSON `DatabaseConnectionConfig`.  
Output: `source_type`, `database`, `tables[{schema,table}]`.

## `POST /api/v1/profile/database/schema`

Đọc schema và row count của một bảng bằng query pushdown.  
Input: JSON gồm `connection`, `schema_name`, `table_name`.  
Output: `source_name`, `source_type`, `row_count`, `column_count`, `columns[{name,data_type}]`.

## `POST /api/v1/profile/database/preview`

Preview một số dòng đầu của bảng để kiểm tra dữ liệu.  
Input: JSON gồm `connection`, `schema_name`, `table_name`, `limit` từ 1 đến 100.  
Output: `source_type`, `schema_name`, `table_name`, `rows`.

## `POST /api/v1/profile/database/table`

Chạy full profiling cho một bảng database bằng query pushdown.  
Input: JSON gồm `connection`, `schema_name`, `table_name`.  
Output: cùng cấu trúc full profile như file API: metadata, source, summary, columns, relationships, findings, quality summary.
