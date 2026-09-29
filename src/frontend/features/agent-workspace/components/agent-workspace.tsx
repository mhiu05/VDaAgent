'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AgentKeySchema,
  type AgentKey,
  type Catalog,
  type DashboardSelection,
  type RuntimeActivity,
  type WorkspaceActionV1,
} from '@vda/contracts';
import { agentConversationHref, workspaceRouteHref } from '../../../components/shell/routes';
import { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import { useAgentConversation } from '../../agent-chat/hooks/use-agent-conversation';
import { useConversationAgents } from '../../agent-chat/hooks/use-conversation-agents';
import { canonicalAgentKey } from '../../agent-chat/agent-workspace-model';
import type { WorkspaceContextState } from '../../workspace/context';
import { useWorkspaceAction } from '../hooks/use-workspace-action';
import { getRunDetail } from '../../analysis/api/run-data';
import { getRunRuntime } from '../../agent-chat/api/runtime';
import { WorkspaceRail } from './workspace-rail';
import { WorkspaceConversation } from './workspace-conversation';
import { WorkspaceInspector } from './workspace-inspector';
import styles from './agent-workspace.module.css';

export function AgentWorkspace({
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
  const search = useSearchParams();
  const selectedAgent: AgentKey =
    AgentKeySchema.safeParse(search.get('agent')).data ?? 'coordinator';
  const focusItem = search.get('item');
  const routeRun = search.get('run');
  const routeInvocation = search.get('source') === 'runtime' ? search.get('invocation') : null;
  const [railDrawer, setRailDrawer] = useState(false);
  const [inspectorDrawer, setInspectorDrawer] = useState(false);
  const railDialog = useRef<HTMLDialogElement>(null);
  const inspectorDialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const { actionError, handleWorkspaceAction } = useWorkspaceAction(
    orgId,
    workspaceRevision,
    onWorkspaceAction,
  );
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
    orgId,
    catalog,
    canWrite,
    sseEnabled,
    project,
    zone,
    dataAsOf,
    activeRunId: workspaceState.active_run_id,
    workspaceState,
    workspaceMode: 'report_dashboard',
    workspaceLayout: true,
    capabilityMode: workspaceState.mode,
    initialConversationId,
    externalRunId,
    onProject,
    onZone,
    onDataAsOf,
    onActiveRunChange,
    onWorkspaceAction: (action) => void applyWorkspaceAction(action),
    onClearExternalRun: () =>
      router.push(
        workspaceRouteHref(
          { page: 'chat', conversationId: chat.selectedConversationId ?? undefined },
          orgId,
        ),
        { scroll: false },
      ),
    onReport: (reportId) => router.push(workspaceRouteHref({ page: 'reports', reportId }, orgId)),
    onAcceptedConversation: (conversationId) => {
      if (window.location.pathname === '/chat')
        router.replace(agentConversationHref(orgId, conversationId, selectedAgent), {
          scroll: false,
        });
    },
  });
  const defaultScope = useRef('');
  useEffect(() => {
    const scope = `${orgId}:${chat.selectedConversationId ?? 'new'}:${selectedAgent}`;
    if (defaultScope.current === scope) return;
    defaultScope.current = scope;
    chat.setDefaultAgentTarget(selectedAgent === 'coordinator' ? null : selectedAgent);
  }, [orgId, chat, selectedAgent]);
  const agentSummaries = useConversationAgents(orgId, chat.selectedConversationId);
  const agentFeed = useAgentConversation(
    orgId,
    chat.selectedConversationId,
    selectedAgent,
    focusItem,
    agentSummaries.summary?.revision ?? '',
  );
  const selectRunRef = useRef(chat.selectRun);
  useEffect(() => {
    selectRunRef.current = chat.selectRun;
  });
  const hydratedRoute = useRef('');
  useEffect(() => {
    if (!focusItem || !routeRun || !routeInvocation || agentFeed.page?.focus_item !== focusItem)
      return;
    const item = agentFeed.page.items.find((value) => value.item_id === focusItem);
    if (
      !item ||
      item.kind === 'message' ||
      item.run_id !== routeRun ||
      item.delegation.child?.source !== 'runtime' ||
      item.delegation.child.activity_id !== routeInvocation
    )
      return;
    const key = `${orgId}:${chat.selectedConversationId}:${routeRun}:${routeInvocation}`;
    if (hydratedRoute.current === key) return;
    hydratedRoute.current = key;
    selectRunRef.current(routeRun);
  }, [orgId, chat.selectedConversationId, focusItem, routeRun, routeInvocation, agentFeed.page]);
  useEffect(() => {
    if (focusItem || !routeRun || !routeInvocation || !chat.selectedConversationId) return;
    const key = `${orgId}:${chat.selectedConversationId}:${routeRun}:${routeInvocation}`;
    if (hydratedRoute.current === key) return;
    let disposed = false;
    void Promise.all([getRunDetail(orgId, routeRun), getRunRuntime(orgId, routeRun)])
      .then(([detail, runtime]) => {
        if (
          disposed ||
          detail.run.request.conversation_id !== chat.selectedConversationId ||
          !runtime.records.some(
            (record) => record.kind === 'invocation' && record.activity_id === routeInvocation,
          )
        )
          return;
        hydratedRoute.current = key;
        selectRunRef.current(routeRun);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [orgId, chat.selectedConversationId, focusItem, routeRun, routeInvocation]);

  function closeDrawers() {
    railDialog.current?.close();
    inspectorDialog.current?.close();
  }
  function openRail() {
    closeDrawers();
    if (!railDrawer) return;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    railDialog.current?.showModal();
  }
  function openInspector() {
    closeDrawers();
    if (!inspectorDrawer) {
      setInspectorCollapsed((value) => !value);
      return;
    }
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inspectorDialog.current?.showModal();
  }
  async function applyWorkspaceAction(action: WorkspaceActionV1) {
    if ((await handleWorkspaceAction(action)) && action.type === 'open_evidence') {
      setInspectorCollapsed(false);
      if (inspectorDrawer) openInspector();
    }
  }
  function navigateConversation(id: string) {
    chat.selectConversation(id);
    closeDrawers();
    router.push(agentConversationHref(orgId, id, selectedAgent), { scroll: false });
  }
  function navigateAgent(
    agent: AgentKey,
    item?: string,
    runId?: string,
    invocationId?: string | null,
  ) {
    chat.setDefaultAgentTarget(agent === 'coordinator' ? null : agent);
    if (runId) chat.selectRun(runId);
    if (chat.selectedConversationId)
      router.push(
        agentConversationHref(orgId, chat.selectedConversationId, agent, {
          item,
          run: runId,
          source: invocationId ? 'runtime' : undefined,
          invocation: invocationId ?? undefined,
        }),
        { scroll: false },
      );
    else
      router.push(
        `${workspaceRouteHref({ page: 'chat' }, orgId)}&agent=${encodeURIComponent(agent)}`,
        { scroll: false },
      );
    closeDrawers();
  }
  function newConversation() {
    chat.newConversation();
    closeDrawers();
    router.push(workspaceRouteHref({ page: 'chat' }, orgId), { scroll: false });
  }
  const rail = (
    <WorkspaceRail
      orgId={orgId}
      conversations={chat.conversations}
      selectedConversation={chat.selectedConversation}
      selectedId={chat.selectedConversationId}
      agents={chat.threadWorkspace.agents}
      records={chat.runtime.snapshot.records}
      invocations={chat.agentExecution?.invocations}
      summaries={agentSummaries.summary?.agents}
      recipient={selectedAgent === 'coordinator' ? null : selectedAgent}
      onRecipient={(recipient) => {
        navigateAgent(recipient ?? 'coordinator');
      }}
      onWork={(work) =>
        navigateAgent(
          work.agent_key,
          work.item_id ?? undefined,
          work.run_id ?? undefined,
          work.execution?.source === 'runtime' ? work.execution.activity_id : null,
        )
      }
      canWrite={canWrite}
      loading={chat.loadingConversations}
      hasMore={chat.conversationCursor !== null}
      onNew={newConversation}
      onSelect={navigateConversation}
      onLoadMore={() =>
        chat.conversationCursor && void chat.loadConversations(chat.conversationCursor, true)
      }
    />
  );
  const inspector = (
    <WorkspaceInspector
      controller={chat}
      context={workspaceState}
      organizationName={organizationName}
      selectedInvocationId={routeInvocation}
      onSelectInvocation={(record: RuntimeActivity) => {
        chat.selectRun(record.run_id);
        if (chat.selectedConversationId)
          router.push(
            agentConversationHref(orgId, chat.selectedConversationId, selectedAgent, {
              run: record.run_id,
              source: 'runtime',
              invocation: record.activity_id,
            }),
            { scroll: false },
          );
      }}
      onOpenInvocation={(record: RuntimeActivity, request: RuntimeActivity) => {
        const agent = AgentKeySchema.safeParse(canonicalAgentKey(record.agent_key));
        if (agent.success)
          navigateAgent(
            agent.data,
            `activity:${request.activity_id}`,
            record.run_id,
            record.activity_id,
          );
      }}
      onArtifact={(id) => {
        onActiveArtifactChange(id);
        void chat.openEvidence(id);
      }}
    />
  );
  return (
    <div
      className={styles.workspace}
      data-inspector-collapsed={!inspectorDrawer && inspectorCollapsed}
    >
      {!railDrawer && <div className={styles.railDock}>{rail}</div>}
      {railDrawer && (
        <dialog
          ref={railDialog}
          className={styles.drawer}
          aria-label="Hội thoại và quy trình"
          onClose={() => restoreFocus.current?.focus()}
        >
          <button
            type="button"
            className={styles.drawerClose}
            onClick={() => railDialog.current?.close()}
          >
            Đóng
          </button>
          {rail}
        </dialog>
      )}
      <WorkspaceConversation
        controller={chat}
        selectedAgent={selectedAgent}
        agentFeed={agentFeed}
        onOpenAgent={(agent, item, runId, invocationId) =>
          navigateAgent(agent, item, runId, invocationId)
        }
        onViewExecution={(runId, invocationId, item) => {
          chat.selectRun(runId);
          if (chat.selectedConversationId)
            router.push(
              agentConversationHref(orgId, chat.selectedConversationId, selectedAgent, {
                run: runId,
                item,
                source: invocationId ? 'runtime' : undefined,
                invocation: invocationId ?? undefined,
              }),
              { scroll: false },
            );
        }}
        catalog={catalog}
        organizationName={organizationName}
        directRun={Boolean(externalRunId)}
        onWorkspaceAction={(action) => void applyWorkspaceAction(action)}
        onOpenRail={openRail}
        onOpenInspector={openInspector}
      />
      {!inspectorDrawer && !inspectorCollapsed && (
        <div className={styles.inspectorDock}>{inspector}</div>
      )}
      {inspectorDrawer && (
        <dialog
          ref={inspectorDialog}
          className={styles.drawer}
          aria-label="Bối cảnh và bằng chứng"
          onClose={() => restoreFocus.current?.focus()}
        >
          <button
            type="button"
            className={styles.drawerClose}
            onClick={() => inspectorDialog.current?.close()}
          >
            Đóng
          </button>
          {inspector}
        </dialog>
      )}
      {actionError && (
        <p className={styles.actionError} role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
