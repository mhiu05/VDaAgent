import type { AgentActivityEventV1 } from '@vda/contracts';

const labels: Record<AgentActivityEventV1['label'], string> = {
  understanding_context: 'Đang nắm phạm vi dữ liệu được phép truy cập',
  inspecting_context: 'Đang rà soát ngữ cảnh workspace',
  starting_analysis: 'Đang bắt đầu phân tích',
  analysis_queued: 'Phân tích đang chờ xử lý',
  analysis_progress: 'Tiến độ có trong màn hình chi tiết lượt chạy',
  preparing_answer: 'Đang chuẩn bị câu trả lời có căn cứ',
  answer_ready: 'Câu trả lời có căn cứ đã sẵn sàng',
  safe_error: 'Trợ lý đã kết thúc với trạng thái an toàn',
};

export function ActivityTimeline({ events }: { events: AgentActivityEventV1[] }) {
  if (!events.length) return null;
  return (
    <section
      className="notice agent-activity-timeline"
      aria-label="Hoạt động của trợ lý"
      aria-live="polite"
    >
      <strong>Hoạt động của trợ lý</strong>
      {events.map((event) => (
        <div className="agent-pending" key={event.sequence}>
          <span className="agent-status-dot in_progress" aria-hidden="true" />
          {labels[event.label]}
        </div>
      ))}
    </section>
  );
}
