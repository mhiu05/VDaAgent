'use client';

import { createElement } from 'react';
import { ArrowUpRight, FileText, LoaderCircle, Reply } from 'lucide-react';
import type { Message, WorkspaceActionV1 } from '@vda/contracts';
import type { AgentTurnJobSnapshot } from './api/conversations';
import { agentIdentity } from '../../components/agents/agent-identity';
import { analysisErrorMessage } from '../../lib/format/analysis-error';
import { artifactKindLabel, workflowStatusLabel } from '../../lib/format/status-label';
import styles from './message-thread.module.css';

export function senderLabel(senderAgent: Message['sender_agent']): string {
  return agentIdentity(senderAgent)?.label ?? 'VDaAgent';
}

const legacyAgentNamePrefixes: Partial<Record<NonNullable<Message['sender_agent']>, readonly string[]>> = {
  coordinator: ['Tác nhân điều phối', 'Điều phối viên', 'Main Agent'],
  data: ['Tác nhân dữ liệu', 'Data Agent'],
  comparison: ['Tác nhân so sánh', 'Compare Agent'],
  chart: ['Tác nhân biểu đồ', 'Chart Agent'],
  analyst: ['Tác nhân phân tích', 'Analyst Agent'],
  insight: ['Tác nhân nhận định', 'Insight Agent'],
  report: ['Tác nhân báo cáo', 'Report Agent'],
  reviewer: ['Người rà soát', 'Reviewer'],
};

function displayedMessageContent(message: Message): string {
  if (message.role !== 'assistant' || !message.sender_agent) return message.content;
  const label = agentIdentity(message.sender_agent)?.label;
  const prefix = legacyAgentNamePrefixes[message.sender_agent]?.find((name) => message.content.startsWith(`${name} `));
  return label && prefix ? label + message.content.slice(prefix.length) : message.content;
}

const errorLabels: Record<string, string> = {
  ALL_AGENT_PROVIDERS_FAILED: 'Dịch vụ định tuyến hiện chưa sẵn sàng.',
  ANALYSIS_ACTION_FAILED: 'Không thể khởi tạo hoặc tải kết quả phân tích.',
  AGENT_EXECUTION_FAILED: 'Tác vụ nền gặp lỗi ngoài dự kiến. Xem mã lỗi an toàn trong tab Lượt chạy.',
  RUN_CANCELLED: 'Lượt phân tích đã bị hủy.',
};
const workspaceActionLabels: Record<WorkspaceActionV1['type'], string> = {
  open_dashboard: 'Mở tổng quan đã xác thực',
  open_drilldown: 'Mở phân tích chi tiết đã xác thực',
  focus_visual: 'Xem biểu đồ đã xác thực',
  focus_priority_entity: 'Xem đối tượng ưu tiên đã xác thực',
  open_evidence: 'Mở bằng chứng đã xác thực',
  switch_capability_mode: 'Đổi chế độ trợ lý',
};
const groundingLabels: Record<string, string> = { claim_ref: 'Nhận định có bằng chứng', metric_ref: 'Chỉ số có bằng chứng', evidence_ref: 'Bằng chứng liên quan', quality_ref: 'Giới hạn dữ liệu' };
const agentCardKinds: Record<string, string> = {
  coordinator: 'Điểm kiểm tra quy trình',
  data: 'Điểm kiểm tra chất lượng dữ liệu',
  comparison: 'Bằng chứng so sánh',
  chart: 'Hiện vật biểu đồ',
  analyst: 'Phân tích có bằng chứng',
  insight: 'Nhận định có căn cứ',
  report: 'Hiện vật báo cáo',
  reviewer: 'Tóm tắt xác thực',
};

