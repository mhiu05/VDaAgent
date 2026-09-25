'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Catalog, DashboardSelection, WorkspaceActionV1 } from '@vda/contracts';
import { workspaceRouteHref } from '../../../components/shell/routes';
import { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import type { WorkspaceContextState } from '../../workspace/context';
import { useWorkspaceAction } from '../hooks/use-workspace-action';
import { WorkspaceRail } from './workspace-rail';
import { WorkspaceConversation } from './workspace-conversation';
import { WorkspaceInspector } from './workspace-inspector';
import styles from './grok-workspace.module.css';

export function GrokWorkspace({
  orgId,
  organizationName,
  catalog,
  canWrite,
  sseEnabled,
  project,
  zone,
  dataAsOf,
  workspaceState,
  workspaceRevision,
  onProject,
  onZone,
  onDataAsOf,
  onActiveRunChange,
  onWorkspaceAction,
  onActiveArtifactChange,
  initialConversationId,
  externalRunId,
}: {
  orgId: string;
  organizationName: string;
  catalog: Catalog;
  canWrite: boolean;
  sseEnabled: boolean;
  project: string;
  zone: string;
  dataAsOf: string;
  workspaceState: WorkspaceContextState;
  workspaceRevision: number;
  staleSelectionCleared: boolean;
  onProject: (value: string) => void;
  onZone: (value: string) => void;
  onDataAsOf: (value: string) => void;
  onActiveRunChange: (value: string | null) => void;
  onWorkspaceAction: (action: WorkspaceActionV1, expectedRevision?: number) => void;
  onDashboardSelectionChange: (selection: DashboardSelection | null, runId: string) => void;
  onActiveArtifactChange: (artifactId: string | null) => void;
  onClearStaleNotice: () => void;
  initialConversationId?: string;
  externalRunId?: string | null;
}) {
  const router = useRouter();
  const [railDrawer, setRailDrawer] = useState(false);
  const [inspectorDrawer, setInspectorDrawer] = useState(false);
  const railDialog = useRef<HTMLDialogElement>(null);
  const inspectorDialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const { actionError, handleWorkspaceAction } = useWorkspaceAction(orgId, workspaceRevision, onWorkspaceAction);
  useEffect(() => {
    const railQuery = window.matchMedia('(max-width: 1024px)');
    const inspectorQuery = window.matchMedia('(max-width: 1279px)');
    const update = () => {
      setRailDrawer(railQuery.matches);
      setInspectorDrawer(inspectorQuery.matches);
      railDialog.current?.close();
      inspectorDialog.current?.close();
    };
    update();
    railQuery.addEventListener('change', update);
    inspectorQuery.addEventListener('change', update);
    return () => {
      railQuery.removeEventListener('change', update);
      inspectorQuery.removeEventListener('change', update);
    };
  }, []);

  const chat = useAgentChatController({
    orgId, catalog, canWrite, sseEnabled, project, zone, dataAsOf,
    activeRunId: workspaceState.active_run_id,
    workspaceState,
    workspaceMode: 'report_dashboard',
    workspaceLayout: true,
    capabilityMode: workspaceState.mode,
    initialConversationId,
    externalRunId,
    onProject, onZone, onDataAsOf, onActiveRunChange,
    onWorkspaceAction: (action) => void applyWorkspaceAction(action),
    onClearExternalRun: () => router.push(workspaceRouteHref({ page: 'chat', conversationId: chat.selectedConversationId ?? undefined }, orgId), { scroll: false }),
    onReport: (reportId) => router.push(workspaceRouteHref({ page: 'reports', reportId }, orgId)),
  });

  function closeDrawers() {
    railDialog.current?.close();
    inspectorDialog.current?.close();
  }
  function openRail() {
    closeDrawers();
    if (!railDrawer) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    railDialog.current?.showModal();
  }
  function openInspector() {
    closeDrawers();
    if (!inspectorDrawer) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inspectorDialog.current?.showModal();
  }
  async function applyWorkspaceAction(action: WorkspaceActionV1) {
    if (await handleWorkspaceAction(action) && action.type === 'open_evidence') openInspector();
  }
  function navigateConversation(id: string) {
    chat.selectConversation(id);
    closeDrawers();
    router.push(workspaceRouteHref({ page: 'chat', conversationId: id }, orgId), { scroll: false });
  }
  function newConversation() {
    chat.newConversation();
    closeDrawers();
    router.push(workspaceRouteHref({ page: 'chat' }, orgId), { scroll: false });
  }
  const rail = <WorkspaceRail
    conversations={chat.conversations}
    selectedConversation={chat.selectedConversation}
    selectedId={chat.selectedConversationId}
    tasks={chat.currentRunDetail?.tasks ?? []}
    workflowVersion={chat.currentRunDetail?.run.workflow_version}
    canWrite={canWrite}
    loading={chat.loadingConversations}
    hasMore={chat.conversationCursor !== null}
    onNew={newConversation}
    onSelect={navigateConversation}
    onLoadMore={() => chat.conversationCursor && void chat.loadConversations(chat.conversationCursor, true)}
    onStage={(task) => {
      setSelectedStage(task.task_id);
      closeDrawers();
      openInspector();
      document.querySelector<HTMLElement>(`[data-stage-output="${task.kind}"]`)?.scrollIntoView({ block: 'nearest' });
    }}
  />;
  const inspector = <WorkspaceInspector
    controller={chat}
    context={workspaceState}
    organizationName={organizationName}
    selectedStage={selectedStage}
    onArtifact={(id) => {
      onActiveArtifactChange(id);
      void chat.openEvidence(id);
    }}
  />;
  return <div className={styles.workspace}>
    {!railDrawer && <div className={styles.railDock}>{rail}</div>}
    {railDrawer && <dialog ref={railDialog} className={styles.drawer} aria-label="Hội thoại và quy trình" onClose={() => restoreFocus.current?.focus()}>
      <button type="button" className={styles.drawerClose} onClick={() => railDialog.current?.close()}>Đóng</button>{rail}
    </dialog>}
    <WorkspaceConversation
      controller={chat}
      catalog={catalog}
      organizationName={organizationName}
      directRun={Boolean(externalRunId)}
      onWorkspaceAction={(action) => void applyWorkspaceAction(action)}
      onOpenRail={openRail}
      onOpenInspector={openInspector}
    />
    {!inspectorDrawer && <div className={styles.inspectorDock}>{inspector}</div>}
    {inspectorDrawer && <dialog ref={inspectorDialog} className={styles.drawer} aria-label="Bối cảnh và bằng chứng" onClose={() => restoreFocus.current?.focus()}>
      <button type="button" className={styles.drawerClose} onClick={() => inspectorDialog.current?.close()}>Đóng</button>{inspector}
    </dialog>}
    {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
  </div>;
}
