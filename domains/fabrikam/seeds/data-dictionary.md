# Từ điển dữ liệu kho Fabrikam (schema `gold`, DB `cdw`)

Tài liệu này ghi lại ý nghĩa của các khóa số hóa và trường định tính trong schema `gold` của kho
dữ liệu bất động sản Fabrikam (`WAREHOUSE_DSN`, vai trò đọc `agent_readonly`). Nội dung được xác
minh trực tiếp qua `information_schema` và truy vấn `distinct` tại snapshot `SNAP-20260630-01`
(bảng `gold.snapshot_manifest`) — không phải suy đoán. Đọc file này **trước khi** diễn giải bất kỳ
khóa, mã hoặc trường định tính nào từ các bảng dưới.

File này luôn áp dụng, không phụ thuộc vào tùy chọn "Diễn giải ngữ nghĩa" trong Cài đặt — đây là
quy tắc đọc dữ liệu đúng, không phải cách trình bày cho người dùng.

## Nguyên tắc đọc

1. **Khóa số hóa (surrogate key)** — các cột `*_key` (integer/bigint) chỉ có ý nghĩa khi tra ngược
   sang bảng dimension tương ứng. Không coi `unit_key`, `project_key`, `zone_key`, `channel_key`,
   `date_key`/`snapshot_date_key`/`effective_date_key`, `infra_key` là một phép đo hay dùng trong
   tính toán định lượng.
2. **Mã tự nhiên dạng chuỗi** — các cột `*_id`/`*_code` (vd. `unit_id`, `comp_id`, `config_key`,
   `snapshot_id`) là định danh nghiệp vụ có sẵn, không phải văn bản tự do, nhưng cũng không phải
   khóa số hóa.
3. **Trường thứ bậc (ordinal)** — `severity_rank` (1–3 trong `unit_diagnostic_causes`) là thứ hạng,
   không phải giá trị định lượng liên tục; không lấy trung bình/tổng trên trường này mà không cân
   nhắc ý nghĩa thứ hạng.
4. **Giá trị chưa có trong danh sách enum dưới đây**: coi là `unmapped` — không tự suy diễn ý
   nghĩa; nêu rõ trong kết quả là giá trị chưa được xác minh, và có thể đề xuất bổ sung vào file
   này. Danh sách enum là ảnh chụp tại snapshot hiện tại, không chắc đầy đủ vĩnh viễn.

## Bảng và khóa (schema `gold`, 16 bảng)

| Bảng | Trường số hóa / mã | Ý nghĩa |
|---|---|---|
| `dim_date` | `date_key` | Mã ngày — surrogate key dùng làm FK trong mọi bảng fact có `*date_key` |
| `dim_infrastructure_assets` | `infra_key` | Mã hạ tầng |
| `dim_project_profile` | `project_key` | Mã dự án |
| `dim_sales_channel` | `channel_key` | Mã kênh bán hàng |
| `dim_unit_master` | `unit_key`, `project_key`, `zone_key` | Mã căn, dự án và khu/tòa |
| `dim_zone_master` | `zone_key`, `project_key` | Mã khu/tòa và dự án |
| `dim_secondary_market_comps` | `comp_id`, `project_id` | Mã so sánh thứ cấp và mã dự án — mã chuỗi tự nhiên, không phải surrogate key; `project_id` không tự động khớp với `dim_project_profile.project_key`, cần đối chiếu qua `project_id` nếu bảng đó có cột tương đương |
| `fact_sales_channel_performance` | `snapshot_date_key`, `channel_key`, `project_key` | Mã ngày, kênh và dự án |
| `fact_sales_funnel_daily` | `date_key`, `unit_key` | Mã ngày và căn |
| `fact_unit_inventory_snapshot` | `snapshot_date_key`, `unit_key`, `project_key`, `zone_key`, `channel_key` | Mã ngày, căn, dự án, khu và kênh |
| `fact_unit_price_history` | `unit_key`, `effective_date_key` | Mã căn và ngày hiệu lực |
| `fact_market_macro_monthly` | `date_key`, `market_id` | Mã ngày (số hóa) và mã thị trường; `market_id` là mã chuỗi tự nhiên, **không có bảng `dim_market` riêng** trong `gold` |
| `dm_unit_friction_diagnostics` | `snapshot_date_key`, `unit_key`, `primary_cause_code` | Mã ngày, căn và nguyên nhân chính; `primary_cause_code` lưu dạng mã chuỗi (xem enum bên dưới) |
| `unit_diagnostic_causes` | `unit_key`, `snapshot_date_key`, `severity_rank` | Mã căn, ngày và mức độ nghiêm trọng cấp 1–3 (ordinal, không phải khóa) |
| `semantic_config` | `config_key` | Mã tham số cấu hình ngưỡng/trọng số nghiệp vụ — chuỗi tự nhiên |
| `snapshot_manifest` | `snapshot_id` | Mã snapshot (vd. `SNAP-20260630-01`) — chuỗi tự nhiên |

