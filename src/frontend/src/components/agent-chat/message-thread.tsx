'use client';

import { ArrowUpRight, FileText, LoaderCircle } from 'lucide-react';
import type { Message } from '@vda/contracts';

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
}: {
  messages: Message[];
  loading: boolean;
  hasEarlier: boolean;
  onLoadEarlier: () => void;
  onOpenRun: (runId: string, messageId: string) => void;
  onOpenReport: (reportId: string) => void;
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
              {message.role === 'user' ? 'Bạn' : 'VDaAgent'}
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
