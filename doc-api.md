# API Profiling hiện tại

Các API file upload nhận input dạng `multipart/form-data` với field `file` là file `.csv`. Các API database nhận input dạng JSON, trong đó `connection` chứa thông tin kết nối SQL Server hoặc PostgreSQL.

## Database auth hỗ trợ

`connection.auth_type` hiện hỗ trợ `username_password`, `azure_ad_token`, `aws_iam`, `gcp_service_account`, `client_certificate`.  
`username_password` dùng cho on-prem, Azure SQL/PostgreSQL, AWS RDS, GCP Cloud SQL khi đăng nhập bằng user/password thông thường.  
`azure_ad_token` dùng access token cho Azure SQL hoặc Azure Database for PostgreSQL; truyền `access_token` hoặc set `AZURE_SQL_ACCESS_TOKEN`/`AZURE_DB_ACCESS_TOKEN`.

`aws_iam` dùng cho PostgreSQL trên AWS RDS/Aurora, cần `username`, `host`, `port`, `aws_region`; nếu dùng mode này cần cài thêm `boto3`.  
`gcp_service_account` dùng cho PostgreSQL trên GCP Cloud SQL IAM, truyền `access_token` hoặc `gcp_service_account_file`; nếu tự sinh token cần cài thêm `google-auth`.  
`client_certificate` hiện hỗ trợ PostgreSQL/on-prem qua `ssl_cert_path`, `ssl_key_path`, optional `ssl_root_cert_path`, `ssl_mode`.

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

## `POST /api/v1/profile/file/sections`

Chạy profiling một lần nhưng chỉ trả các phần user chọn.  
Input: form-data `file=<dataset.csv>`, `sections` là JSON array hoặc chuỗi comma-separated.  
Ví dụ `sections=["schema","columns","correlations","findings"]` hoặc `sections=schema,columns,findings`.

## `POST /api/v1/profile/files`

Profile nhiều file CSV trong cùng request và infer relationship giữa các file.  
Input: form-data key `files`, chọn nhiều file `.csv`.  
Output: `sources[]` là profile từng file, `relationships.inferred_relationships[]` là quan hệ candidate cần HITL xác nhận.

## `POST /api/v1/profile/excel`

Profile workbook Excel nhiều sheet, mỗi sheet được xử lý như một source riêng.  
Input: form-data `file=<workbook.xlsx>`.  
Output: `sources[]` là profile từng sheet, `relationships.inferred_relationships[]` là quan hệ candidate giữa các sheet.

## `POST /api/v1/analysis/statistical-test/file`

Endpoint cũ để chạy một kiểm định thống kê analyst trên một file CSV bằng field `test_type`.  
Input: form-data `file=<dataset.csv>`, `test_type`, optional `alpha`, và các field cột tùy test.  
Output: `test_type`, `columns`, `statistic`, `p_value`, `significant`, `sample_size`, `groups`, `interpretation`.

## `POST /api/v1/analysis/pearson-correlation/file`

Chạy Pearson correlation cho 2 cột numeric.  
Input: form-data `file`, `x_column`, `y_column`, optional `alpha`.  
Output: statistic là hệ số Pearson r, kèm `p_value`, `significant`, `interpretation`.

## `POST /api/v1/analysis/spearman-correlation/file`

Chạy Spearman correlation cho 2 cột numeric hoặc ordinal.  
Input: form-data `file`, `x_column`, `y_column`, optional `alpha`.  
Output: statistic là hệ số Spearman rho, kèm `p_value`, `significant`, `interpretation`.

## `POST /api/v1/analysis/independent-t-test/file`

Chạy Welch independent t-test để so sánh mean của một cột numeric giữa đúng 2 nhóm.  
Input: form-data `file`, `value_column`, `group_column`, optional `alpha`.  
Output: statistic t, `p_value`, group sizes trong `groups`, và diễn giải.

## `POST /api/v1/analysis/chi-square-independence/file`

Chạy chi-square independence test cho 2 cột categorical.  
Input: form-data `file`, `x_column`, `y_column`, optional `alpha`.  
Output: statistic chi-square, `p_value`, `sample_size`, và diễn giải độc lập/phụ thuộc.

## `POST /api/v1/analysis/one-way-anova/file`

Chạy one-way ANOVA để so sánh mean của một cột numeric giữa từ 2 nhóm trở lên.  
Input: form-data `file`, `value_column`, `group_column`, optional `alpha`.  
Output: statistic F, `p_value`, group sizes trong `groups`, và diễn giải.

## `POST /api/v1/analysis/statistical-tests/file`

Chạy nhiều kiểm định trong một lần upload CSV.  
Input: form-data `file`, `tests` là JSON array các test spec.  
Output: `results[]` cho test chạy thành công và `errors[]` cho test lỗi.

Ví dụ field `tests`:

```json
[
  {"test_type":"pearson_correlation","x_column":"unit_price","y_column":"revenue"},
  {"test_type":"independent_t_test","value_column":"final_exam_score","group_column":"gender"}
]
```

Các `test_type` batch hỗ trợ:

- `pearson_correlation`: cần `x_column`, `y_column`; kiểm định tương quan tuyến tính giữa 2 cột numeric.
- `spearman_correlation`: cần `x_column`, `y_column`; kiểm định tương quan đơn điệu, ít phụ thuộc tuyến tính hơn Pearson.
- `independent_t_test`: cần `value_column`, `group_column`; so sánh mean của một cột numeric giữa đúng 2 nhóm.
- `chi_square_independence`: cần `x_column`, `y_column`; kiểm định độc lập giữa 2 cột categorical.
- `one_way_anova`: cần `value_column`, `group_column`; so sánh mean của một cột numeric giữa từ 2 nhóm trở lên.

## `POST /api/v1/profile/database/test`

Kiểm tra backend có kết nối được tới SQL Server hoặc PostgreSQL không.  
Input: JSON `DatabaseConnectionConfig` gồm `type`, `host`, `database`, `auth_type`, `username/password` hoặc token/cert fields tùy auth mode.  
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

## `POST /api/v1/profile/database/sections`

Chạy profiling database table một lần nhưng chỉ trả các phần user chọn.  
Input: JSON gồm `connection`, `schema_name`, `table_name`, `sections`.  
Sections hỗ trợ: `full`, `metadata`, `source`, `summary`, `schema`, `columns`, `correlations`, `relationships`, `findings`, `quality_summary`.
