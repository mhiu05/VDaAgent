import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialWorkspaceContextState } from '../../workspace/context';
import { ContextEvidencePanel } from './context-evidence-panel';

describe('Context evidence panel', () => {
  it('renders the four authorized context tabs and the empty run state', () => {
    const output = renderToStaticMarkup(
      <ContextEvidencePanel
        orgId="10000000-0000-4000-8000-000000000001"
        organizationName="Authorized workspace"
        context={initialWorkspaceContextState}
        onClearStaleNotice={() => undefined}
      />,
    );
    expect(output).toContain('role="tablist"');
    expect(output).toContain('Bối cảnh');
    expect(output).toContain('Bằng chứng');
    expect(output).toContain('Tệp nguồn');
    expect(output).toContain('Lượt chạy');
    expect(output).toContain('Chưa có kết quả đang chọn');
    expect(output).not.toContain('report_draft');
    expect(output).not.toContain('review_result');
  });
});
