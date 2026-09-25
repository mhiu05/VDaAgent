import type { RunTask } from '@vda/contracts';

const agent: ReadonlyArray<[RunTask['kind'], readonly RunTask['kind'][]]> = [
  ['coordinator', []], ['data', ['coordinator']], ['comparison', ['data']],
  ['chart', ['data']], ['analyst', ['data']],
  ['insight', ['comparison', 'chart', 'analyst']], ['report', ['insight']],
  ['reviewer', ['report']], ['publication', ['reviewer']],
];
const legacy: ReadonlyArray<[RunTask['kind'], readonly RunTask['kind'][]]> = [
  ['orchestrator', []], ['data', ['orchestrator']], ['calculation', ['data']],
  ['comparison', ['calculation']], ['chart', ['calculation', 'comparison']],
  ['insight', ['chart']], ['validation', ['insight']], ['report', ['validation']],
];
const names: Record<RunTask['kind'], string> = {
  orchestrator: 'Điều phối', coordinator: 'Điều phối', data: 'Dữ liệu',
  calculation: 'Tính toán', comparison: 'So sánh', chart: 'Biểu đồ',
  analyst: 'Phân tích', insight: 'Nhận định', validation: 'Xác thực',
  report: 'Bản nháp báo cáo', reviewer: 'Rà soát', publication: 'Phát hành',
};
const states: Record<RunTask['status'], string> = {
  pending: 'Đang chờ', running: 'Đang xử lý', succeeded: 'Hoàn tất',
  failed: 'Thất bại', cancelled: 'Đã hủy',
};
export const stageLabel = (kind: RunTask['kind'], version?: string) =>
  kind === 'report' && (version ?? 'legacy-v1') === 'legacy-v1' ? 'Báo cáo' : names[kind];
export const stageStateLabel = (status: RunTask['status']) => states[status];

function matches(tasks: RunTask[], expected: ReadonlyArray<[RunTask['kind'], readonly RunTask['kind'][]]>) {
  if (tasks.length !== expected.length) return false;
  const byKind = new Map(tasks.map((task) => [task.kind, task]));
  if (byKind.size !== tasks.length) return false;
  return expected.every(([kind, deps]) => {
    const task = byKind.get(kind);
    return task && task.dependencies.length === deps.length && deps.every((dep) => task.dependencies.includes(dep));
  });
}

/** Layout is selected only when the pinned version and returned edges agree. */
export function workflowViewModel(version: string | undefined, tasks: RunTask[]) {
  const pinned = version ?? 'legacy-v1';
  const layout = pinned === 'agent-v1' && matches(tasks, agent) ? 'agent'
    : pinned === 'legacy-v1' && matches(tasks, legacy) ? 'legacy' : 'generic';
  const expected = layout === 'agent' ? agent : layout === 'legacy' ? legacy : null;
  const order = new Map(expected?.map(([kind], index) => [kind, index]) ?? []);
  return {
    layout,
    tasks: [...tasks].sort((a, b) => (order.get(a.kind) ?? tasks.indexOf(a)) - (order.get(b.kind) ?? tasks.indexOf(b))),
    completed: tasks.filter((task) => task.status === 'succeeded').length,
    active: tasks.filter((task) => task.status === 'running'),
  } as const;
}
