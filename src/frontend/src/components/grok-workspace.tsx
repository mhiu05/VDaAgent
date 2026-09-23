'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  DecisionIntelligenceResponseSchema,
  ReportDetailSchema,
  RunDetailSchema,
  WorkspaceActionV1Schema,
  type Catalog,
  type DashboardSelection,
  type WorkspaceActionV1,
} from '@vda/contracts';
import { api, scoped } from '../lib/client-api';
import { ContextEvidencePanel } from './context-evidence-panel';
import { capabilityLabel } from './capability-rail';
import { AgentChat } from './agent-chat/agent-chat';
import { EvidenceDrawer } from './evidence';
import { GrokDashboardSurface } from './grok-dashboard-surface';
import type { WorkspaceContextState } from './workspace-context';

type ArtifactList = z.infer<typeof ArtifactListSchema>;

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
  staleSelectionCleared,
  onProject,
  onZone,
  onDataAsOf,
  onActiveRunChange,
  onWorkspaceAction,
  onDashboardSelectionChange,
  onActiveArtifactChange,
  onClearStaleNotice,
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
}) {
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [evidenceBundle, setEvidenceBundle] = useState<ArtifactList | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const actionRequestRef = useRef(0);
  const activeRevisionRef = useRef(workspaceRevision);

  useEffect(() => {
    activeRevisionRef.current = workspaceRevision;
  }, [workspaceRevision]);

  useEffect(() => {
    function closeContextPanel(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextPanelOpen(false);
    }
    window.addEventListener('keydown', closeContextPanel);
    return () => window.removeEventListener('keydown', closeContextPanel);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1200px)');
    const closeOnCompactLayout = () => {
      if (query.matches) setContextPanelOpen(false);
    };
    closeOnCompactLayout();
    query.addEventListener('change', closeOnCompactLayout);
    return () => query.removeEventListener('change', closeOnCompactLayout);
  }, []);

  useEffect(() => {
    const runId = workspaceState.active_run_id;
    const artifactId = workspaceState.active_artifact_id;
    if (!runId || !artifactId) {
      setEvidenceBundle(null);
      return;
    }
    let obsolete = false;
    setEvidenceBundle(null);
    void api(scoped('/runs/' + runId + '/artifacts', orgId), ArtifactListSchema)
      .then((bundle) => {
        if (!obsolete) setEvidenceBundle(bundle);
      })
      .catch(() => {
        if (!obsolete) setEvidenceBundle(null);
      });
    return () => {
      obsolete = true;
    };
  }, [orgId, workspaceState.active_artifact_id, workspaceState.active_run_id]);

  const selectedEvidence = evidenceBundle?.artifacts.find(
    (artifact) => artifact.artifact_id === workspaceState.active_artifact_id,
  );

  async function rehydrateAction(action: WorkspaceActionV1) {
    switch (action.type) {
      case 'switch_capability_mode':
        return;
      case 'open_dashboard':
        if (action.report_id) {
          const detail = await api(
            scoped('/reports/' + action.report_id, orgId),
            ReportDetailSchema,
          );
          if (detail.report.run_id !== action.run_id) throw new Error('stale workspace action');
          return;
        }
        await api(scoped('/runs/' + action.run_id, orgId), RunDetailSchema);
        return;
      case 'open_evidence': {
        const bundle = await api(
          scoped('/runs/' + action.run_id + '/artifacts', orgId),
          ArtifactListSchema,
        );
        if (!bundle.artifacts.some((artifact) => artifact.artifact_id === action.artifact_id))
          throw new Error('stale workspace action');
        return;
      }
      case 'focus_visual':
      case 'focus_priority_entity':
      case 'open_drilldown': {
        const response = await api(
          scoped('/runs/' + action.run_id + '/decision-intelligence', orgId),
          DecisionIntelligenceResponseSchema,
        );
        if (response.status !== 'available') throw new Error('stale workspace action');
        const isPresent =
          action.type === 'focus_visual'
            ? response.decision_intelligence.visual_story.ordered_visuals.some(
                (visual) => visual.chart_id === action.chart_id,
              )
            : action.type === 'focus_priority_entity'
              ? response.decision_intelligence.priority_entities.some(
                  (entity) => entity.priority_entity_id === action.priority_entity_id,
                )
              : response.decision_intelligence.drilldowns.some(
                  (drilldown) => drilldown.drilldown_id === action.drilldown_id,
                );
        if (!isPresent) throw new Error('stale workspace action');
      }
    }
  }

  async function handleWorkspaceAction(candidate: WorkspaceActionV1) {
    setActionError(null);
    const requestAtStart = ++actionRequestRef.current;
    const revisionAtStart = activeRevisionRef.current;
    try {
      const action = WorkspaceActionV1Schema.parse(candidate);
      await rehydrateAction(action);
      if (
        actionRequestRef.current !== requestAtStart ||
        activeRevisionRef.current !== revisionAtStart
      )
        return;
      onWorkspaceAction(action, revisionAtStart);
    } catch {
      if (
        actionRequestRef.current === requestAtStart &&
        activeRevisionRef.current === revisionAtStart
      )
        setActionError('The referenced workspace context is unavailable.');
    }
  }

  return (
    <div className="grok-workspace">
      <section className="grok-main-surface">
        <header className="section-heading grok-workspace-heading">
          <div>
            <span className="eyebrow">GROK WORKSPACE</span>
            <h2>{capabilityLabel(workspaceState.mode)}</h2>
          </div>
          <button
            className="secondary"
            type="button"
            aria-controls="workspace-context-panel"
            aria-expanded={contextPanelOpen}
            onClick={() => setContextPanelOpen((open) => !open)}
          >
            Context
          </button>
        </header>
        {actionError && (
          <div className="error-box" role="status">
            {actionError}
          </div>
        )}
        <GrokDashboardSurface
          key={
            (workspaceState.active_run_id ?? 'none') +
            ':' +
            (workspaceState.active_report_id ?? 'none')
          }
          orgId={orgId}
          context={workspaceState}
          onSelectionChange={onDashboardSelectionChange}
          onAskGrok={() => setComposerFocusRequest((request) => request + 1)}
          onOpenEvidence={(artifactId, runId) =>
            void handleWorkspaceAction({
              type: 'open_evidence',
              run_id: runId,
              artifact_id: artifactId,
              evidence_path: null,
            })
          }
        />
        <AgentChat
          orgId={orgId}
          catalog={catalog}
          canWrite={canWrite}
          sseEnabled={sseEnabled}
          project={project}
          zone={zone}
          dataAsOf={dataAsOf}
          activeRunId={workspaceState.active_run_id}
          workspaceState={workspaceState}
          workspaceMode="report_dashboard"
          workspaceLayout
          showConversationList={false}
          capabilityMode={workspaceState.mode}
          focusComposerRequest={composerFocusRequest}
          onProject={onProject}
          onZone={onZone}
          onDataAsOf={onDataAsOf}
          onActiveRunChange={onActiveRunChange}
          onWorkspaceAction={(action) => void handleWorkspaceAction(action)}
        />
      </section>
      {contextPanelOpen && (
        <button
          className="grok-context-backdrop"
          type="button"
          aria-label="Close context panel"
          onClick={() => setContextPanelOpen(false)}
        />
      )}
      <div
        id="workspace-context-panel"
        className="grok-context-shell"
        data-open={contextPanelOpen ? 'true' : 'false'}
        aria-hidden={!contextPanelOpen}
      >
        <ContextEvidencePanel
          orgId={orgId}
          organizationName={organizationName}
          context={{ ...workspaceState, stale_selection_cleared: staleSelectionCleared }}
          onClearStaleNotice={onClearStaleNotice}
        />
      </div>
      {selectedEvidence && evidenceBundle && (
        <EvidenceDrawer
          artifact={selectedEvidence}
          artifacts={evidenceBundle.artifacts}
          validations={evidenceBundle.validations}
          sources={evidenceBundle.sources}
          onSelect={onActiveArtifactChange}
          onClose={() => onActiveArtifactChange(null)}
        />
      )}
    </div>
  );
}
