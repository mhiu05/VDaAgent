import type { CapabilityMode } from '@vda/contracts';

const capabilityLabels: Record<CapabilityMode, string> = {
  grok: 'Grok',
  data: 'Dữ liệu',
  insight: 'Nhận định',
  compare: 'So sánh',
  chart: 'Biểu đồ',
  report: 'Báo cáo',
};

export function capabilityLabel(mode: CapabilityMode) {
  return capabilityLabels[mode] ?? 'Grok';
}
