'use client';

import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { AgentWorkflowStatus } from '@vda/contracts';

function checkpointLabel(status: AgentWorkflowStatus['publication_status']) {
  if (status === 'succeeded') return 'Đã phát hành sau khi qua bước kiểm tra';
  if (status === 'failed') return 'Bước kiểm tra không chấp thuận phát hành';
  if (status === 'cancelled') return 'Đã hủy phát hành';
  if (status === 'running') return 'Đang kiểm tra trước khi phát hành';
  return 'Đang chờ phát hành';
}

export function WorkflowCheckpointStatus({ status }: { status: AgentWorkflowStatus }) {
  if (status.workflow_version !== 'agent-v1') return null;
  const reviewText = status.review
    ? status.review.status === 'PASS'
      ? `Người rà soát đã duyệt bản nháp ${status.review.draft_revision}.`
      : `Người rà soát yêu cầu chỉnh sửa bản nháp ${status.review.draft_revision}.`
    : status.draft_revision
      ? `Đang chờ rà soát bản nháp ${status.draft_revision}.`
      : 'Đang chờ bản nháp báo cáo.';
  const reviewIcon =
    status.review?.status === 'PASS' ? (
      <Check size={15} />
    ) : status.review?.status === 'REVISION_REQUIRED' ? (
      <CircleAlert size={15} />
    ) : (
      <LoaderCircle size={15} className="spin" />
    );

  return (
    <section className="agent-workflow-checkpoints card" aria-live="polite">
      <header className="section-heading">
        <div>
          <span className="eyebrow">ĐIỂM KIỂM TRA</span>
          <h2>Trạng thái bản nháp và phát hành</h2>
        </div>
        {status.review?.status === 'PASS' && <span className="badge">Đã duyệt</span>}
      </header>
      <dl className="metadata-list">
        <dt>Bản nháp báo cáo</dt>
        <dd>
          {status.draft_revision
            ? `Bản sửa bất biến ${status.draft_revision} đã được lưu`
            : 'Đang chờ tác nhân báo cáo'}
        </dd>
        <dt>Rà soát</dt>
        <dd className="agent-checkpoint-review">
          {reviewIcon}
          {reviewText}
        </dd>
        <dt>Phát hành</dt>
        <dd>{checkpointLabel(status.publication_status)}</dd>
      </dl>
    </section>
  );
}
