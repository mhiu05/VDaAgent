import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  ChartNoAxesCombined,
  Database,
  FileCheck2,
  FileText,
  GitCompareArrows,
  Lightbulb,
  ScanSearch,
} from 'lucide-react';
import type { AgentKey } from '@vda/contracts';

export type AgentIdentity = {
  accent: string;
  description: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
};

export const agentIdentities: Record<AgentKey, AgentIdentity> = {
  coordinator: { accent: 'coordinator', description: 'Điều phối yêu cầu trong phạm vi được phép.', icon: Bot, label: 'Điều phối viên', shortLabel: 'Điều phối' },
  data: { accent: 'data', description: 'Tải và kiểm tra ảnh chụp dữ liệu đã khóa.', icon: Database, label: 'Tác nhân dữ liệu', shortLabel: 'Dữ liệu' },
  comparison: { accent: 'comparison', description: 'Tạo bằng chứng cho phép so sánh được yêu cầu.', icon: GitCompareArrows, label: 'Tác nhân so sánh', shortLabel: 'So sánh' },
  chart: { accent: 'chart', description: 'Chuẩn bị các hiện vật biểu đồ phù hợp.', icon: ChartNoAxesCombined, label: 'Tác nhân biểu đồ', shortLabel: 'Biểu đồ' },
  analyst: { accent: 'analyst', description: 'Phân tích các mẫu hình gắn với bằng chứng.', icon: ScanSearch, label: 'Tác nhân phân tích', shortLabel: 'Phân tích' },
  insight: { accent: 'insight', description: 'Kết nối các phát hiện có căn cứ thành nhận định.', icon: Lightbulb, label: 'Tác nhân nhận định', shortLabel: 'Nhận định' },
  report: { accent: 'report', description: 'Chuẩn bị hiện vật báo cáo trong phạm vi được phép.', icon: FileText, label: 'Tác nhân báo cáo', shortLabel: 'Báo cáo' },
  reviewer: { accent: 'reviewer', description: 'Thực hiện bước rà soát cuối cùng.', icon: FileCheck2, label: 'Người rà soát', shortLabel: 'Rà soát' },
};

export function agentIdentity(agent: AgentKey | null | undefined): AgentIdentity | null {
  return agent ? agentIdentities[agent] : null;
}
