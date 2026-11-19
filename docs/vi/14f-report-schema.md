# 14f · Schema báo cáo và biểu đồ dùng chung

**Phụ thuộc:** [14](14-frontend.md), [14e](14e-report-viewer.md), [19](19-reports-dashboard-notifications.md)

**Trạng thái:** Đã có (mock)

> Ở mục tiêu, agent publish payload schema v1 qua `contoso.publish_report` (xem [19](19-reports-dashboard-notifications.md)) và `api` kiểm tra bằng cùng quy tắc trước khi lưu. Decoder FE vẫn là lớp phòng vệ cuối cùng.

Model nguồn là [`report-schema.ts`](../../frontend/src/features/reports/model/report-schema.ts), [`types.ts`](../../frontend/src/features/reports/model/types.ts) và [`chart-contract.ts`](../../frontend/src/shared/charts/chart-contract.ts). Schema là domain contract của frontend cho một bản báo cáo đã lưu, không phải wire schema của backend hoặc JSON narrative của chat.

## Hai dạng nội dung đã lưu

`ReportVersion` luôn có identity, sequence, source, thời gian hoàn tất, policy/content revision, `sections` legacy, evidence ID và artifact ID. Nó có thể có thêm `schema: ReportSchema` hoặc `schemaIssue`.

Legacy dùng `ReportBlock`: text/methodology/limitations, finding/recommendation, metric-table/comparison và chart một series. Schema v1 hỗ trợ block mở rộng, nhiều series và metadata loại báo cáo; viewer tiếp tục đọc được legacy.

| Trường schema v1 | Ý nghĩa |
| --- | --- |
| `schemaVersion` | Literal `1`. |
| `reportId`, `versionId` | Phải khớp bản đang đọc. |
| `reportTypeId` | ID nghiệp vụ mở rộng được; không chọn component riêng theo loại. |
| `title` | Tên tài liệu. |
| `language`, `description`, `domain`, `skill`, `scope`, `summary` | Metadata tùy chọn; skill có ID/name/revision, scope chứa ngày và timezone. |
| `limitations` | Giới hạn dữ liệu/phân tích. |
| `dashboard` | Block của tổng quan báo cáo; có thể rỗng. |
| `sections` | Block tài liệu theo thứ tự đã lưu; có thể rỗng. |
| `diagnostics` | Diagnostic do decoder tạo ra khi gặp block chưa hỗ trợ. |

## Block contract

Mỗi `SchemaBlock` có `id`, `title`, `evidenceIds`; có thể có `description` và `span: 'full' | 'half'`.

| Kind | Payload |
| --- | --- |
| `metric-grid` | `metrics`: ID, label, `value: number | null`, unit, definition/comparison tùy chọn. |
| `chart` | `chart: ChartSpec`. |
| `data-table`, `comparison` | Columns, rows và unit; ô là string, số hữu hạn hoặc null. |
| `text` | `markdown`. |
| `finding`, `recommendation` | `text`. |
| `evidence` | `references` trỏ tới evidence đã biết. |
| `section` | `blocks` lồng nhau. |
| `unsupported` | Kết quả fallback có originalKind và message. |

`ReportBlocks` render cùng contract ở tổng quan báo cáo và reader; tổng quan compact chỉ chiếu cách bố trí như mô tả trong [14e](14e-report-viewer.md). Nó không thay thứ tự `sections` đã lưu.

## Decoder và fallback

[`decodeReportVersion`](../../frontend/src/features/reports/adapters/decode-version.ts) nhận payload domain đã ánh xạ. Nó kiểm tra identity report/version, sequence nguyên dương, timestamp, số/null, hình dạng block legacy, evidence reference và chronology của source. Legacy block lạ bị từ chối bằng `RepositoryError('validation')`.

[`decodeReportSchema`](../../frontend/src/features/reports/adapters/decode-schema.ts) kiểm tra schema v1 và identity mong đợi, evidence thuộc bản lưu, metric ID không trùng trong grid, block ID không trùng trong từng collection, bảng đủ cột, span hợp lệ và độ sâu section. Decoder từ chối khi tham số độ sâu lớn hơn tám; không tự điền số liệu thiếu. Metadata scope được kiểm tra theo khoảng ngày `[from, to)` và timezone IANA.

Block schema có kind chưa biết được chuyển thành `unsupported`, thêm diagnostic và bỏ các field không thuộc contract. Không chạy script/CSS tùy ý từ payload. Chart type chưa biết vẫn giữ spec để renderer có thể trình bày bảng.

Gọi trực tiếp `decodeReportSchema` với schema version khác 1 sẽ lỗi. Khi qua `decodeReportVersion`, schema version chưa hỗ trợ được ghi thành `schemaIssue`; legacy sections hợp lệ vẫn còn để viewer đọc. Nếu không có nội dung legacy, UI không tự tạo tài liệu thay thế.

Kiểm tra cấu trúc schema và kiểm tra chart tương thích là hai bước khác nhau: một ChartSpec có thể qua decoder nhưng không đủ điều kiện vẽ. Khi đó renderer dùng fallback giữ dữ liệu.

## ChartSpec và registry

`ChartSpec` có ID/title, dimension (`categorical`, `temporal`, `numeric`), labels, một hoặc nhiều series, unit của từng series, sourceId và evidenceIds tùy chọn. `semantic` có thể là comparison, trend, composition, relationship, matrix hoặc distribution. `type` có thể bỏ trống để registry đề xuất; type khai báo rõ nhưng không hỗ trợ sẽ fallback.

