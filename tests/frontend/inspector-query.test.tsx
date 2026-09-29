// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceInspector } from '../../src/frontend/features/agent-workspace/components/workspace-inspector';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

describe('inspector query metadata', () => {
  it('shows persisted usage after Insight failure and keeps missing metadata unknown', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const identity = { org_id: 'org', run_id: 'run' };
    const controller = {
      currentRunDetail: {
        run: {
          ...identity,
          status: 'failed',
          error_code: 'ALL_LLM_PROVIDERS_FAILED',
          created_at: '2026-09-28T00:00:00Z',
          updated_at: '2026-09-28T00:00:00Z',
          request: {
            scope: { project_external_id: 'P-TEST', zone_external_id: null },
            data_as_of: '2026-09-28',
          },
        },
        tasks: [],
        events: [],
      },
      bundle: {
        artifacts: [
          { ...identity, kind: 'query', artifact_id: 'query', input_refs: [] },
          { ...identity, kind: 'query_result', artifact_id: 'result', input_refs: ['query'] },
        ],
        validations: ['query', 'result'].map((artifact_id) => ({
          ...identity,
          artifact_id,
          valid: true,
        })),
        sources: [],
      },
      readState: 'ready',
      canWrite: false,
      messages: [],
      messageContextRefs: [],
      project: 'P-TEST',
      dataAsOf: '2026-09-28',
      catalog: { projects: [] },
      threadWorkspace: {
        context: { dataset_ids: [], referenced_artifact_ids: [] },
        reports: [],
        memory: [],
        agents: [],
      },
      runtime: {
        snapshot: {
          records: [
            {
              ...identity,
              activity_id: 'insight',
              step_key: 'team:insight',
              kind: 'invocation',
              agent_key: 'insight',
              status: 'failed',
              summary: 'Phân tích thất bại',
            },
          ],
        },
        connection: 'idle',
      },
    } as unknown as Parameters<typeof WorkspaceInspector>[0]['controller'];
    const props = {
      controller,
      organizationName: 'Test workspace',
      onArtifact: vi.fn(),
      context: { mode: 'grok', active_run_id: 'run' } as Parameters<
        typeof WorkspaceInspector
      >[0]['context'],
    };
    await act(async () => root!.render(<WorkspaceInspector {...props} />));
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    await act(async () => tabs.find((button) => button.textContent === 'Lượt chạy')!.click());
    expect(host.textContent).toContain('Truy vấn đã dùng 1 / 1');
    expect(host.textContent).toContain('ALL_LLM_PROVIDERS_FAILED');
    expect(host.textContent).toContain('Tác nhân nhận định');
    await act(async () =>
      root!.render(
        <WorkspaceInspector
          {...props}
          controller={{ ...controller, bundle: { artifacts: [], validations: [], sources: [] } }}
        />,
      ),
    );
    expect(host.textContent).toContain('Chưa có thông tin truy vấn đã xác thực.');
    expect(host.textContent).not.toContain('0 / 0');
    await act(async () =>
      root!.render(
        <WorkspaceInspector {...props} controller={{ ...controller, readState: 'loading' }} />,
      ),
    );
    expect(host.textContent).not.toContain('1 / 1');
  });
});
