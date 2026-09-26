import { describe, expect, it } from 'vitest';
import { AgentDefinitionSchema, RuntimeActivityRecordSchema } from '@vda/contracts';
import { agentRuntimeStatus, buildRuntimeTree, matchingAgents, mentionQuery, recipientKey } from './agent-workspace-model';
import { withThreadReportContext } from './agent-workspace-model';
import { initialWorkspaceContextState, toWorkspaceContext } from '../workspace/context';

const definition = (id: string, name: string) => AgentDefinitionSchema.parse({ id, name, role: id, description: `${name} description`, instructions: '', allowed_tools: [], capabilities: [], avatar: { initials: id.slice(0, 2), color: 'blue' } });
const agents = [definition('coordinator', 'Main Agent'), definition('data', 'Data Agent'), definition('comparison', 'Compare Agent')];
const record = (step: string, parent?: string, agent = 'data', status = 'completed', kind = 'invocation') => RuntimeActivityRecordSchema.parse({
  activity_id: crypto.randomUUID(), org_id: crypto.randomUUID(), run_id: crypto.randomUUID(), conversation_id: null,
  step_key: step, parent_step_key: parent, agent_key: agent, status, kind, summary: step,
  created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z',
});

describe('agent workspace model', () => {
  it('roots message context in the selected report while preserving the independent inspector snapshot', () => {
    const inspectedRun = '10000000-0000-4000-8000-000000000001';
    const selectedRun = '10000000-0000-4000-8000-000000000002';
    const snapshot = toWorkspaceContext({ ...initialWorkspaceContextState, active_run_id: inspectedRun }, {
      org_id: '10000000-0000-4000-8000-000000000003', conversation_id: null,
      mode: 'agent_chat', scope: { project_external_id: 'p', zone_external_id: null }, data_as_of: '2026-09-26',
    });
    snapshot.dashboard_selection = { chart_ref: { run_id: inspectedRun, chart_id: 'chart-a' }, priority_entity_ref: null };
    const report = { run_id: selectedRun, report_id: '10000000-0000-4000-8000-000000000004', artifact_id: '10000000-0000-4000-8000-000000000005' };
    const message = withThreadReportContext(snapshot, report);
    expect(message.active_run_ref?.run_id).toBe(selectedRun);
    expect(message.active_report_ref?.run_id).toBe(selectedRun);
    expect(message.active_artifact_ref?.run_id).toBe(selectedRun);
    expect(message.dashboard_selection).toBeNull();
    expect(snapshot.active_run_ref?.run_id).toBe(inspectedRun);
    expect(withThreadReportContext(snapshot, undefined).active_report_ref).toBeNull();
  });
  it('routes registry mentions to the existing recipient contract', () => {
    expect(recipientKey(agents[0]!)).toBeNull();
    expect(recipientKey(agents[2]!)).toBe('comparison');
    expect(matchingAgents(agents, 'compare')).toEqual([agents[2]]);
    expect(mentionQuery('Please @Com', 11)).toEqual({ start: 7, query: 'com' });
    expect(mentionQuery('person@example.com', 18)).toBeNull();
  });
  it('retains simultaneous running agents and pending dependencies', () => {
    const records = [record('data', 'root', 'data', 'running'), record('compare', 'root', 'comparison', 'running'), record('insight', 'root', 'insight', 'waiting')];
    expect(agentRuntimeStatus('data', records)).toBe('running');
    expect(agentRuntimeStatus('compare', records)).toBe('running');
    expect(agentRuntimeStatus('insight', records)).toBe('waiting');
    expect(agentRuntimeStatus('report', records)).toBe('idle');
  });
  it('builds nested child invocations and tools without duplicating message events', () => {
    const root = record('root');
    const child = record('insight', 'root', 'insight');
    const data = record('breakdown', 'insight');
    const tool = record('query', 'breakdown', 'data', 'completed', 'tool');
    const message = record('request', 'insight', 'insight', 'completed', 'message');
    const tree = buildRuntimeTree([root, child, data, tool, message]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.children[0]!.record).toEqual(tool);
  });
  it('keeps orphan records visible and prevents malformed parent cycles', () => {
    const tree = buildRuntimeTree([record('a', 'b'), record('b', 'a'), record('orphan', 'missing')]);
    expect(tree).toHaveLength(3);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });
});
