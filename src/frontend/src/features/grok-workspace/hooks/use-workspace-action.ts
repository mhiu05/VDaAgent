import { useEffect, useRef, useState } from 'react';
import { WorkspaceActionV1Schema, type WorkspaceActionV1 } from '@vda/contracts';
import { rehydrateAction } from '../api/action-hydration';

export function useWorkspaceAction(
  orgId: string,
  workspaceRevision: number,
  onWorkspaceAction: (action: WorkspaceActionV1, expectedRevision: number) => void,
) {
  const [actionError, setActionError] = useState<string | null>(null);
  const actionRequestRef = useRef(0);
  const activeRevisionRef = useRef(workspaceRevision);
  useEffect(() => {
    activeRevisionRef.current = workspaceRevision;
  }, [workspaceRevision]);

  async function handleWorkspaceAction(candidate: WorkspaceActionV1) {
    setActionError(null);
    const requestAtStart = ++actionRequestRef.current;
    const revisionAtStart = activeRevisionRef.current;
    try {
      const action = WorkspaceActionV1Schema.parse(candidate);
      await rehydrateAction(orgId, action);
      if (
        actionRequestRef.current !== requestAtStart ||
        activeRevisionRef.current !== revisionAtStart
      )
        return;
      onWorkspaceAction(action, revisionAtStart);
      return true;
    } catch {
      if (
        actionRequestRef.current === requestAtStart &&
        activeRevisionRef.current === revisionAtStart
      )
        setActionError('The referenced workspace context is unavailable.');
      return false;
    }
  }

  return { actionError, handleWorkspaceAction };
}
