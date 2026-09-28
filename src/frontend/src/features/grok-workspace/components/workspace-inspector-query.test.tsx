// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceInspector } from './workspace-inspector';

afterEach(() => vi.restoreAllMocks());

describe('Inspector query usage after Insight failure', () => {
  it('renders persisted query counts and keeps unknown metadata distinct from zero', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    const scope = { org_id: 'org', run_id: 'run' };
    const controller = {
      currentRunDetail: { run: { ...scope, status: 'failed', error_code: 'ALL_LLM_PROVIDERS_FAILED',
        created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z',
        request: { scope: { project_external_id: 'P-TEST', zone_external_id: null }, data_as_of: '2026-09-28' } }, tasks: [], events: [] },
      bundle: { artifacts: [
        { ...scope, kind: 'query', artifact_id: 'query', input_refs: [] },
        { ...scope, kind: 'query_result', artifact_id: 'result', input_refs: ['query'] },
      ], validations: ['query', 'result'].map(artifact_id => ({ ...scope, artifact_id, valid: true })), sources: [] },
      readState: 'ready', canWrite: false, messages: [], messageContextRefs: [],
      project: 'P-TEST', dataAsOf: '2026-09-28', catalog: { projects: [] },
      threadWorkspace: { context: { dataset_ids: [], referenced_artifact_ids: [] }, reports: [], memory: [], agents: [] },
      runtime: { snapshot: { records: [{ ...scope, activity_id: 'insight', step_key: 'team:insight', kind: 'invocation', agent_key: 'insight', status: 'failed', summary: 'Phân tích thất bại' }] }, connection: 'idle' },
    } as unknown as Parameters<typeof WorkspaceInspector>[0]['controller'];
    const props = { controller, organizationName: 'Test workspace', onArtifact: vi.fn(),
      context: { mode: 'grok', active_run_id: 'run' } as Parameters<typeof WorkspaceInspector>[0]['context'] };
    try {
      await act(async () => root.render(<WorkspaceInspector {...props} />));
      await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent === 'Lượt chạy')!.click());
      expect(host.textContent).toContain('Truy vấn đã dùng 1 / 1');
      expect(host.textContent).toContain('ALL_LLM_PROVIDERS_FAILED');
      expect(host.textContent).toContain('Insight Agent');
      expect(host.querySelector('.lucide-lightbulb')).not.toBeNull();
      await act(async () => root.render(<WorkspaceInspector {...props} controller={{ ...controller, bundle: { artifacts: [], validations: [], sources: [] } }} />));
      expect(host.textContent).toContain('Chưa có thông tin truy vấn đã xác thực.');
      expect(host.textContent).not.toContain('0 / 0');
      await act(async () => root.render(<WorkspaceInspector {...props} controller={{ ...controller, readState: 'loading' }} />));
      expect(host.textContent).not.toContain('1 / 1');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
