import type { AgentDefinition, AgentKey, RuntimeActivity } from '@vda/contracts';
import { agentIdentity } from '../../../components/agents/agent-identity';
import { ArrowRight } from 'lucide-react';
import { agentName, canonicalAgentKey } from '../../agent-chat/agent-workspace-model';
import styles from './agent-workspace.module.css';

function Participant({ agentKey, agents }: { agentKey: string; agents: AgentDefinition[] }) {
  const identity = agentIdentity(canonicalAgentKey(agentKey) as AgentKey);
  const Icon = identity?.icon;
  return (
    <strong>
      {Icon && <Icon size={15} aria-hidden={true} />}
      {identity?.label ?? agentName(agentKey, agents)}
    </strong>
  );
}

export function RuntimeConversation({
  records,
  agents,
  onEvidence,
}: {
  records: RuntimeActivity[];
  agents: AgentDefinition[];
  onEvidence: (id: string) => void;
}) {
  const messages = records.filter(
    (record) => record.kind === 'message' && record.message_type !== 'status',
  );
  if (!messages.length) return null;
  return (
    <section
      className={styles.collaboration}
      aria-label="Phối hợp giữa các tác nhân"
      aria-live="polite"
    >
      <h2>Phối hợp giữa các tác nhân</h2>
      <ol>
        {messages.map((record) => (
          <li key={record.activity_id} data-status={record.status}>
            <div>
              <Participant agentKey={record.agent_key} agents={agents} />
              {record.target_agent_key && (
                <>
                  <ArrowRight size={13} aria-label="đến" />
                  <Participant agentKey={record.target_agent_key} agents={agents} />
                </>
              )}
              <span>
                {record.message_type === 'task_request'
                  ? 'Yêu cầu'
                  : record.message_type === 'task_result'
                    ? 'Kết quả'
                    : 'Cập nhật'}
              </span>
            </div>
            <p>{record.summary}</p>
            {Boolean(record.artifact_refs?.length) && (
              <details>
                <summary>{record.artifact_refs!.length} bằng chứng</summary>
                <div>
                  {record.artifact_refs!.map((id) => (
                    <button
                      type="button"
                      className="text-button"
                      key={id}
                      onClick={() => onEvidence(id)}
                    >
                      Xem bằng chứng · {id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
