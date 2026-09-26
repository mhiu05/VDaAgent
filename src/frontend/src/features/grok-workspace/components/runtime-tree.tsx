import type { AgentDefinition, RuntimeActivity } from '@vda/contracts';
import { agentName, buildRuntimeTree, type RuntimeTreeNode } from '../../agent-chat/agent-workspace-model';
import styles from './grok-workspace.module.css';

function Node({ node, agents }: { node: RuntimeTreeNode; agents: AgentDefinition[] }) {
  const { record } = node;
  return <li data-status={record.status} data-runtime-id={record.activity_id}>
    <details open={record.kind === 'invocation'}>
      <summary><span className={styles.runtimeDot} data-status={record.status} /><strong>{record.kind === 'tool' ? record.tool_name : agentName(record.agent_key, agents)}</strong><span>{record.status}</span></summary>
      <p>{record.summary}</p>
      {record.input_summary && <p className={styles.runtimeInput}>{record.input_summary}</p>}
      {record.error_code && <p role="status">{record.error_code}</p>}
      {record.duration_ms !== undefined && <small>{(record.duration_ms / 1000).toFixed(1)}s</small>}
      {(record.context_tokens !== undefined || record.context_build_ms !== undefined) && <details className={styles.contextMetrics}>
        <summary>Context budget</summary>
        {record.context_tokens !== undefined && <p>{record.context_tokens.toLocaleString()} estimated tokens</p>}
        {record.context_build_ms !== undefined && <p>{record.context_build_ms} ms to build context</p>}
      </details>}
      {record.evidence_refs?.length ? <p>{record.evidence_refs.length} evidence references</p> : null}
      {node.children.length > 0 && <ul>{node.children.map((child) => <Node key={child.record.activity_id} node={child} agents={agents} />)}</ul>}
    </details>
  </li>;
}

export function RuntimeTree({ records, agents }: { records: RuntimeActivity[]; agents: AgentDefinition[] }) {
  const tree = buildRuntimeTree(records);
  return tree.length ? <ul className={styles.runtimeTree} aria-label="Agent invocations and tools">{tree.map((node) => <Node key={node.record.activity_id} node={node} agents={agents} />)}</ul> : null;
}
