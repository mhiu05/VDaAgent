# Vòng đời dữ liệu tồn kho

**Status: Implemented cho CSV `csv-v1`.** API nhận `org_id`, tên nguồn và nội dung CSV; đây không phải upload file tùy ý. Header phải đúng thứ tự `CSV_COLUMNS`, mỗi dòng qua Zod schema, tối đa 10.000 dòng/import. Domain kiểm hierarchy project/zone/unit và ngày.

```text
CSV request → parse/schema/hierarchy → authorization → file hash/dedup
→ private source-imports bucket → imports manifest + snapshots → run_snapshots
→ semantic calculation → artifact/evidence
```

Repository kiểm quyền ghi và khóa organization. Cùng file hash trong tổ chức trả manifest cũ; unit/date đã có nhưng dữ liệu khác bị từ chối vì snapshot bất biến. CSV nguồn được lưu tại path theo tổ chức/import trong bucket `source-imports`, rồi manifest và rows được ghi trong transaction. Storage và PostgreSQL không tạo một distributed transaction: lỗi DB sau upload có thể để lại object chưa có manifest; hiện không thấy cơ chế dọn object mồ côi tự động.

Khi tạo run, hệ thống chốt tập snapshot mới nhất tại hoặc trước `data_as_of` vào `run_snapshots`; worker chỉ đọc tập này, giới hạn 20.000 rows và timeout truy vấn 5 giây. Các bảng warehouse mock (market/project/zone/unit, giao dịch, giá, reservation) có trong schema, nhưng phân tích MVP dùng snapshot làm nguồn chính.

Code: `src/backend/domain/imports/parse-inventory-csv.ts`, `src/backend/database/repositories/import-repository.ts`, `src/backend/database/transactions/create-run.ts`, `src/backend/database/workflow/lease-repository.ts`. Xem [datasets](../platform/datasets.md), [data model](../architecture/data-model.md).
