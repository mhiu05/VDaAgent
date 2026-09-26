import type { AgentDefinition, RuntimeActivity } from '@vda/contracts';
import { ArrowRight } from 'lucide-react';
import { agentName } from '../../agent-chat/agent-workspace-model';
import styles from './grok-workspace.module.css';

export function RuntimeConversation({ records, agents, onEvidence }: {
  records: RuntimeActivity[];
  agents: AgentDefinition[];
  onEvidence: (id: string) => void;
}) {
  const messages = records.filter((record) => record.kind === 'message' && record.message_type !== 'status');
  if (!messages.length) return null;
  return <section className={styles.collaboration} aria-label="Agent collaboration" aria-live="polite">
    <h2>Agent collaboration</h2>
    <ol>{messages.map((record) => <li key={record.activity_id} data-status={record.status}>
      <div><strong>{agentName(record.agent_key, agents)}</strong>{record.target_agent_key && <><ArrowRight size={13} aria-label="to" /><strong>{agentName(record.target_agent_key, agents)}</strong></>}<span>{record.message_type?.replaceAll('_', ' ')}</span></div>
      <p>{record.summary}</p>
      {Boolean(record.artifact_refs?.length) && <details><summary>{record.artifact_refs!.length} evidence artifacts</summary><div>{record.artifact_refs!.map((id) => <button type="button" className="text-button" key={id} onClick={() => onEvidence(id)}>View evidence · {id.slice(0, 8)}</button>)}</div></details>}
    </li>)}</ol>
  </section>;
}
