import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  workspaceRouteMeta,
  type WorkspaceRoute,
  type WorkspaceSurface,
} from '../../../components/shell/routes';
import type { WorkspaceContextAction } from '../context';

export function safeRouteForOrganization(route: WorkspaceRoute): WorkspaceRoute {
  if (route.page === 'chat' && route.conversationId) return { page: 'chat' };
  if (route.page === 'runs' && route.runId) return { page: 'runs' };
  if (route.page === 'reports' && route.reportId) return { page: 'reports' };
  return route;
}

export function resolveWorkspaceRoute(route: WorkspaceRoute) {
  return {
    routeMeta: workspaceRouteMeta(route),
    routedConversationId: route.page === 'chat' ? route.conversationId : undefined,
    routedRunId: route.page === 'runs' ? route.runId : undefined,
    routedReportId: route.page === 'reports' ? route.reportId : undefined,
  };
}

export function useWorkspaceRouteSelection(
  route: WorkspaceRoute,
  selection: ReturnType<typeof resolveWorkspaceRoute>,
  setTab: Dispatch<SetStateAction<WorkspaceSurface>>,
  setEvidenceId: Dispatch<SetStateAction<string | null>>,
  dispatchWorkspaceContext: Dispatch<WorkspaceContextAction>,
  selectRun: (id: string, conversation?: string, navigate?: boolean) => void,
  openReport: (id: string, navigate?: boolean) => Promise<void>,
) {
  const loadedRouteRunId = useRef<string | undefined>(undefined);
  const loadedRouteReportId = useRef<string | undefined>(undefined);
  useEffect(() => {
    setTab(selection.routeMeta.surface);
    setEvidenceId(null);
    if (route.page === 'chat') dispatchWorkspaceContext({ type: 'set_active_run', run_id: null });
  }, [
    route.page,
    selection.routeMeta.surface,
    selection.routedConversationId,
    selection.routedReportId,
    selection.routedRunId,
    setTab,
    setEvidenceId,
    dispatchWorkspaceContext,
  ]);
  useEffect(() => {
    if (!selection.routedRunId) {
      loadedRouteRunId.current = undefined;
      return;
    }
    if (loadedRouteRunId.current === selection.routedRunId) return;
    loadedRouteRunId.current = selection.routedRunId;
    selectRun(selection.routedRunId, undefined, false);
  }, [selection.routedRunId, selectRun]);
  useEffect(() => {
    if (!selection.routedReportId) {
      loadedRouteReportId.current = undefined;
      return;
    }
    if (loadedRouteReportId.current === selection.routedReportId) return;
    loadedRouteReportId.current = selection.routedReportId;
    void openReport(selection.routedReportId, false);
  }, [openReport, selection.routedReportId]);
}
