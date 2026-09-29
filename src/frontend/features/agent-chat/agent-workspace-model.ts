import type { AgentDefinition, AgentKey, ReportRecord, RuntimeActivity, WorkspaceContextV1 } from '@vda/contracts';

/** The message's selected report owns its context root; the inspector is independent. */
export function withThreadReportContext(snapshot: WorkspaceContextV1, report: Pick<ReportRecord, 'run_id' | 'report_id' | 'artifact_id'> | undefined): WorkspaceContextV1 {
  const sameRun = !report || snapshot.active_run_ref?.run_id === report.run_id;
  return { ...snapshot,
    active_run_ref: report ? { run_id: report.run_id } : snapshot.active_run_ref,
    active_report_ref: report ? { run_id: report.run_id, report_id: report.report_id } : null,
    active_artifact_ref: report ? { run_id: report.run_id, artifact_id: report.artifact_id } : null,
    dashboard_selection: sameRun ? snapshot.dashboard_selection : null,
    drilldown: sameRun ? snapshot.drilldown : null,
    evidence_ref: null,
  };
}

/** Old durable jobs use persona keys; recipient keys remain the public contract. */
export function canonicalAgentKey(key: string): string {
  return key === 'orchestrator' || key === 'main' ? 'coordinator' : key === 'compare' ? 'comparison' : key;
}

export function recipientKey(agent: AgentDefinition): AgentKey | null {
  return agent.id === 'coordinator' ? null : agent.id as AgentKey;
}

export function agentName(key: string, agents: AgentDefinition[]): string {
  return agents.find((agent) => agent.id === canonicalAgentKey(key))?.name ?? key;
}

export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([\p{L}\d_-]*)$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() } : null;
}

export function mentionAlias(agent: AgentDefinition): string {
  return agent.id === 'coordinator' ? 'Main' : agent.id === 'comparison' ? 'Compare' : agent.id[0]!.toUpperCase() + agent.id.slice(1);
}

export function matchingAgents(agents: AgentDefinition[], query: string): AgentDefinition[] {
  return agents.filter((agent) => `${mentionAlias(agent)} ${agent.name} ${agent.id}`.toLowerCase().includes(query.toLowerCase()));
}

export type RuntimeTreeNode = { record: RuntimeActivity; children: RuntimeTreeNode[] };

/** Missing parents and malformed cycles remain visible, without recursive loops. */
export function buildRuntimeTree(records: RuntimeActivity[]): RuntimeTreeNode[] {
  const nodes = records.filter((record) => record.kind !== 'message').map((record) => ({ record, children: [] as RuntimeTreeNode[] }));
  const byStep = new Map(nodes.map((node) => [node.record.step_key, node]));
  const roots: RuntimeTreeNode[] = [];
  for (const node of nodes) {
    const seen = new Set([node.record.step_key]);
    let ancestor = node.record.parent_step_key;
    let cyclic = false;
    while (ancestor && byStep.has(ancestor)) {
      if (seen.has(ancestor)) { cyclic = true; break; }
      seen.add(ancestor);
      ancestor = byStep.get(ancestor)?.record.parent_step_key;
    }
    const parent = node.record.parent_step_key ? byStep.get(node.record.parent_step_key) : undefined;
    if (parent && !cyclic) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function agentRuntimeStatus(key: string, records: RuntimeActivity[]): string {
  const invocations = records.filter((record) => record.kind === 'invocation' && canonicalAgentKey(record.agent_key) === canonicalAgentKey(key));
  for (const state of ['running', 'waiting', 'queued', 'failed', 'cancelled'])
    if (invocations.some((record) => record.status === state)) return state;
  return invocations.length ? invocations[invocations.length - 1]!.status ?? 'idle' : 'idle';
}
