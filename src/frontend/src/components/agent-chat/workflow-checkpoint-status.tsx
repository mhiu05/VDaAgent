'use client';

import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { AgentWorkflowStatus } from '@vda/contracts';

function checkpointLabel(status: AgentWorkflowStatus['publication_status']) {
  if (status === 'succeeded') return 'Published after deterministic gate';
  if (status === 'failed') return 'Publication gate rejected';
  if (status === 'cancelled') return 'Publication cancelled';
  if (status === 'running') return 'Publication gate running';
  return 'Publication pending';
}

export function WorkflowCheckpointStatus({ status }: { status: AgentWorkflowStatus }) {
  if (status.workflow_version !== 'agent-v1') return null;
  const reviewText = status.review
    ? status.review.status === 'PASS'
      ? `Reviewer passed draft revision ${status.review.draft_revision}.`
      : `Reviewer requested the bounded revision for draft ${status.review.draft_revision}.`
    : status.draft_revision
      ? `Reviewer is pending for draft revision ${status.draft_revision}.`
      : 'Report draft is pending.';
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
          <span className="eyebrow">REVIEW CHECKPOINTS</span>
          <h2>Draft and publication status</h2>
        </div>
        {status.review?.status === 'PASS' && <span className="badge">Reviewer PASS</span>}
      </header>
      <dl className="metadata-list">
        <dt>Report draft</dt>
        <dd>
          {status.draft_revision
            ? `Immutable revision ${status.draft_revision} persisted`
            : 'Waiting for Report Agent'}
        </dd>
        <dt>Reviewer</dt>
        <dd className="agent-checkpoint-review">
          {reviewIcon}
          {reviewText}
        </dd>
        <dt>Publication</dt>
        <dd>{checkpointLabel(status.publication_status)}</dd>
      </dl>
    </section>
  );
}