[`chart-registry.ts`](../../frontend/src/shared/charts/chart-registry.ts) quyết định khả năng vẽ và lựa chọn chuyển loại:

| Nhóm | Quy tắc chính |
| --- | --- |
| `bar`, `column`, `line`, `area` | Một series với dimension không phải numeric, ngoài trường hợp matrix/distribution riêng. |
| `grouped-bar`, `line`, `area` | Nhiều series cùng unit, ngoài các semantic riêng. |
| `stacked-bar` | Nhiều series, semantic composition và tổng cộng dồn hữu hạn. |
| `pie`, `donut` | Composition một series, tối đa 12 nhãn, không null/âm, tổng hữu hạn lớn hơn 0. |
| `scatter` | Dimension numeric, trừ semantic matrix/distribution. |
| `heatmap` | Semantic matrix. |
| `histogram` | Distribution một series numeric, có `binEnds` khớp nhãn, bin tăng và không chồng nhau, tần số không âm hoặc null. |

Mọi nhóm phải qua kiểm tra chung: labels/series có dữ liệu, độ dài values khớp labels, số hữu hạn/null, series ID và labels không trùng, dimension hợp lệ. Series khác unit không dùng chung plot. Toàn null không tạo chart. `labels.length * series.length > 2000` chuyển sang bảng thay vì dựng SVG quá lớn; đây là guard hiện tại, không phải cam kết hiệu năng đo được.

`recommendChart` ưu tiên histogram, heatmap, scatter, line cho temporal, donut cho composition, grouped-bar cho nhiều series, bar cho phần còn lại; chỉ chọn nếu tương thích. Dữ liệu temporal được sao chép và sắp theo thời gian cùng các giá trị series. Null vẫn giữ khoảng trống, không tự nối hoặc đổi thành 0.

Renderer dùng SVG tại chỗ, ba family cartesian/radial/matrix và CSS token hiện có. Không có dependency chart engine khác trong package hiện tại. Bảng dữ liệu tương đương, local scroll, pagination và chart expansion giúp đọc dữ liệu khi không thể vẽ hoặc khi plot quá chật.

## Ví dụ schema tối thiểu

Đây là payload schema để truyền vào decoder với expected identity tương ứng; nó chưa phải toàn bộ `ReportVersion`:

```json
{
  "schemaVersion": 1,
  "reportId": "R100",
  "versionId": "R100-v1",
  "reportTypeId": "customer-segmentation",
  "title": "Phân nhóm khách hàng",
  "language": "vi-VN",
  "limitations": ["Dữ liệu minh họa"],
  "dashboard": [
    {
      "id": "customer-count",
      "kind": "metric-grid",
      "title": "Quy mô mẫu",
      "evidenceIds": [],
      "metrics": [
        { "id": "customers", "label": "Khách hàng", "value": 120, "unit": "người" }
      ]
    }
  ],
  "sections": [
    {
      "id": "method",
      "kind": "text",
      "title": "Phương pháp",
      "evidenceIds": [],
      "markdown": "Mô tả phạm vi và cách phân nhóm từ dữ liệu đã lưu."
    }
  ]
}
```

`diagnostics` trong kết quả do decoder cung cấp. Để mở trong ứng dụng cần thêm record/version hoàn chỉnh vào nguồn reports, metadata catalog, quyền đọc và artifact nếu có; chỉ đưa schema JSON vào UI không tạo báo cáo.

## Thêm loại báo cáo hoặc chart

Loại báo cáo mới sử dụng các block hiện có chỉ cần metadata trong `WorkspaceCatalog.reportTypes`, payload đã ánh xạ/kiểm tra và bản lưu có identity đúng. Query `type` nhận ID theo mẫu `^[a-z][a-z0-9-]{0,79}$`. Không cần thêm điều kiện loại báo cáo trong `ReportDashboard`/`ReportDocument`.

Nếu cần block mới, mở rộng union, decoder và renderer/fallback có chủ đích. Nếu cần chart mới, mở rộng `ChartType`, registry, kiểm tra compatibility, geometry/render family và nhãn hai locale; thêm fixture và test cho null, số không hợp lệ, geometry, bảng thay thế và hành vi browser. Dữ liệu mới không biểu diễn được bằng contract hiện tại phải được mô hình hóa trước khi vẽ.

## Fixture và kiểm tra

`report-showcase` cung cấp ví dụ các loại inventory, sales, benchmarking và custom, trong đó R019-v2 minh họa customer-segmentation. Các mock scenario `report-unknown-chart`, `report-invalid-chart`, `report-unknown-schema`, `report-unknown-type`, `report-empty-schema`, `report-large-table` dùng để kiểm tra fallback; bảng lớn có 1.200 hàng.

```text
/reports?scenario=report-showcase&report=R019&version=R019-v2
```

Các scenario này được chọn lúc khởi động service, cần reload khi đổi query `scenario`. Fixture Riverside mặc định dùng R010-v2 và schema cùng nguồn cho chat/report. Danh sách scenario đầy đủ nằm trong [14g](14g-frontend-development.md).

Test chính: [`schema.test.ts`](../../frontend/src/features/reports/tests/schema.test.ts), [`chart-registry.test.ts`](../../frontend/src/shared/charts/chart-registry.test.ts), [`ChartRenderer.test.tsx`](../../frontend/src/shared/charts/ChartRenderer.test.tsx), [`report-schema.spec.ts`](../../frontend/tests/report-schema.spec.ts) và [`riverside.test.ts`](../../frontend/src/features/reports/tests/riverside.test.ts).
