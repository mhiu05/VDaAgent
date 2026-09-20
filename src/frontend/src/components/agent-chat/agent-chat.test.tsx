import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Message } from '@vda/contracts';
import { MessageThread } from './message-thread';
import { taskLabel } from './run-progress';

const message: Message = {
  message_id: '80000000-0000-4000-8000-000000000001',
  org_id: '10000000-0000-4000-8000-000000000001',
  conversation_id: '81000000-0000-4000-8000-000000000001',
  run_id: '82000000-0000-4000-8000-000000000001',
  client_turn_id: '83000000-0000-4000-8000-000000000001',
  role: 'assistant',
  status: 'failed',
  content: '<script>unsafe()</script>',
  parts: [
    { type: 'run_ref', run_id: '82000000-0000-4000-8000-000000000001', status: 'failed' },
    {
      type: 'report_ref',
      run_id: '82000000-0000-4000-8000-000000000001',
      report_id: '84000000-0000-4000-8000-000000000001',
    },
    { type: 'error', code: 'ANALYSIS_ACTION_FAILED', retryable: true },
  ],
  created_at: '2026-09-20T00:00:00.000Z',
  updated_at: '2026-09-20T00:00:00.000Z',
};

describe('Agent Chat message presentation', () => {
  it('renders typed run/error parts and escapes message text', () => {
    const output = renderToStaticMarkup(
      <MessageThread
        messages={[message]}
        loading={false}
        hasEarlier={false}
        onLoadEarlier={() => undefined}
        onOpenRun={() => undefined}
        onOpenReport={() => undefined}
      />,
    );
    expect(output).toContain('Lượt phân tích · failed');
    expect(output).toContain('Báo cáo đã liên kết');
    expect(output).toContain('Không thể khởi tạo hoặc tải kết quả phân tích.');
    expect(output).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(output).not.toContain('<script>unsafe()</script>');
  });

  it('maps only known task states to display labels', () => {
    expect(taskLabel('calculation')).toBe('Tính chỉ số');
    expect(taskLabel('untrusted-task')).toBe('Đang xử lý');
  });
});
