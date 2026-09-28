const localizedMetricLabels: Record<string, string> = {
  total_inventory: 'Tổng số căn',
  available_inventory: 'Số căn còn hàng',
  available_inventory_rate: 'Tỷ lệ căn còn hàng',
  sold_units_7d: 'Số căn đã bán (7 ngày)',
  sold_units_30d: 'Số căn đã bán (30 ngày)',
  sold_units_90d: 'Số căn đã bán (90 ngày)',
  inventory_change_7d: 'Biến động số căn còn hàng (7 ngày)',
  inventory_change_30d: 'Biến động số căn còn hàng (30 ngày)',
  inventory_change_90d: 'Biến động số căn còn hàng (90 ngày)',
  median_inventory_age_days: 'Tuổi tồn kho trung vị',
  p75_inventory_age_days: 'Tuổi tồn kho phân vị P75',
  slow_moving_units: 'Số căn tồn kho lâu',
  slow_moving_rate: 'Tỷ lệ căn tồn kho lâu',
  unknown_inventory_age: 'Số căn chưa rõ tuổi tồn kho',
  unknown_inventory_age_rate: 'Tỷ lệ căn chưa rõ tuổi tồn kho',
  median_price: 'Giá trung vị',
  median_price_per_area: 'Giá trung vị trên mỗi m²',
  p25_price_per_area: 'Giá trên mỗi m² phân vị P25',
  p75_price_per_area: 'Giá trên mỗi m² phân vị P75',
  price_per_area_iqr: 'Khoảng tứ phân vị giá trên mỗi m²',
  missing_inventory_age_rate: 'Tỷ lệ thiếu tuổi tồn kho',
  missing_price_rate: 'Tỷ lệ thiếu giá niêm yết',
  missing_area_rate: 'Tỷ lệ thiếu diện tích',
  records_with_invalid_or_unusable_values: 'Số bản ghi có giá trị không hợp lệ hoặc không sử dụng được',
  snapshot_coverage: 'Mức độ bao phủ mốc dữ liệu',
};

const localizedMetricDescriptions: Record<string, string> = {
  total_inventory: "Số căn riêng biệt có trong mốc dữ liệu gần nhất tính đến ngày phân tích.",
  available_inventory: "Số căn có trạng thái còn hàng tại mốc dữ liệu gần nhất.",
  available_inventory_rate: "Số căn còn hàng chia cho tổng số căn.",
  sold_units_7d: "Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 7 ngày tính đến ngày phân tích.",
  sold_units_30d: "Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 30 ngày tính đến ngày phân tích.",
  sold_units_90d: "Số căn tại mốc dữ liệu gần nhất có ngày bán trong khoảng 90 ngày tính đến ngày phân tích.",
  inventory_change_7d: "Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 7 ngày trước.",
  inventory_change_30d: "Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 30 ngày trước.",
  inventory_change_90d: "Số căn còn hàng hiện tại trừ số căn tại mốc dữ liệu gần nhất của 90 ngày trước.",
  median_inventory_age_days: "Số ngày tồn kho trung vị của các căn còn hàng có ngày bắt đầu tồn kho.",
  p75_inventory_age_days: "Phân vị 75% số ngày tồn kho của các căn còn hàng có ngày bắt đầu tồn kho.",
  slow_moving_units: "Số căn còn hàng có thời gian tồn kho từ ngưỡng được cấu hình trở lên.",
  slow_moving_rate: "Số căn tồn kho lâu chia cho số căn còn hàng đã xác định tuổi tồn kho.",
  unknown_inventory_age: "Số căn còn hàng chưa có ngày bắt đầu tồn kho.",
  unknown_inventory_age_rate: "Số căn còn hàng chưa rõ tuổi tồn kho chia cho tổng số căn còn hàng.",
  median_price: "Giá niêm yết dương trung vị của các căn còn hàng khi các quan sát dùng cùng một loại tiền tệ.",
  median_price_per_area: "Trung vị giá niêm yết chia cho diện tích của các căn còn hàng hợp lệ dùng cùng một loại tiền tệ.",
  p25_price_per_area: "Phân vị 25% giá trên mỗi m² của các căn còn hàng hợp lệ.",
  p75_price_per_area: "Phân vị 75% giá trên mỗi m² của các căn còn hàng hợp lệ.",
  price_per_area_iqr: "Giá trị P75 trừ giá trị P25 trên mỗi m².",
  missing_inventory_age_rate: "Số căn còn hàng chưa có ngày bắt đầu tồn kho chia cho tổng số căn còn hàng.",
  missing_price_rate: "Số căn tại mốc dữ liệu gần nhất thiếu giá niêm yết dương chia cho tổng số căn.",
  missing_area_rate: "Số căn tại mốc dữ liệu gần nhất thiếu diện tích dương chia cho tổng số căn.",
  records_with_invalid_or_unusable_values: "Số căn tại mốc dữ liệu gần nhất thiếu giá hoặc diện tích dương, hoặc căn còn hàng chưa rõ tuổi tồn kho.",
  snapshot_coverage: "Số căn trong mốc dữ liệu hiện tại được chọn chia cho tổng số căn riêng biệt ghi nhận trong phạm vi đến ngày phân tích.",
};