export function MessageThread({
  messages,
  loading,
  hasEarlier,
  onLoadEarlier,
  onOpenRun,
  onOpenReport,
  onOpenArtifact,
  onWorkspaceAction,
  onReply,
  suggestions,
  onSuggestion,
  execution,
}: {
  messages: Message[];
  loading: boolean;
  hasEarlier: boolean;
  onLoadEarlier: () => void;
  onOpenRun: (runId: string, messageId: string) => void;
  onOpenReport: (reportId: string) => void;
  onOpenArtifact: (runId: string, artifactId: string) => void;
  onWorkspaceAction?: (action: WorkspaceActionV1) => void;
  onReply?: (messageId: string) => void;
  suggestions?: readonly string[];
  onSuggestion?: (text: string) => void;
  execution?: AgentTurnJobSnapshot | null;
}) {
  return (
    <section className="agent-thread" aria-label="Nội dung hội thoại">
      {hasEarlier && (
        <button className="text-button agent-load-earlier" onClick={onLoadEarlier}>
          Tải tin nhắn cũ hơn
        </button>
      )}
      {loading && !messages.length ? (
        <p className="empty-inline" role="status">
          Đang tải hội thoại…
        </p>
      ) : messages.length ? (
        messages.map((message) => {
          const identity =
            message.role === 'assistant' ? agentIdentity(message.sender_agent) : null;
          const AgentIcon = identity?.icon;
          const terminalJob = execution?.job.assistant_message_id === message.message_id &&
            execution.job.conversation_id === message.conversation_id &&
            ['failed', 'cancelled', 'completed'].includes(execution.job.status) ? execution.job : null;
          return (
            <article
              className={`agent-message agent-message-${message.role} ${styles.message} ${identity ? styles[identity.accent] : styles.user}`}
              data-agent={message.sender_agent ?? undefined}
              key={message.message_id}
            >
              <span className="agent-message-role">
                {message.role === 'user' ? 'Bạn' : senderLabel(message.sender_agent)}
              </span>
              {identity && (
                <div className={styles.structuredMeta}>
                  {AgentIcon && <AgentIcon aria-hidden={true} size={15} />}
                  <span>{identity.description}</span>
                  <span className={styles.cardKind}>
                    {agentCardKinds[identity.accent] ?? 'Cập nhật quy trình đã lưu'}
                  </span>
                </div>
              )}
              <p>{displayedMessageContent(message)}</p>
              {Boolean(message.context_refs?.length) && <div className={styles.contextRefs} aria-label="Ngữ cảnh đính kèm">
                {message.context_refs!.map((ref) => <span key={`${ref.type}:${ref.id}`} title={ref.id}>{ref.type} · {ref.id.slice(0, 8)}</span>)}
              </div>}
              {message.report_intent === 'new' && <small className={styles.contextRefs}>Đã yêu cầu báo cáo mới</small>}
              {message.reply_to_message_id && <small className={styles.contextRefs} title={message.reply_to_message_id}>Trả lời tin nhắn · {message.reply_to_message_id.slice(0, 8)}</small>}
              {onReply && message.parts.some((part) => part.type === 'report_ref' || part.type === 'artifact_ref') && <button type="button" className="text-button" onClick={() => onReply(message.message_id)} aria-label="Trả lời với bằng chứng của tin nhắn này"><Reply size={13} /> Trả lời</button>}
              {message.status === 'in_progress' && message.role === 'assistant' && !terminalJob && (
                <span className="agent-pending">
                  <LoaderCircle size={13} className="spin" /> Đang chuẩn bị kết quả có bằng chứng…
                </span>
              )}
              {message.status === 'in_progress' && terminalJob && <span role="status">
                {terminalJob.status === 'failed' ? 'Tác vụ đã dừng do lỗi. Bạn có thể gửi lại yêu cầu để bắt đầu lượt mới.'
                  : terminalJob.status === 'cancelled' ? 'Tác vụ đã được hủy.'
                  : 'Tác vụ đã hoàn tất. Đang đồng bộ câu trả lời đã lưu; tải lại trang nếu chưa thấy kết quả.'}
              </span>}
              {message.parts.map((part, index) => {
                if (part.type === 'run_ref')
                  return (
                    <button
                      className="text-button agent-part-link"
                      key={`${message.message_id}:run:${index}`}
                      onClick={() => onOpenRun(part.run_id, message.message_id)}
                    >
                      Lượt phân tích · {workflowStatusLabel(part.status)} <ArrowUpRight size={13} />
                    </button>
                  );
                if (part.type === 'report_ref')
                  return (
                    <button
                      className="text-button agent-reference"
                      key={`${message.message_id}:report:${index}`}
                      onClick={() =>
                        onWorkspaceAction
                          ? onWorkspaceAction({
                              type: 'open_dashboard',
                              run_id: part.run_id,
                              report_id: part.report_id,
                            })
                          : onOpenReport(part.report_id)
                      }
                    >
                      <FileText size={13} /> Báo cáo đã liên kết
                    </button>
                  );
                if (part.type === 'artifact_ref')
                  return createElement(
                    'button',
                    {
                      className: 'text-button agent-reference',
                      key: [message.message_id, 'artifact', index].join(':'),
                      onClick: () =>
                        onWorkspaceAction
                          ? onWorkspaceAction({
                              type: 'open_evidence',
                              run_id: part.run_id,
                              artifact_id: part.artifact_id,
                              evidence_path: null,
                            })
                          : onOpenArtifact(part.run_id, part.artifact_id),
                    },
                    createElement(FileText, { size: 13 }),
                    ' Bằng chứng · ',
                    artifactKindLabel(part.kind),
                    ' ',
                    createElement(ArrowUpRight, { size: 13 }),
                  );
                if (part.type === 'signal_ref')
                  return (
                    <button
                      className="text-button agent-reference"
                      key={`${message.message_id}:signal:${index}`}
                      onClick={() => onOpenRun(part.run_id, message.message_id)}
                    >
                      Tín hiệu đã xác thực <ArrowUpRight size={13} />
                    </button>
                  );
                if (part.type === 'decision_ref')
                  return (
                    <button
                      className="text-button agent-reference"
                      key={`${message.message_id}:decision:${index}`}
                      onClick={() =>
                        onWorkspaceAction
                          ? onWorkspaceAction({
                              type: 'open_dashboard',
                              run_id: part.run_id,
                              report_id: null,
                            })
                          : onOpenRun(part.run_id, message.message_id)
                      }
                    >
                      Kết quả hỗ trợ quyết định <ArrowUpRight size={13} />
                    </button>
                  );
                if (part.type === 'drilldown_ref')
                  return (
                    <button
                      className="text-button agent-reference"
                      key={`${message.message_id}:drilldown:${index}`}
                      onClick={() =>
                        onWorkspaceAction
                          ? onWorkspaceAction({
                              type: 'open_drilldown',
                              run_id: part.run_id,
                              drilldown_id: part.drilldown_id,
                            })
                          : onOpenRun(part.run_id, message.message_id)
                      }
                    >
                      Phân tích chi tiết đã xác thực <ArrowUpRight size={13} />
                    </button>
                  );
                if (
                  part.type === 'claim_ref' ||
                  part.type === 'metric_ref' ||
                  part.type === 'evidence_ref' ||
                  part.type === 'quality_ref'
                )
                  return (
                    <span
                      className="agent-reference"
                      key={`${message.message_id}:${part.type}:${index}`}
                    >
                      {groundingLabels[part.type]}
                    </span>
                  );
                if (part.type === 'workspace_action' && onWorkspaceAction)
                  return (
                    <button
                      className="text-button agent-reference"
                      key={message.message_id + ':action:' + index}
                      onClick={() => onWorkspaceAction(part.action)}
                    >
                      {workspaceActionLabels[part.action.type]} <ArrowUpRight size={13} />
                    </button>
                  );
                if (part.type === 'workspace_action')
                  return (
                    <span className="agent-reference" key={`${message.message_id}:action:${index}`}>
                      Gợi ý thao tác trong không gian làm việc
                    </span>
                  );
                if (part.type === 'error')
                  return (
                    <p
                      className="agent-message-error"
                      key={`${message.message_id}:error:${index}`}
                      role="status"
                    >
                      {analysisErrorMessage(part.code) ?? errorLabels[part.code] ?? 'Không thể hoàn tất yêu cầu này.'}
                    </p>
                  );
                return null;
              })}
            </article>
          );
        })
      ) : (
        <div className="agent-empty-thread">
          <h2>Bắt đầu với một câu hỏi</h2>
          <p>Kết quả sẽ dựa trên dữ liệu và bằng chứng đã được kiểm tra.</p>
          {Boolean(suggestions?.length && onSuggestion) && <div className={styles.emptySuggestions} aria-label="Câu hỏi gợi ý cho tác nhân đang chọn">
            {suggestions?.map((question) => <button key={question} type="button" className={styles.emptySuggestion} onClick={() => onSuggestion?.(question)}>{question}</button>)}
          </div>}
        </div>
      )}
    </section>
  );
}
