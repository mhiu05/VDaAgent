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
  { mode: 'data', label: 'Data', icon: Table2 },
  { mode: 'insight', label: 'Insights', icon: Lightbulb },
  { mode: 'compare', label: 'Compare', icon: GitCompareArrows },
  { mode: 'chart', label: 'Charts', icon: BarChart3 },
  { mode: 'report', label: 'Reports', icon: FileText },
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
    <nav className="capability-rail" aria-label="Assistant capabilities">
      <p className="nav-caption">CAPABILITIES</p>
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
