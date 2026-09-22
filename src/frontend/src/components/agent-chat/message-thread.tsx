'use client';

import { createElement } from 'react';
import { ArrowUpRight, FileText, LoaderCircle } from 'lucide-react';
import type { Message } from '@vda/contracts';

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

export function MessageThread({
  messages,
  loading,
  hasEarlier,
  onLoadEarlier,
  onOpenRun,
  onOpenReport,
  onOpenArtifact,
}: {
  messages: Message[];
  loading: boolean;
  hasEarlier: boolean;
  onLoadEarlier: () => void;
  onOpenRun: (runId: string, messageId: string) => void;
  onOpenReport: (reportId: string) => void;
  onOpenArtifact: (runId: string, artifactId: string) => void;
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
                    onClick={() => onOpenReport(part.report_id)}
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
                    onClick: () => onOpenArtifact(part.run_id, part.artifact_id),
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
                    onClick={() => onOpenRun(part.run_id, message.message_id)}
                  >
                    Decision intelligence <ArrowUpRight size={13} />
                  </button>
                );
              if (part.type === 'drilldown_ref')
                return (
                  <button
                    className='text-button agent-reference'
                    key={`${message.message_id}:drilldown:${index}`}
                    onClick={() => onOpenRun(part.run_id, message.message_id)}
                  >
                    Validated drill-down <ArrowUpRight size={13} />
                  </button>
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
