import { GitBranch, LoaderCircle, ShieldCheck } from 'lucide-react';
import { capabilityLabel } from '../../../components/capability-rail';
import type { WorkspaceContextState } from '../../workspace/context';
import { DetailRow, EmptyState, scopeLabel, type RunDetail } from './tab-primitives';
import styles from './context-evidence-panel.module.css';

export function ContextTab({
  organizationName,
  context,
  detail,
  noRun,
  unavailable,
  loading,
}: {
  organizationName: string;
  context: WorkspaceContextState;
  detail: RunDetail | null;
  noRun: boolean;
  unavailable: boolean;
  loading: boolean;
}) {
  return (
    <>
      <dl className={styles.detailList}>
        <DetailRow label="Không gian làm việc">{organizationName}</DetailRow>
        <DetailRow label="Chế độ">{capabilityLabel(context.mode)}</DetailRow>
        <DetailRow label="Lượt chạy">
          {context.active_run_id ? (
            <code title={context.active_run_id}>{context.active_run_id.slice(0, 12)}</code>
          ) : (
            'Chưa chọn kết quả'
          )}
        </DetailRow>
        {detail && (
          <>
            <DetailRow label="Scope">{scopeLabel(detail)}</DetailRow>
            <DetailRow label="Ảnh chụp dữ liệu">{detail.run.request.data_as_of}</DetailRow>
            <DetailRow label="Quy trình">{detail.run.workflow_version ?? 'legacy-v1'}</DetailRow>
          </>
        )}
      </dl>
      {noRun ? (
        <EmptyState icon={GitBranch} title="Chưa có kết quả đang chọn">
          Mở một lượt phân tích, báo cáo hoặc bằng chứng để xem bối cảnh liên quan.
        </EmptyState>
      ) : unavailable ? (
        <EmptyState icon={ShieldCheck} title="Kết quả không khả dụng">
          Không thể xác thực lại quyền truy cập kết quả này trong workspace.
        </EmptyState>
      ) : loading ? (
        <EmptyState icon={LoaderCircle} title="Đang tải bối cảnh đã xác thực">
          Đang kiểm tra lại lượt chạy trước khi hiển thị liên kết bằng chứng.
        </EmptyState>
      ) : null}
    </>
  );
}
