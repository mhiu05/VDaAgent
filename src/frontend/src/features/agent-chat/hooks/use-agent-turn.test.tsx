// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deliverAgentTurn } from '../api/turn-delivery';
import { useAgentTurn } from './use-agent-turn';

vi.mock('../api/turn-delivery', () => ({ deliverAgentTurn: vi.fn() }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

it('submits the exact suggested text and recipient once across a rapid double click', async () => {
  let current: ReturnType<typeof useAgentTurn>;
  const deps = {
    orgId: '10000000-0000-4000-8000-000000000001',
    canWrite: true,
    sseEnabled: false,
    scheduledReadOnly: false,
    selectedConversationId: null,
    buildWorkspaceContext: () => ({ scope: { project_external_id: 'P-ALPHA', zone_external_id: null }, data_as_of: '2026-09-19' }),
    updateActiveRun: vi.fn(), setSelectedConversationId: vi.fn(), setRunMessageId: vi.fn(),
    setRunDetail: vi.fn(), setBundle: vi.fn(), setBrief: vi.fn(), setDecision: vi.fn(),
    setBriefStatus: vi.fn(), loadConversations: vi.fn(), loadMessages: vi.fn(),
    activateConversation: vi.fn(), setAcceptedJobId: vi.fn(), onAcceptedTurn: vi.fn(),
    setError: vi.fn(),
  } as unknown as Parameters<typeof useAgentTurn>[0];
  function Harness() { current = useAgentTurn(deps); return null; }
  await act(async () => root.render(<Harness />));
  let accept!: (value: Awaited<ReturnType<typeof deliverAgentTurn>>) => void;
  vi.mocked(deliverAgentTurn).mockImplementation(() => new Promise((resolve) => { accept = resolve; }));
  const question = 'Phân tích số căn đang mở bán trong phạm vi đang chọn.';
  await act(async () => {
    const first = current.submitPrompt(question, 'data');
    const second = current.submitPrompt(question, 'data');
    expect(deliverAgentTurn).toHaveBeenCalledOnce();
    expect(vi.mocked(deliverAgentTurn).mock.calls[0]?.[1]).toMatchObject({
      text: question, agent_target: 'data',
      scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
      data_as_of: '2026-09-19',
    });
    accept({ conversation_id: '20000000-0000-4000-8000-000000000001',
      run_id: null, assistant_message_id: '30000000-0000-4000-8000-000000000001' } as Awaited<ReturnType<typeof deliverAgentTurn>>);
    await Promise.all([first, second]);
  });
});
