import { SEMANTIC_VERSION } from '@vda/contracts/common/primitives';
import type { MetricKey, MetricUnit } from '@vda/contracts/analysis/metrics';

export type ScopeType = 'project' | 'zone';
export type DimensionKey = 'project' | 'zone' | 'unit_type' | 'bedrooms' | 'status';

export type MetricDefinition = Readonly<{
  key: MetricKey;
  label: string;
  description: string;
  unit: MetricUnit;
  requiredFields: readonly string[];
  supportedScopes: readonly ScopeType[];
  supportedDimensions: readonly DimensionKey[];
  supportsTrend: boolean;
  aggregationBehavior: string;
  nullBehavior: string;
  semanticVersion: typeof SEMANTIC_VERSION;
}>;

const allScopes = ['project', 'zone'] as const;
const allDimensions = ['project', 'zone', 'unit_type', 'bedrooms', 'status'] as const;
const segmentDimensions = ['zone', 'unit_type', 'bedrooms', 'status'] as const;

function definition(
  value: Omit<MetricDefinition, 'supportedScopes' | 'semanticVersion'> & {
    supportedScopes?: readonly ScopeType[];
  },
): MetricDefinition {
  return Object.freeze({
    ...value,
    supportedScopes: value.supportedScopes ?? allScopes,
    semanticVersion: SEMANTIC_VERSION,
  });
}

