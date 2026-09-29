// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverAgentTurn } from '../../src/frontend/features/agent-chat/api/turn-delivery';
import { useAgentTurn } from '../../src/frontend/features/agent-chat/hooks/use-agent-turn';

vi.mock('../../src/frontend/features/agent-chat/api/turn-delivery', () => ({
  deliverAgentTurn: vi.fn(),
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe('agent turn submission', () => {
  it('sends the selected suggested question and recipient once across rapid clicks', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const callbacks = {
      updateActiveRun: vi.fn(),
      setSelectedConversationId: vi.fn(),
      setRunMessageId: vi.fn(),
      setRunDetail: vi.fn(),
      setBundle: vi.fn(),
      setBrief: vi.fn(),
      setDecision: vi.fn(),
      setBriefStatus: vi.fn(),
      loadConversations: vi.fn(),
      loadMessages: vi.fn(),
      activateConversation: vi.fn(),
      setAcceptedJobId: vi.fn(),
      onAcceptedTurn: vi.fn(),
      setError: vi.fn(),
    };
    const dependencies = {
      orgId: '10000000-0000-4000-8000-000000000001',
      canWrite: true,
      sseEnabled: false,
      scheduledReadOnly: false,
      selectedConversationId: null,
      buildWorkspaceContext: () => ({
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
      }),
      ...callbacks,
    } as unknown as Parameters<typeof useAgentTurn>[0];
    let turn!: ReturnType<typeof useAgentTurn>;
    function Harness() {
      turn = useAgentTurn(dependencies);
      return null;
    }
    await act(async () => root!.render(<Harness />));
    let accept!: (value: Awaited<ReturnType<typeof deliverAgentTurn>>) => void;
    vi.mocked(deliverAgentTurn).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const question = 'Phân tích số căn đang mở bán trong phạm vi đang chọn.';
    await act(async () => {
      const first = turn.submitPrompt(question, 'data');
      const second = turn.submitPrompt(question, 'data');
      expect(deliverAgentTurn).toHaveBeenCalledOnce();
      expect(vi.mocked(deliverAgentTurn).mock.calls[0]?.[1]).toMatchObject({
        text: question,
        agent_target: 'data',
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
      });
      accept({
        conversation_id: '20000000-0000-4000-8000-000000000001',
        run_id: null,
        assistant_message_id: '30000000-0000-4000-8000-000000000001',
      } as Awaited<ReturnType<typeof deliverAgentTurn>>);
      await Promise.all([first, second]);
    });
  });
});
