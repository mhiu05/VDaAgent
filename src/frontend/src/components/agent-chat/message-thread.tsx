'use client';

import { createElement } from 'react';
import { ArrowUpRight, FileText, LoaderCircle } from 'lucide-react';
import type { Message, WorkspaceActionV1 } from '@vda/contracts';

const senderLabels: Record<NonNullable<Message['sender_agent']>, string> = {
  coordinator: 'Coordinator',
  data: 'Data',
  comparison: 'Comparison',
  chart: 'Chart',
  analyst: 'Analyst',
  insight: 'Insight',
  report: 'Report',
  reviewer: 'Reviewer',
};

export function senderLabel(senderAgent: Message['sender_agent']): string {
  return senderAgent ? senderLabels[senderAgent] : 'VDaAgent';
}

const errorLabels: Record<string, string> = {
  ALL_AGENT_PROVIDERS_FAILED: 'Dịch vụ định tuyến hiện chưa sẵn sàng.',
  ANALYSIS_ACTION_FAILED: 'Không thể khởi tạo hoặc tải kết quả phân tích.',
  RUN_CANCELLED: 'Lượt phân tích đã bị hủy.',
};
const workspaceActionLabels: Record<WorkspaceActionV1['type'], string> = {
  open_dashboard: 'Open authorized dashboard',
  open_drilldown: 'Open authorized drill-down',
  focus_visual: 'Focus authorized chart',
  focus_priority_entity: 'Focus authorized priority',
  open_evidence: 'Open authorized evidence',
  switch_capability_mode: 'Switch workspace capability',
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
}: {
  messages: Message[];
  loading: boolean;
  hasEarlier: boolean;
  onLoadEarlier: () => void;
  onOpenRun: (runId: string, messageId: string) => void;
  onOpenReport: (reportId: string) => void;
  onOpenArtifact: (runId: string, artifactId: string) => void;
  onWorkspaceAction?: (action: WorkspaceActionV1) => void;
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
        messages.map((message) => (
          <article
            className={`agent-message agent-message-${message.role}`}
            key={message.message_id}
          >
            <span className="agent-message-role">
              {message.role === 'user' ? 'Bạn' : senderLabel(message.sender_agent)}
            </span>
            <p>{message.content}</p>
            {message.status === 'in_progress' && message.role === 'assistant' && (
              <span className="agent-pending">
                <LoaderCircle size={13} className="spin" /> Đang chuẩn bị kết quả có bằng chứng…
              </span>
            )}
            {message.parts.map((part, index) => {
              if (part.type === 'run_ref')
                return (
                  <button
                    className="text-button agent-part-link"
                    key={`${message.message_id}:run:${index}`}
                    onClick={() => onOpenRun(part.run_id, message.message_id)}
                  >
                    Lượt phân tích · {part.status} <ArrowUpRight size={13} />
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
                  part.kind,
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
                    Validated signal <ArrowUpRight size={13} />
                  </button>
                );
              if (part.type === 'decision_ref')
                return (
                  <button
                    className='text-button agent-reference'
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
                    Decision intelligence <ArrowUpRight size={13} />
                  </button>
                );
              if (part.type === 'drilldown_ref')
                return (
                  <button
                    className='text-button agent-reference'
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
                    Validated drill-down <ArrowUpRight size={13} />
                  </button>
                );
              if (
                part.type === 'claim_ref' ||
                part.type === 'metric_ref' ||
                part.type === 'evidence_ref' ||
                part.type === 'quality_ref'
              )
                return (
                  <span className='agent-reference' key={`${message.message_id}:${part.type}:${index}`}>
                    Grounded {part.type.replace('_ref', '').replace('_', ' ')}
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
                  <span className='agent-reference' key={`${message.message_id}:action:${index}`}>
                    Suggested workspace action
                  </span>
                );
              if (part.type === 'error')
                return (
                  <p
                    className="agent-message-error"
                    key={`${message.message_id}:error:${index}`}
                    role="status"
                  >
                    {errorLabels[part.code] ?? 'Không thể hoàn tất yêu cầu này.'}
                  </p>
                );
              return null;
            })}
          </article>
        ))
      ) : (
        <div className="agent-empty-thread">
          <h2>Bắt đầu với một câu hỏi</h2>
          <p>Kết quả sẽ luôn lấy từ semantic engine, artifacts và bằng chứng đã được kiểm tra.</p>
        </div>
      )}
    </section>
  );
}
