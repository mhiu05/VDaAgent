# TODO tiếp theo

- Xác định lại bộ metrics profiling chuẩn theo từng nhóm kiểu dữ liệu: numeric liên tục, categorical, binary, datetime, ID/key candidate, text, complex type như geography/xml/binary.
- Tách rule profiling ra khỏi code executor để không phải sửa code mỗi lần gặp bảng mới hoặc kiểu dữ liệu mới.
- Bổ sung HITL cho các suy luận như primary key, identifier candidate, duplicate identifier, PII candidate và invalid range.
- Thêm PostgreSQL connector test end-to-end: test connection, list tables, schema, preview, profile table bằng query pushdown.
- Bổ sung các kiểm định chất lượng dữ liệu: uniqueness, completeness, valid range, accepted values, duplicate rows, type consistency, date freshness, referential integrity cơ bản.
- Viết test fixtures cho CSV và database mock để bắt lỗi rule trước khi chạy trên database thật.
- Thêm cấu hình rule/threshold theo dataset hoặc theo column để tránh hardcode như null threshold, outlier threshold, PII rule.
