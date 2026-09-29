import type { AgentDefinition, AgentKey, RuntimeActivity } from '@vda/contracts';
import { agentIdentity } from '../../../components/agents/agent-identity';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import {
  agentName,
  buildRuntimeTree,
  canonicalAgentKey,
  type RuntimeTreeNode,
} from '../../agent-chat/agent-workspace-model';
import styles from './agent-workspace.module.css';

function Node({ node, agents }: { node: RuntimeTreeNode; agents: AgentDefinition[] }) {
  const { record } = node;
  const identity =
    record.kind === 'invocation'
      ? agentIdentity(canonicalAgentKey(record.agent_key) as AgentKey)
      : null;
  const AgentIcon = identity?.icon;
  return (
    <li data-status={record.status} data-runtime-id={record.activity_id}>
      <details open={record.kind === 'invocation'}>
        <summary>
          <span className={styles.runtimeDot} data-status={record.status} />
          {AgentIcon && <AgentIcon size={15} aria-hidden={true} />}
          <strong>
            {record.kind === 'tool'
              ? record.tool_name
              : (identity?.label ?? agentName(record.agent_key, agents))}
          </strong>
          <span>{workflowStatusLabel(record.status ?? 'queued')}</span>
        </summary>
        <p>{record.summary}</p>
        {record.input_summary && <p className={styles.runtimeInput}>{record.input_summary}</p>}
        {record.error_code && <p role="status">{record.error_code}</p>}
        {record.duration_ms !== undefined && (
          <small>{(record.duration_ms / 1000).toFixed(1)}s</small>
        )}
        {(record.context_tokens !== undefined || record.context_build_ms !== undefined) && (
          <details className={styles.contextMetrics}>
            <summary>Ngữ cảnh xử lý</summary>
            {record.context_tokens !== undefined && (
              <p>{record.context_tokens.toLocaleString()} token ước tính</p>
            )}
            {record.context_build_ms !== undefined && (
              <p>{record.context_build_ms} ms để chuẩn bị ngữ cảnh</p>
            )}
          </details>
        )}
        {record.evidence_refs?.length ? (
          <p>{record.evidence_refs.length} tham chiếu bằng chứng</p>
        ) : null}
        {node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <Node key={child.record.activity_id} node={child} agents={agents} />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export function RuntimeTree({
  records,
  agents,
}: {
  records: RuntimeActivity[];
  agents: AgentDefinition[];
}) {
  const tree = buildRuntimeTree(records);
  return tree.length ? (
    <ul className={styles.runtimeTree} aria-label="Các tác nhân và công cụ đang thực thi">
      {tree.map((node) => (
        <Node key={node.record.activity_id} node={node} agents={agents} />
      ))}
    </ul>
  ) : null;
}