export const metricRegistry = Object.freeze({
  total_inventory: definition({
    key: 'total_inventory',
    label: 'Tổng số căn',
    description:
      'Số căn riêng biệt có trong mốc dữ liệu gần nhất tính đến ngày phân tích.',
    unit: 'count',
    requiredFields: ['unit_external_id', 'snapshot_date'],
    supportedDimensions: allDimensions,
    supportsTrend: true,
    aggregationBehavior: 'distinct latest unit count',
    nullBehavior: 'Không có dữ liệu khi chưa có mốc dữ liệu phù hợp.',
  }),
  available_inventory: definition({
    key: 'available_inventory',
    label: 'Số căn còn hàng',
    description: 'Số căn có trạng thái còn hàng tại mốc dữ liệu gần nhất.',
    unit: 'count',
    requiredFields: ['unit_external_id', 'snapshot_date', 'status'],
    supportedDimensions: allDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count of available latest units',
    nullBehavior: 'Không có dữ liệu khi chưa có mốc dữ liệu phù hợp.',
  }),
  available_inventory_rate: definition({
    key: 'available_inventory_rate',
    label: 'Tỷ lệ căn còn hàng',
    description: 'Số căn còn hàng chia cho tổng số căn.',
    unit: 'percent',
    requiredFields: ['status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio of additive counts',
    nullBehavior: 'Không tính được khi mẫu số bằng 0.',
  }),
  sold_units_7d: definition({
    key: 'sold_units_7d',
    label: 'Số căn đã bán (7 ngày)',
    description:
      'Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 7 ngày tính đến ngày phân tích.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Không tính các căn chưa có ngày bán.',
  }),
  sold_units_30d: definition({
    key: 'sold_units_30d',
    label: 'Số căn đã bán (30 ngày)',
    description:
      'Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 30 ngày tính đến ngày phân tích.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Không tính các căn chưa có ngày bán.',
  }),
  sold_units_90d: definition({
    key: 'sold_units_90d',
    label: 'Số căn đã bán (90 ngày)',
    description:
      'Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 90 ngày tính đến ngày phân tích.',
    unit: 'count',
    requiredFields: ['sold_at'],
    supportedDimensions: segmentDimensions,
    supportsTrend: false,
    aggregationBehavior: 'count of snapshot-reported sold_at dates',
    nullBehavior: 'Không tính các căn chưa có ngày bán.',
  }),
  inventory_change_7d: definition({
    key: 'inventory_change_7d',
    label: 'Biến động số căn còn hàng (7 ngày)',
    description:
      'Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 7 ngày trước.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Không có dữ liệu nếu thiếu lịch sử để đối chiếu.',
  }),
  inventory_change_30d: definition({
    key: 'inventory_change_30d',
    label: 'Biến động số căn còn hàng (30 ngày)',
    description:
      'Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 30 ngày trước.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Không có dữ liệu nếu thiếu lịch sử để đối chiếu.',
  }),
  inventory_change_90d: definition({
    key: 'inventory_change_90d',
    label: 'Biến động số căn còn hàng (90 ngày)',
    description:
      'Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 90 ngày trước.',
    unit: 'count',
    requiredFields: ['snapshot_date', 'status'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of point-in-time counts',
    nullBehavior: 'Không có dữ liệu nếu thiếu lịch sử để đối chiếu.',
  }),
  median_inventory_age_days: definition({
    key: 'median_inventory_age_days',
    label: 'Tuổi tồn kho trung vị',
    description: 'Số ngày tồn kho trung vị của các căn còn hàng có ngày bắt đầu tồn kho.',
    unit: 'days',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile at p=0.5',
    nullBehavior: 'Các căn thiếu ngày bắt đầu tồn kho được loại trừ và báo cáo riêng.',
  }),
  p75_inventory_age_days: definition({
    key: 'p75_inventory_age_days',
    label: 'Tuổi tồn kho phân vị P75',
    description: 'Phân vị 75% số ngày tồn kho của các căn còn hàng có ngày bắt đầu tồn kho.',
    unit: 'days',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Các căn thiếu ngày bắt đầu tồn kho được loại trừ và báo cáo riêng.',
  }),
  slow_moving_units: definition({
    key: 'slow_moving_units',
    label: 'Số căn tồn kho lâu',
    description: 'Số căn còn hàng có thời gian tồn kho từ ngưỡng được cấu hình trở lên.',
    unit: 'count',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count',
    nullBehavior: 'Các căn chưa xác định được tuổi tồn kho được loại trừ và báo cáo riêng.',
  }),
  slow_moving_rate: definition({
    key: 'slow_moving_rate',
    label: 'Tỷ lệ căn tồn kho lâu',
    description: 'Số căn tồn kho lâu chia cho số căn còn hàng đã xác định tuổi tồn kho.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không tính được khi không có căn còn hàng đã xác định tuổi tồn kho.',
  }),
  unknown_inventory_age: definition({
    key: 'unknown_inventory_age',
    label: 'Số căn chưa rõ tuổi tồn kho',
    description: 'Số căn còn hàng chưa có ngày bắt đầu tồn kho.',
    unit: 'count',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'count',
    nullBehavior: 'Các giá trị thiếu được đếm riêng.',
  }),
  unknown_inventory_age_rate: definition({
    key: 'unknown_inventory_age_rate',
    label: 'Tỷ lệ căn chưa rõ tuổi tồn kho',
    description: 'Số căn còn hàng chưa rõ tuổi tồn kho chia cho tổng số căn còn hàng.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không tính được khi không có căn còn hàng.',
  }),
  median_price: definition({
    key: 'median_price',
    label: 'Giá niêm yết trung vị',
    description:
      'Giá niêm yết dương trung vị của các căn còn hàng khi các quan sát dùng cùng một loại tiền tệ.',
    unit: 'currency',
    requiredFields: ['status', 'list_price', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'decimal median',
    nullBehavior: 'Các giá trị thiếu hoặc không lớn hơn 0 được loại trừ.',
  }),
  median_price_per_area: definition({
    key: 'median_price_per_area',
    label: 'Giá mỗi m² trung vị',
    description:
      'Trung vị giá niêm yết chia cho diện tích của các căn còn hàng hợp lệ dùng cùng một loại tiền tệ.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'median of unit ratios',
    nullBehavior: 'Các giá trị thiếu hoặc không lớn hơn 0 được loại trừ.',
  }),
  p25_price_per_area: definition({
    key: 'p25_price_per_area',
    label: 'Giá mỗi m² phân vị P25',
    description: 'Phân vị 25% giá trên mỗi m² của các căn còn hàng hợp lệ.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Các giá trị thiếu hoặc không lớn hơn 0 được loại trừ.',
  }),
  p75_price_per_area: definition({
    key: 'p75_price_per_area',
    label: 'Giá mỗi m² phân vị P75',
    description: 'Phân vị 75% giá trên mỗi m² của các căn còn hàng hợp lệ.',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'linear percentile',
    nullBehavior: 'Các giá trị thiếu hoặc không lớn hơn 0 được loại trừ.',
  }),
  price_per_area_iqr: definition({
    key: 'price_per_area_iqr',
    label: 'Khoảng tứ phân vị giá mỗi m²',
    description: 'Giá trị P75 trừ giá trị P25 trên mỗi m².',
    unit: 'currency_per_sqm',
    requiredFields: ['status', 'list_price', 'area_sqm', 'currency'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'difference of percentiles',
    nullBehavior: 'Không có dữ liệu khi chưa tính được các phân vị.',
  }),
  missing_inventory_age_rate: definition({
    key: 'missing_inventory_age_rate',
    label: 'Tỷ lệ thiếu tuổi tồn kho',
    description: 'Số căn còn hàng chưa có ngày bắt đầu tồn kho chia cho tổng số căn còn hàng.',
    unit: 'percent',
    requiredFields: ['status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không tính được khi không có căn còn hàng.',
  }),
  missing_price_rate: definition({
    key: 'missing_price_rate',
    label: 'Tỷ lệ thiếu giá niêm yết',
    description: 'Số căn tại mốc dữ liệu gần nhất thiếu giá niêm yết dương chia cho tổng số căn.',
    unit: 'percent',
    requiredFields: ['list_price'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không tính được khi tổng số căn bằng 0.',
  }),
  missing_area_rate: definition({
    key: 'missing_area_rate',
    label: 'Tỷ lệ thiếu diện tích',
    description: 'Số căn tại mốc dữ liệu gần nhất thiếu diện tích dương chia cho tổng số căn.',
    unit: 'percent',
    requiredFields: ['area_sqm'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không tính được khi tổng số căn bằng 0.',
  }),
  records_with_invalid_or_unusable_values: definition({
    key: 'records_with_invalid_or_unusable_values',
    label: 'Số bản ghi có giá trị không hợp lệ',
    description:
      'Số căn tại mốc dữ liệu gần nhất thiếu giá hoặc diện tích dương, hoặc căn còn hàng chưa rõ tuổi tồn kho.',
    unit: 'count',
    requiredFields: ['list_price', 'area_sqm', 'status', 'available_since'],
    supportedDimensions: segmentDimensions,
    supportsTrend: true,
    aggregationBehavior: 'distinct count',
    nullBehavior: 'Không có dữ liệu khi chưa có mốc dữ liệu phù hợp.',
  }),
  snapshot_coverage: definition({
    key: 'snapshot_coverage',
    label: 'Mức độ bao phủ dữ liệu',
    description:
      'Số căn trong mốc dữ liệu hiện tại được chọn chia cho tổng số căn riêng biệt ghi nhận trong phạm vi đến ngày phân tích.',
    unit: 'percent',
    requiredFields: ['unit_external_id', 'snapshot_date'],
    supportedDimensions: [],
    supportsTrend: true,
    aggregationBehavior: 'ratio',
    nullBehavior: 'Không có dữ liệu khi không có tập căn lịch sử để đối chiếu.',
  }),
} satisfies Record<MetricKey, MetricDefinition>);

export function getMetricDefinition(key: MetricKey): MetricDefinition {
  return metricRegistry[key];
}
