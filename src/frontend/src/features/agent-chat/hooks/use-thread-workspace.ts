import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentDefinition, ImportManifest, MemoryEntry, ReportRecord, ThreadContext } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listReports } from '../../reports/api/reports';
import { listImports } from '../../imports/api/imports';
import { getThreadContext, getThreadMemory, listAgentDefinitions, putThreadContext } from '../api/runtime';

export const emptyThreadContext: ThreadContext = { dataset_ids: [], active_artifact_id: null, active_report_id: null, current_run_id: null, referenced_artifact_ids: [] };

export function useThreadWorkspace(orgId: string, conversationId: string | null, runStatus?: string) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [context, setContext] = useState<ThreadContext>(emptyThreadContext);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [datasets, setDatasets] = useState<ImportManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = useRef(`${orgId}:${conversationId}`);
  const contextRevision = useRef(0);
  selected.current = `${orgId}:${conversationId}`;
  useEffect(() => {
    let disposed = false;
    setAgents([]);
    setDatasets([]);
    void Promise.allSettled([listAgentDefinitions(orgId), listImports(orgId)]).then(([agentResult, datasetResult]) => {
      if (disposed) return;
      if (agentResult.status === 'fulfilled') setAgents(agentResult.value.agents);
      else setError(errorMessage(agentResult.reason));
      if (datasetResult.status === 'fulfilled') setDatasets(datasetResult.value.imports);
      else setError(errorMessage(datasetResult.reason));
    });
    return () => { disposed = true; };
  }, [orgId]);
  useEffect(() => {
    setContext(emptyThreadContext);
    setMemory([]);
    setReports([]);
    setError(null);
    setSaving(false);
    contextRevision.current += 1;
  }, [orgId, conversationId]);
  useEffect(() => {
    let disposed = false;
    const revision = contextRevision.current;
    if (!conversationId) return;
    void Promise.allSettled([getThreadContext(orgId, conversationId), getThreadMemory(orgId, conversationId), listReports(orgId)]).then(([contextResult, memoryResult, reportsResult]) => {
      if (disposed) return;
      if (contextResult.status === 'fulfilled' && contextRevision.current === revision) setContext(contextResult.value);
      else if (contextResult.status === 'rejected') setError(errorMessage(contextResult.reason));
      if (memoryResult.status === 'fulfilled') setMemory(memoryResult.value.items);
      if (reportsResult.status === 'fulfilled') setReports(reportsResult.value.reports);
    });
    return () => { disposed = true; };
  }, [orgId, conversationId, runStatus]);
  const update = useCallback(async (patch: Partial<ThreadContext>) => {
    const next = { ...context, ...patch };
    const identity = `${orgId}:${conversationId}`;
    contextRevision.current += 1;
    if (!conversationId) { setContext(next); return; }
    setSaving(true);
    try {
      const persisted = await putThreadContext(orgId, conversationId, next);
      if (selected.current === identity) { setContext(persisted); setError(null); }
    } catch (cause) { if (selected.current === identity) setError(errorMessage(cause)); }
    finally { if (selected.current === identity) setSaving(false); }
  }, [orgId, conversationId, context]);
  return { agents, context, update, memory, reports, datasets, error, saving };
}
