# Cấu trúc tài liệu yêu cầu cho Agent

Tài liệu upload vào Agent nên mô tả rõ mục tiêu báo cáo, nguồn dữ liệu, bảng/cột quan trọng, metric mong muốn và rule nghiệp vụ. File có thể là `.txt`, `.md`, `.json`, `.csv`, `.docx` hoặc `.pdf`.

## Trạng thái hỗ trợ hiện tại

Hệ thống hiện đã hỗ trợ upload tài liệu để dùng trong hai việc:

```text
1. Generate profiling plan cho file hoặc database đã preview schema.
2. Agent chọn bảng database từ requirement docs sau khi user đã cấu hình connection.
```

Điểm quan trọng:

```text
Agent không tự nhập credentials và không tự kết nối database nếu user chưa cấu hình connection.
Agent chỉ tự chọn bảng/cấu hình bước tiếp theo sau khi connection đã OK.
```

Với nguồn upload file, flow vẫn giữ như cũ:

```text
Upload file -> Preview schema -> Generate plan -> Run full profile
```

Với nguồn database, flow mới là:

```text
1. User cấu hình database connection.
2. User test connection.
3. User upload requirement docs hoặc nhập custom requirements.
4. Bấm Agent select from docs.
5. Backend list tables nếu chưa có danh sách bảng.
6. Agent chọn bảng phù hợp từ tên bảng + tài liệu yêu cầu.
7. Hệ thống tự preview schema/rows của bảng được chọn.
8. User review schema.
9. Generate plan dùng schema thật + docs để tạo metric/checks.
10. User confirm và chạy profile.
```

## API liên quan

Upload tài liệu:

```text
POST /api/v1/knowledge/documents
GET  /api/v1/knowledge/documents
GET  /api/v1/knowledge/search
```

Agent chọn bảng database từ docs:

```text
POST /api/v1/profiling/database-plan
```

Payload chính:

```json
{
  "user_id": "anonymous",
  "tables": [
    { "schema": "public", "table": "orders" },
    { "schema": "public", "table": "customers" }
  ],
  "custom_requirements": "báo cáo customer và pii",
  "document_ids": ["doc_xxx"],
  "max_tables": 3
}
```

Response chính:

```json
{
  "recommended_tables": [
    {
      "schema_name": "public",
      "table_name": "customers",
      "score": 1.0,
      "reason": "Matched requirement terms: customer.",
      "matched_terms": ["customer"]
    }
  ],
  "questions": [
    "Confirm these tables before profiling, especially if the requirement mentions business concepts not visible in table names."
  ],
  "evidence": [
    "Selected tables from requirement document and available database object names."
  ]
}
```

## Cấu trúc tài liệu khuyến nghị

Một tài liệu tốt nên có các phần sau.

## 1. Mục tiêu báo cáo

Mô tả báo cáo cần trả lời điều gì.

Ví dụ:

```text
Mục tiêu: đánh giá chất lượng dữ liệu bán hàng, phát hiện PII, kiểm tra missing values và phân tích doanh thu theo region.
```

## 2. Nguồn dữ liệu

Ghi rõ nguồn dữ liệu là file hay database.

Ví dụ với file:

```text
Nguồn: ecommerce_sales_analytics_5000.csv
```

Ví dụ với database:

```text
Nguồn: PostgreSQL
Schema: public
Bảng ưu tiên: orders, customers, payments
```

Nếu muốn Agent tự chọn bảng tốt hơn, nên ghi đúng hoặc gần đúng tên bảng.

## 3. Cột quan trọng

Liệt kê các cột nghiệp vụ quan trọng.

Ví dụ:

```text
customer_id: mã khách hàng
order_id: mã đơn hàng
order_date: ngày tạo đơn
revenue: doanh thu
region: khu vực
email: thông tin PII, cần mask
phone_number: thông tin PII, cần mask
```

## 4. Metric mong muốn

Liệt kê các metric hoặc kiểm tra muốn có trong report.

Ví dụ:

```text
Tính null ratio cho tất cả cột.
Kiểm tra duplicate ở order_id.
Kiểm tra cardinality của product_category và region.
Phát hiện PII ở email, phone_number, customer_name.
Tính phân bố doanh thu theo region.
Tìm outlier ở revenue.
Gợi ý correlation giữa revenue, discount và quantity.
```

## 5. Rule nghiệp vụ

Ghi rõ các ngưỡng hoặc điều kiện nghiệp vụ.

Ví dụ:

```text
order_id không được duplicate.
revenue phải lớn hơn hoặc bằng 0.
email và phone_number không được hiển thị raw trong báo cáo.
Null ratio trên 10% là warning.
Null ratio trên 30% là critical.
```

## 6. Chính sách hỏi lại

Nếu có phần chưa chắc, ghi rõ để Agent hỏi lại trước khi chạy.

Ví dụ:

```text
Nếu không chắc cột nào là PII thì hỏi analyst xác nhận.
Nếu có nhiều cột doanh thu, hỏi người dùng chọn revenue hay total_amount.
Nếu có nhiều bảng customer, hỏi bảng nào là source chính.
```

## Template ngắn

Có thể dùng template này cho `.md`, `.txt`, `.docx` hoặc `.pdf`:

```text
# Report requirements

## Goal
...

## Data source
Type: file/database
File/table/query:
Preferred tables:
...

## Important columns
- column_name: meaning, rule if any

## Required metrics
- ...

## Business rules
- ...

## Clarification policy
- Ask before assuming ...
```

## Giới hạn hiện tại

Agent hiện có thể:

```text
Đọc requirement docs đã upload.
Chọn bảng database theo tên bảng và từ khóa trong docs.
Tự preview schema/rows của bảng đã chọn.
Tạo profiling plan từ schema thật + docs.
```

Agent hiện chưa làm được đầy đủ:

```text
Tự tạo database connection credentials.
Tự biết bảng đúng nếu tên bảng không liên quan gì đến requirement.
Tự join nhiều bảng theo business logic phức tạp.
Tự chạy query SQL phức tạp từ docs.
Tự tạo metric hoàn toàn mới nếu backend chưa hỗ trợ.
```

Nếu docs không nhắc tên bảng/cột hoặc tên bảng trong DB quá khác business term, Agent sẽ hỏi lại hoặc yêu cầu user chọn thủ công.

## Bằng chứng test

Test endpoint `POST /api/v1/profiling/database-plan` với requirement:

```text
báo cáo customer và pii
```

và tables:

```text
public.orders
public.customers
```

Kết quả:

```text
HTTP 200
recommended table: public.customers
reason: Matched requirement terms: customer.
```