## Cờ định tính dạng boolean (0/1)

- `dim_date.is_weekend`
- `dim_project_profile.is_sales_permit_issued`
- `dim_project_profile.is_bank_guarantee_issued`
- `dim_project_profile.max_foreign_quota_exceeded`
- `dim_unit_master.is_corner_unit`
- `dim_unit_master.is_adjacent_elevator`
- `dim_unit_master.is_taboo_floor`
- `fact_unit_inventory_snapshot.is_overdue_flag`
- `fact_unit_inventory_snapshot.is_exclusive_lock`

## Trường định tính dạng varchar — enum đã xác minh tại snapshot hiện tại

| Trường | Giá trị chuẩn | Ý nghĩa |
|---|---|---|
| `fact_unit_inventory_snapshot.inventory_status` | `AVAILABLE` | Còn hàng |
| | `BOOKED` | Đã giữ chỗ |
| | `SOLD` | Đã bán |
| `dim_unit_master.unit_type` | `STUDIO`, `1PN`, `2PN`, `3PN`, `4PN` | Căn studio, một đến bốn phòng ngủ |
| | `DUPLEX` | Căn thông tầng (hai tầng) |
| | `PENTHOUSE` | Căn penthouse |
| `dim_unit_master.floor_band` | `LOW`, `MID`, `HIGH`, `TOP` | Dải tầng thấp/trung/cao/cao nhất theo quy ước dự án |
| `dim_unit_master.balcony_orientation` / `door_orientation` | `N`,`NE`,`E`,`SE`,`S`,`SW`,`W`,`NW` | Hướng la bàn của ban công / cửa chính; `door_orientation` có thể `NULL` (chưa ghi nhận) |
| `dim_unit_master.view_primary_type` | `CITY_OPEN` | Hướng nhìn ra khu vực đô thị mở |
| | `INTERNAL_COURT` | Nhìn vào khoảng sân/giếng trời nội khu |
| | `OBSTRUCTED` | Tầm nhìn bị che chắn |
| | `PARK` | Nhìn ra công viên |
| | `POOL` | Nhìn ra bể bơi |
| | `RIVER` | Nhìn ra sông |
| `dim_unit_master.taboo_view_type` | `NONE` | Không có yếu tố view kiêng kỵ |
| | `CEMETERY` | Gần/nhìn thấy nghĩa trang |
| | `TEMPLE` | Gần/nhìn thấy đền/chùa |
| | `WASTE_STATION` | Gần/nhìn thấy trạm xử lý rác |
| `dim_project_profile.developer_tier` | `TIER_1`, `TIER_2` | Hạng chủ đầu tư theo phân loại nội bộ |
| `dim_project_profile.segment` | `MID`, `MID_HIGH`, `LUXURY` | Phân khúc dự án: trung cấp / trung-cao cấp / cao cấp |
| `dim_project_profile.construction_status` | `FOUNDATION` | Đang làm phần móng |
| | `SUPERSTRUCTURE` | Đang xây phần thân |
| | `HANDED_OVER` | Đã bàn giao |
| `dim_infrastructure_assets.infra_type` | `AIRPORT`, `BRIDGE`, `EXPRESSWAY`, `RING_ROAD`, `URBAN_METRO` | Loại hạ tầng: sân bay / cầu / cao tốc / đường vành đai / metro đô thị |
| `dim_infrastructure_assets.lifecycle_stage` | `PLANNING_APPROVED` | Đã được phê duyệt quy hoạch |
| | `UNDER_CONSTRUCTION` | Đang xây dựng |
| | `COMMERCIAL_OPERATION` | Đã vận hành thương mại |
| `dim_sales_channel.channel_tier` | `INHOUSE` | Kênh bán hàng nội bộ |
| | `TIER_1_EXCLUSIVE` | Đại lý độc quyền hạng 1 |
| | `TIER_2_GENERAL` | Đại lý phổ thông hạng 2 |
| `dim_zone_master.zone_type` | `HIGH_RISE_TOWER`, `LOW_RISE_VILLA` | Tòa cao tầng / biệt thự thấp tầng |
| `dim_zone_master.handover_standard` | `BARE_SHELL` | Bàn giao thô |
| | `BASIC_FINISH` | Bàn giao hoàn thiện cơ bản |
| | `FULLY_FURNISHED` | Bàn giao đầy đủ nội thất |
| `dim_secondary_market_comps.pink_book_status` | `PINK_BOOK_AVAILABLE` | Đã có sổ hồng |
| | `SPA_ASSIGNMENT` | Chuyển nhượng theo hợp đồng mua bán (chưa có sổ) |
| `fact_sales_funnel_daily.cancellation_reason` | `PRICE_TOO_HIGH` | Lý do hủy ghi nhận: khách cho rằng giá quá cao — **đây là lý do được ghi nhận trong hệ thống, không phải phản hồi gốc đã được xác minh độc lập từ khách hàng** |
| | `LOAN_REJECTED` | Hồ sơ vay bị từ chối |
| | `DEFECT_FOUND` | Phát hiện lỗi/khuyết điểm căn hộ |
| | `NULL` | Chưa ghi nhận lý do hủy |
| `fact_unit_price_history.change_reason` | `CAMPAIGN` | Thay đổi giá theo chương trình khuyến mãi |
| | `MARKET_RALLY` | Thay đổi theo đà tăng của thị trường |
| | `STIMULATE_SLOW_MOVING` | Giảm giá để kích thích căn bán chậm |
| `dm_unit_friction_diagnostics.primary_cause_code` / `unit_diagnostic_causes.cause_code` | `OVERPRICED_VS_PEER` | Giá cao hơn nhóm so sánh |
| | `DEEP_FUNNEL_DROP_OFF` | Rớt sâu trong phễu bán hàng |
| | `SEVERE_PHYSICAL_DEFECT` | Khuyết điểm vật lý nghiêm trọng |
| | `INSUFFICIENT_PEER_DATA` | Không đủ dữ liệu nhóm so sánh |
| | `LEGAL_PERMIT_BARRIER` | Vướng pháp lý/giấy phép |
| | `LOW_SALES_INCENTIVE` | Chính sách khuyến khích bán hàng thấp (hoa hồng/spiff) |
| | `LUMP_SUM_TICKET_BARRIER` | Giá trị căn so với thu nhập khách hàng quá lớn |
| | `MULTI_FACTOR_UNCLASSIFIED` | Nhiều yếu tố cộng hưởng, chưa phân loại rõ nguyên nhân chính |
| | `SECONDARY_ARBITRAGE` | Lệch giá so với thị trường thứ cấp tạo cơ hội arbitrage |
| | `EXTREME_THERMAL_EXPOSURE` | Hướng nắng/nhiệt bất lợi quá mức |
| `dm_unit_friction_diagnostics.recommended_action` | — | **Không phải enum cố định.** Một số bản ghi chỉ có mã (vd. `BANK_SUBSIDY_EXTENSION`), một số khác kèm mô tả tiếng Việt không dấu dài sau dấu `:`. Không coi các mô tả dài này là danh sách mã đóng; khi trích dẫn, giữ nguyên nội dung gốc. |