const legacyChartTexts: Record<string, string> = {
  'Available inventory trend': 'Xu hướng số căn còn hàng',
  'Show validated latest-at-or-before inventory values at each as-of target date.':
    'Thể hiện số căn còn hàng đã xác thực tại mốc dữ liệu gần nhất của từng ngày mục tiêu.',
  'As-of date': 'Ngày dữ liệu',
  'Available inventory': 'Số căn còn hàng',
  'Inventory age distribution': 'Phân bố tuổi tồn kho',
  'Semantic bucket order is preserved': 'Giữ nguyên thứ tự các nhóm tuổi tồn kho.',
  'Compare available inventory across validated age buckets.':
    'So sánh số căn còn hàng theo các nhóm tuổi tồn kho đã được xác thực.',
  'Age bucket (days)': 'Nhóm tuổi tồn kho (ngày)',
  'Units': 'Số căn',
  'Available units': 'Căn còn hàng',
  'Available inventory composition by unit type': 'Cơ cấu căn còn hàng theo loại căn',
  'Show a validated part-to-whole composition with bounded cardinality.':
    'Thể hiện cơ cấu đã xác thực giữa các nhóm với số nhóm giới hạn.',
  'Slow-moving rate by zone': 'Tỷ lệ căn tồn kho lâu theo khu vực',
  'Compare the validated slow-moving rate across zones.':
    'So sánh tỷ lệ căn tồn kho lâu đã xác thực giữa các khu vực.',
  'Price per area distribution': 'Phân bố giá trên mỗi m²',
  'Validated quartile summary': 'Tóm tắt các tứ phân vị đã xác thực',
  'Compare validated price-per-area quartiles without recalculating them.':
    'So sánh các tứ phân vị giá trên mỗi m² đã xác thực mà không tính lại.',
  'Statistic': 'Thống kê',
  'Price per m²': 'Giá mỗi m²',
  'Unit price per area vs peer median': 'Đơn giá mỗi m² so với trung vị nhóm tương đồng',
  'Compare each compatible unit observation with its validated cohort median.':
    'So sánh giá trị hợp lệ của từng căn với trung vị đã xác thực của nhóm tương đồng.',
  'Unit': 'Căn',
  'Subject unit': 'Căn đang xem',
  'Peer median': 'Trung vị nhóm tương đồng',
  'No validated current metric is available for KPI evidence.':
    'Chưa có chỉ số hiện tại đã được xác thực để làm bằng chứng cho chỉ số chính.',
  'At least two distinct validated snapshot dates are required for a line chart.':
    'Cần ít nhất hai ngày dữ liệu khác nhau đã được xác thực để tạo biểu đồ đường.',
  'No validated inventory-age buckets are available.':
    'Chưa có nhóm tuổi tồn kho đã được xác thực.',
  'The required validated breakdown is unavailable.':
    'Chưa có dữ liệu phân nhóm đã được xác thực cần thiết.',
  'The validated breakdown has no plottable values.':
    'Dữ liệu phân nhóm đã xác thực không có giá trị để vẽ biểu đồ.',
  'P25, median, and P75 price-per-area metrics must all be available.':
    'Cần có đủ chỉ số giá trên mỗi m² ở phân vị P25, trung vị và P75.',
  'Price quartiles require one explicit currency.':
    'Các tứ phân vị giá cần dùng cùng một loại tiền tệ được xác định rõ.',
  'No validated peer-comparison artifact is available.':
    'Chưa có dữ liệu so sánh nhóm tương đồng đã được xác thực.',
  'No unit has a valid target value and a validated peer median.':
    'Không có căn nào có giá trị mục tiêu hợp lệ và trung vị nhóm tương đồng đã được xác thực.',
  'Peer observations must share one currency to use a common chart axis.':
    'Các căn trong nhóm tương đồng cần dùng cùng một loại tiền tệ để so sánh trên cùng trục biểu đồ.',
  'zone': 'Khu vực',
  'unit_type': 'Loại căn',
};

