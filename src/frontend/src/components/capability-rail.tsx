'use client';

import {
  BarChart3,
  Bot,
  FileText,
  GitCompareArrows,
  Lightbulb,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { CapabilityMode } from '@vda/contracts';

export const capabilityModes: Array<{
  mode: CapabilityMode;
  label: string;
  icon: LucideIcon;
}> = [
  { mode: 'grok', label: 'Grok', icon: Bot },
  { mode: 'data', label: 'Dữ liệu', icon: Table2 },
  { mode: 'insight', label: 'Nhận định', icon: Lightbulb },
  { mode: 'compare', label: 'So sánh', icon: GitCompareArrows },
  { mode: 'chart', label: 'Biểu đồ', icon: BarChart3 },
  { mode: 'report', label: 'Báo cáo', icon: FileText },
];

export function capabilityLabel(mode: CapabilityMode) {
  return capabilityModes.find((item) => item.mode === mode)?.label ?? 'Grok';
}

export function CapabilityRail({
  mode,
  onMode,
}: {
  mode: CapabilityMode;
  onMode: (mode: CapabilityMode) => void;
}) {
  return (
    <nav className="capability-rail" aria-label="Chế độ trợ lý">
      <p className="nav-caption">CHẾ ĐỘ TRỢ LÝ</p>
      {capabilityModes.map((item) => (
        <button
          className={'nav-item ' + (mode === item.mode ? 'active' : '')}
          key={item.mode}
          onClick={() => onMode(item.mode)}
          aria-current={mode === item.mode ? 'page' : undefined}
        >
          <item.icon size={18} />
          {item.label}
          {mode === item.mode && <span className="nav-dot" />}
        </button>
      ))}
    </nav>
  );
}
