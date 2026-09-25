'use client';

import { type KeyboardEvent, useId, useMemo, useState } from 'react';
import { FileText, GitBranch, ShieldCheck, Workflow, type LucideIcon } from 'lucide-react';
import { useEvidenceRun } from '../hooks/use-evidence-run';
import type { WorkspaceContextState } from '../../workspace/context';
import { capabilityLabel } from '../../../components/capability-rail';
import styles from './context-evidence-panel.module.css';
import { ContextTab } from './context-tab';
import { EvidenceTab } from './evidence-tab';
import { FilesTab } from './files-tab';
import { RunTab } from './run-tab';

type PanelTab = 'context' | 'evidence' | 'files' | 'run';

const tabs: Array<{ id: PanelTab; label: string; icon: LucideIcon }> = [
  { id: 'context', label: 'Bối cảnh', icon: GitBranch },
  { id: 'evidence', label: 'Bằng chứng', icon: ShieldCheck },
  { id: 'files', label: 'Tệp nguồn', icon: FileText },
  { id: 'run', label: 'Lượt chạy', icon: Workflow },
];

function moveTab(
  event: KeyboardEvent<HTMLButtonElement>,
  current: PanelTab,
  onSelect: (tab: PanelTab) => void,
) {
  const currentIndex = tabs.findIndex((item) => item.id === current);
  const nextIndex =
    event.key === 'ArrowRight'
      ? (currentIndex + 1) % tabs.length
      : event.key === 'ArrowLeft'
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : currentIndex;
  if (nextIndex === currentIndex) return;
  event.preventDefault();
  onSelect(tabs[nextIndex]!.id);
  const buttons =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]');
  buttons?.[nextIndex]?.focus();
}

function isPublicContextArtifact(kind: string) {
  return kind !== 'report_draft' && kind !== 'review_result';
}

export function ContextEvidencePanel({
  orgId,
  organizationName,
  context,
  onClearStaleNotice,
}: {
  orgId: string;
  organizationName: string;
  context: WorkspaceContextState;
  onClearStaleNotice: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>('context');
  const panelId = useId();

  const { activeRunDetail, activeArtifacts, unavailable, artifactsUnavailable } = useEvidenceRun(
    orgId,
    context.active_run_id,
  );
  const publicArtifacts = useMemo(
    () =>
      activeArtifacts?.artifacts.filter((artifact) => isPublicContextArtifact(artifact.kind)) ?? [],
    [activeArtifacts],
  );
  const selectedArtifact = context.active_artifact_id
    ? (publicArtifacts.find((item) => item.artifact_id === context.active_artifact_id) ?? null)
    : null;
  const selectedValidation = selectedArtifact
    ? (activeArtifacts?.validations.find(
        (item) => item.artifact_id === selectedArtifact.artifact_id,
      ) ?? null)
    : null;
  const currentTab = tabs.find((item) => item.id === tab) ?? tabs[0]!;
  const noRun = !context.active_run_id;
  const loadingRun = Boolean(context.active_run_id) && !unavailable && !activeRunDetail;

  return (
    <aside className={`card ${styles.panel}`} aria-label="Bối cảnh và bằng chứng">
      <header className={styles.header}>
        <div>
          <span className="eyebrow">BỐI CẢNH ĐANG CHỌN</span>
          <h2>Bối cảnh &amp; bằng chứng</h2>
        </div>
        <span className="badge">{capabilityLabel(context.mode)}</span>
      </header>

      {context.stale_selection_cleared && (
        <div className={styles.notice} role="status">
          <p>Lựa chọn trước thuộc về một kết quả khác nên đã được xóa.</p>
          <button className="text-button" type="button" onClick={onClearStaleNotice}>
            Đóng thông báo
          </button>
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Chi tiết bối cảnh đang chọn">
        {tabs.map((item) => {
          const Icon = item.icon;
          const selected = item.id === tab;
          return (
            <button
              key={item.id}
              id={`${panelId}-${item.id}-tab`}
              className={styles.tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? `${panelId}-${item.id}-panel` : undefined}
              data-active={selected ? 'true' : 'false'}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => moveTab(event, item.id, setTab)}
            >
              <Icon size={14} aria-hidden={true} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${panelId}-${currentTab.id}-panel`}
        className={styles.tabPanel}
        role="tabpanel"
        aria-labelledby={`${panelId}-${currentTab.id}-tab`}
      >
        {tab === 'context' && (
          <ContextTab
            organizationName={organizationName}
            context={context}
            detail={activeRunDetail}
            noRun={noRun}
            unavailable={unavailable}
            loading={loadingRun}
          />
        )}
        {tab === 'evidence' && (
          <EvidenceTab
            noRun={noRun}
            unavailable={unavailable}
            loading={loadingRun}
            artifactsUnavailable={artifactsUnavailable}
            artifacts={publicArtifacts}
            validations={activeArtifacts?.validations ?? []}
            selectedArtifact={selectedArtifact}
            selectedValidation={selectedValidation}
            context={context}
          />
        )}
        {tab === 'files' && (
          <FilesTab
            noRun={noRun}
            unavailable={unavailable}
            loading={loadingRun}
            artifactsUnavailable={artifactsUnavailable}
            sources={activeArtifacts?.sources ?? []}
          />
        )}
        {tab === 'run' && (
          <RunTab
            noRun={noRun}
            unavailable={unavailable}
            loading={loadingRun}
            detail={activeRunDetail}
            panelId={panelId}
          />
        )}
      </div>

      <p className={styles.qualityNote}>
        <ShieldCheck size={14} aria-hidden={true} />
        Máy chủ xác thực lại quyền truy cập trước khi sử dụng dữ liệu liên quan.
      </p>
    </aside>
  );
}