export function localizeLegacyChartText(value: string) {
  const known = legacyChartTexts[value];
  if (known) return known;
  const compositionLimit = value.match(/^Composition charts are limited to (\d+) categories\.$/);
  if (compositionLimit) return 'Biểu đồ cơ cấu chỉ hiển thị tối đa ' + compositionLimit[1] + ' nhóm.';
  const peerLimit = value.match(/^Peer comparison is limited to (\d+) units\.$/);
  if (peerLimit) return 'Biểu đồ so sánh nhóm tương đồng chỉ hiển thị tối đa ' + peerLimit[1] + ' căn.';
  return value;
}

export function localizedMetricDescription(metricKey: string, sourceDescription: string) {
  return localizedMetricDescriptions[metricKey] ?? localizeLegacyChartText(sourceDescription);
}

export function localizedMetricLabel(metricKey: string, sourceLabel?: string) {
  return localizedMetricLabels[metricKey] ??
    (sourceLabel ? localizeLegacyChartText(sourceLabel) : 'Chỉ số tồn kho');
}

const legacyPercentFinding = /^[A-Za-z][A-Za-z -]* is (\d+(?:\.\d+)?) percent\.$/;
const legacyAgingLimitation = /^Aging metrics exclude (\d+) available unit\(s\) with unknown age \(([\d.]+)% of available inventory\)\.$/;

const legacyLimitations: Record<string, string> = {
  'Assumption / MVP provisional — dữ liệu tổng hợp và công thức synthetic, chưa được BA/Data Owner phê duyệt.':
    'Giả định thử nghiệm cho MVP — dữ liệu tổng hợp và công thức mô phỏng, chưa được Bộ phận Phân tích nghiệp vụ hoặc Chủ sở hữu dữ liệu phê duyệt.',
  'Missing available_since remains null; cohorts with fewer than three peers abstain.':
    'Ngày bắt đầu khả dụng bị thiếu sẽ được giữ trống; nhóm có dưới ba căn đối chiếu sẽ không đưa ra kết quả so sánh.',
  'No snapshot exists at the selected date and scope; affected metrics remain null.':
    'Không có mốc dữ liệu trong ngày và phạm vi đã chọn; các chỉ số liên quan chưa có giá trị.',
  'Visual comparison is descriptive and does not imply causation.':
    'Biểu đồ chỉ mô tả số liệu, không khẳng định quan hệ nhân quả.',
};

export function localizeLegacyMetricStatement(
  statement: string,
  metricKey: string,
  metricLabels: Map<string, string>,
  metricUnits: Map<string, string>,
) {
  const match = statement.match(legacyPercentFinding);
  if (!match || metricUnits.get(metricKey) !== 'percent') return statement;
  const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 20 }).format(Number(match[1]));
  return (metricLabels.get(metricKey) ?? 'Chỉ số tồn kho') + ': ' + number + '%.';
}

const legacySectionTitles: Record<string, string> = {
  executive_summary: 'Tóm tắt điều hành',
  inventory_overview: 'Tổng quan tồn kho',
  trend: 'Xu hướng',
  aging_analysis: 'Thời gian tồn kho',
  price_analysis: 'Phân tích giá',
  segment_analysis: 'Phân tích phân khúc',
  comparison: 'So sánh',
  data_quality_limitations: 'Chất lượng dữ liệu và giới hạn',
  evidence_lineage: 'Nguồn bằng chứng',
};

export function localizeLegacyReportSectionTitle(key: string, fallback: string) {
  return legacySectionTitles[key] ?? fallback;
}

export function localizeLegacyReportTitle(value: string) {
  const prefix = 'Inventory report · ';
  return value.startsWith(prefix) ? 'Báo cáo tồn kho · ' + value.slice(prefix.length) : value;
}

export function localizeLegacyLimitation(text: string) {
  const known = legacyLimitations[text];
  if (known) return known;
  const match = text.match(legacyAgingLimitation);
  if (!match) return text;
  const percentage = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 20 }).format(Number(match[2]));
  return 'Chỉ số tuổi tồn kho không tính ' + match[1] +
    ' căn còn hàng chưa rõ tuổi (' + percentage + '% tổng số căn còn hàng).';
}