## `gold.semantic_config` — ngưỡng/trọng số nghiệp vụ (47 dòng)

Bảng tham số cấu hình, **không phải** từ điển mã phân loại. Mỗi dòng có `config_key`,
`config_value`, `value_type` (`DECIMAL`/`INTEGER`/`BOOLEAN` — cách parse `config_value`),
`semantic_version`, `approval_status` (`PENDING` hoặc `APPROVED`), `description`.

**Quy tắc quan trọng:** khi trích dẫn một ngưỡng/trọng số từ bảng này, luôn nêu kèm
`approval_status`. Không trình bày một ngưỡng còn `approval_status = PENDING` như một quy tắc
nghiệp vụ đã chốt chính thức — chỉ coi là tham số đang thử nghiệm/chưa phê duyệt.

Tại snapshot hiện tại, các `config_key` đã `APPROVED`: `floor_max`, `floor_min`, `floor_top_min`,
`net_area_max_m2`, `net_area_min_m2`, `min_peer_count`, `overdue_threshold_days`,
`peer_area_tolerance_pct`. Tất cả `config_key` còn lại (vd. các trọng số `attribution_weight_*`,
các ngưỡng `defect_*`, `funnel_dropoff_threshold_pct`, `low_commission_threshold_pct`,
`spiff_bonus_*`, `subsidy_support_min_mo`, v.v.) đang `PENDING`.

## `gold.snapshot_manifest` — định nghĩa cố định của snapshot hiện tại

`snapshot_id = SNAP-20260630-01`, `dataset_id = vdaagent_dw_re`, `currency = VND`,
`price_basis = ASKING_EXCL_VAT_EXCL_MAINT` (giá niêm yết, chưa gồm VAT và phí quản lý),
`area_basis = NET_INTERNAL_M2` (diện tích tính theo net nội bộ), `timezone = Asia/Ho_Chi_Minh`,
`source_system = ENTERPRISE_DW_RE`.

Khi trình bày giá hoặc diện tích cho người dùng, dùng đúng các định nghĩa trên (đơn vị VND, diện
tích net, giá chưa VAT/phí quản lý) thay vì tự giả định.
