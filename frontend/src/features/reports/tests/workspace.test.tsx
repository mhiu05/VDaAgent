import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../app/App';
import { createMockServices } from '../../../app/services/create-mock-services';
import { workspace } from '../../../app/integrations/workspace';
import { messages as dashboard } from '../../dashboard/messages';
import { messages as reports } from '../messages';
import { messages as admin } from '../../admin-users/messages';
import type { ReportsService } from '../services/reports-service';
import type { AdminUsersService } from '../../admin-users/services/admin-users-service';
import { ids } from '../../../mocks/core/ids';
import { demoScope } from '../../../mocks/reports/fixtures';
import { reportRowPresentation } from '../model/row-presentation';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
// Exclude cold dependency compilation from service/UI assertions; browser tests cover lazy loading.
beforeAll(async () => { await Promise.all([import('../pages/ReportDetailPage'), import('../components/ReportBlocks'), import('../../dashboard/pages/DashboardPage')]); });
async function mount(path: string, role: 'USER' | 'ADMIN' = 'USER', configure?: (services: ReturnType<typeof createMockServices>) => void) {
  history.replaceState({}, '', '/login');
  const sessionServices = createMockServices();
  vi.spyOn(sessionServices.context.clock, 'sleep').mockResolvedValue(undefined);
  const result = role === 'USER'
    ? await sessionServices.auth.login('user@vdaagent.test', 'DemoUser!2026')
    : await sessionServices.auth.loginAdminDemo();
  expect(result.error).toBeUndefined();
  history.replaceState({}, '', path);
  const services = createMockServices();
  configure?.(services);
  const view = render(<App services={services} />);
  return { services, ...view };
}
describe('workspace registrations and service integration', () => {
  it('exports complete vi/en namespaces and actual bridge services', () => {
    for (const messages of [dashboard, reports, admin]) {
      expect(Object.keys(messages.vi).sort()).toEqual(Object.keys(messages.en).sort());
      expect(Object.values(messages.en).every(value => value.length > 0)).toBe(true);
    }
    const services = createMockServices(); expect(Object.keys(services.workspace).sort()).toEqual(['admin-users', 'dashboard', 'reports']);
    expect(workspace.hasReport('R001')).toBe(true); expect(workspace.hasReport('missing')).toBe(false);
    expect(workspace.hasReport(ids.report)).toBe(true);
  });
  it('scopes service methods by authenticated demo identity and role', async () => {
    const { services, unmount } = await mount('/reports'); unmount();
    const principal = { id: ids.user, role: 'USER' as const, displayName: 'Demo', email: 'user@vdaagent.test' };
    const reports = services.workspace.reports as ReportsService;
    expect((await reports.summarize(principal, demoScope)).data?.distinctReports).toBe(12);
    expect((await reports.detail(principal, ids.report)).data?.summary.record.id).toBe('R001');
    expect((await reports.summarize({ ...principal, id: 'someone-else' }, demoScope)).error?.code).toBe('forbidden');
    expect((await (services.workspace['admin-users'] as AdminUsersService).detail(principal, 'user-01')).error?.code).toBe('forbidden');
  });
});
describe('Dashboard in the actual Shell', () => {
  it('replaces invalid dashboard dates while preserving scenario and exposes signal drilldowns', async () => {
    await mount('/?from=invalid&to=2026-10-16&scenario=success');
    await waitFor(() => expect(new URLSearchParams(location.search).get('from')).toBe(demoScope.from));
    expect(new URLSearchParams(location.search).get('scenario')).toBe('success');
    const signal = screen.getByText('6/120 căn chưa có tuổi tồn hợp lệ.').closest('details')!;
    await userEvent.click(within(signal).getByText('6/120 căn chưa có tuổi tồn hợp lệ.'));
    await userEvent.click(within(signal).getByRole('button', { name: 'Xem dữ liệu' }));
    await waitFor(() => expect(new URLSearchParams(location.search).get('target')).toBe('unknown'));
    expect(signal.querySelector('time')?.getAttribute('dateTime')).toBeTruthy();
  });
  it('renders canonical KPI values, task/report activity, provenance and chart tables', async () => {
    const { container } = await mount('/');
    await waitFor(() => expect(container.querySelector('[data-metric="inventory"]')).toHaveTextContent('120'));
    expect(container.querySelector('[data-metric="slowShare"]')).toHaveTextContent('31,6');
    expect(container.querySelector('[data-metric="transactions"]')).toHaveTextContent('45');
    expect(screen.getByText(/114\/120 căn đủ ngày/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /12.*Báo cáo hoàn tất/ })).toBeInTheDocument();
    await userEvent.click(screen.getAllByText('Xem bảng dữ liệu')[0]);
    expect(screen.getByRole('table', { name: 'Phân bố tuổi tồn kho' })).toBeVisible();
    expect(screen.getByRole('main').querySelectorAll('h1')).toHaveLength(1);
  });
  it('keeps reports and transaction data when inventory fails, then recovers on retry', async () => {
    const { container } = await mount('/?scenario=error');
    await waitFor(() => expect(container.querySelector('[data-metric="transactions"]')).toHaveTextContent('45'));
    expect(container.querySelector('[data-metric="inventory"]')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Thử lại' })[0]);
    await waitFor(() => expect(container.querySelector('[data-metric="inventory"]')).toHaveTextContent('120'));
  });
});
describe('Report journeys', () => {
  it('opens the one R010 card as v2, renders canonical KPIs and eight reader sections, and retains v1', async () => {
    await mount('/reports?q=R010');
    const trigger = await screen.findByRole('link', { name: 'Báo cáo phân tích tồn kho — Riverside, đợt 10' });
    expect(screen.getAllByRole('link', { name: trigger.textContent! })).toHaveLength(1);
    await userEvent.click(trigger);
    // Include the actual pinned-version read; allow suite load beyond RTL's one-second default.
    await screen.findByRole('heading', { name: 'Tồn lâu tăng dù tổng tồn kho đã giảm' }, { timeout: 5000 });
    const dialog = screen.getByRole('dialog');
    expect([...dialog.querySelectorAll('.report-kpis dd strong')].map(el => el.textContent)).toEqual(['60', '20', '35,7', '93,3']);
    expect(dialog.querySelectorAll('.report-kpi-comparison')).toHaveLength(4);
    expect(within(dialog).getByRole('combobox', { name: 'Bản lưu bất biến' })).toHaveValue('R010-v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xem báo cáo đầy đủ' }));
    const toc = await within(dialog).findByRole('navigation', { name: 'Mục lục' });
    expect(within(toc).getAllByRole('link')).toHaveLength(8);
    expect(dialog.querySelectorAll('.report-document > .report-block-grid > section > h2')).toHaveLength(8);
    expect(dialog.querySelector('.report-document')).toHaveTextContent('Chênh lệch giảm 6 căn khả dụng không đồng nghĩa với 6 căn đã bán');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Bản lưu bất biến' }), 'R010-v1');
    await within(dialog).findByRole('button', { name: 'Tải HTML demo' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Bản lưu bất biến' }), 'R010-v2');
    await within(dialog).findByRole('button', { name: 'Tải HTML' });
    expect(within(dialog).getByRole('navigation', { name: 'Mục lục' }).querySelectorAll('a')).toHaveLength(8);
  });
  it('shows removable agent-only filters and preserves completed-version presentation', async () => {
    const { services } = await mount('/reports?agent=unknown-agent');
    await screen.findByRole('heading', { name: 'Không có báo cáo khớp bộ lọc' });
    expect(screen.getAllByRole('button', { name: 'Xóa bộ lọc' })[0]).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ bộ lọc Agent tạo báo cáo: unknown-agent' }));
    await screen.findByText('18 báo cáo');
    const principal = { id: ids.user, role: 'USER' as const, displayName: 'Demo', email: 'user@vdaagent.test' };
    const service = services.workspace.reports as ReportsService;
    const detail = (await service.detail(principal, 'R001')).data!;
    const catalog = (await service.catalog(principal)).data!;
    const summary = { ...detail.summary, latestAttempt: { ...detail.summary.latestAttempt!, state: 'running' as const } };
    const presentation = reportRowPresentation(summary, catalog.projects, 'completedAt');
    expect(presentation.date).toBe(detail.version!.completedAt);
    expect(presentation.attemptNote).toBe('newAttemptRunning');
    expect(presentation.link).toContain('version=R001-v2');
  });
  it('filters full report scope, distinguishes no-match and resets filters', async () => {
    await mount('/reports'); await screen.findByText('18 báo cáo');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái' }), 'completed');
    await screen.findByText('12 báo cáo');
    const search = screen.getByRole('searchbox', { name: 'Tìm báo cáo' });
    await userEvent.type(search, 'zz-not-found'); await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Không có báo cáo khớp bộ lọc' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Xóa bộ lọc' })[0]);
    await screen.findByText('18 báo cáo');
  });
  it('reads a selected immutable version, evidence and real HTML/CSV download actions', async () => {
    await mount('/reports/R001?version=R001-v1');
    await screen.findByRole('combobox', { name: 'Bản lưu bất biến' });
    expect(screen.getByRole('combobox', { name: 'Bản lưu bất biến' })).toHaveValue('R001-v1');
    expect(await screen.findByRole('navigation', { name: 'Mục lục' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tóm tắt điều hành' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải HTML demo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tải CSV demo' })).toBeEnabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bản lưu bất biến' }), 'R001-v2');
    await waitFor(() => expect(new URLSearchParams(location.search).get('version')).toBe('R001-v2'));
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('navigation', { name: 'Mục lục' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('R001-v2');
  });
  it('keeps unfinished reports readable as lifecycle state without fake artifacts', async () => {
    await mount('/reports/R017');
    await screen.findByRole('heading', { name: 'Chưa có phiên bản đã lưu' });
    expect(screen.queryByRole('button', { name: /Tải HTML/ })).toBeNull();
  });
  it('aborts an obsolete version read and rejects its late response after browser Back', async () => {
    let versionSignal: AbortSignal | undefined;
    let releaseVersion!: (result: Awaited<ReturnType<ReportsService['detail']>>) => void;
    let readDetail!: ReportsService['detail'];
    await mount('/reports?report=R001&version=R001-v1&view=detail', 'USER', services => {
      const reports = services.workspace.reports as ReportsService;
      readDetail = reports.detail.bind(reports);
      vi.spyOn(reports, 'detail').mockImplementation((principal, id, version, signal) => {
        if (version !== 'R001-v2') return readDetail(principal, id, version, signal);
        versionSignal = signal;
        return new Promise(resolve => { releaseVersion = resolve; });
      });
    });
    const select = await screen.findByRole('combobox', { name: 'Bản lưu bất biến' });
    expect(select).toHaveValue('R001-v1');
    await userEvent.selectOptions(select, 'R001-v2');
    await waitFor(() => expect(versionSignal).toBeDefined());
    await act(async () => { history.back(); });
    await waitFor(() => expect(new URLSearchParams(location.search).get('version')).toBe('R001-v1'));
    await waitFor(() => expect(versionSignal?.aborted).toBe(true));
    await screen.findByRole('combobox', { name: 'Bản lưu bất biến' });
    const principal = { id: ids.user, role: 'USER' as const, displayName: 'Demo', email: 'user@vdaagent.test' };
    const obsolete = await readDetail(principal, 'R001', 'R001-v2');
    await act(async () => { releaseVersion(obsolete); });
    expect(screen.getByRole('combobox', { name: 'Bản lưu bất biến' })).toHaveValue('R001-v1');
    expect(screen.getByRole('dialog').querySelector('.report-document')).toHaveTextContent('R001-v1');
    expect(screen.getByRole('dialog').querySelector('.report-document')).not.toHaveTextContent('R001-v2');
  });
});
describe('Admin journeys', () => {
  it('enforces the Shell role guard on direct URLs', async () => {
    await mount('/admin/users');
    await screen.findByRole('heading', { name: 'Bạn không có quyền truy cập trang này' });
    expect(screen.queryByRole('searchbox', { name: 'Tìm người dùng' })).toBeNull();
  });
  it('cancels a demo status change without mutating the account', async () => {
    await mount('/admin/users', 'ADMIN'); await screen.findByText('24 tài khoản USER');
    const userRow = () => {
      const row = screen.getByText('demo.user.1@example.invalid', { selector: 'small', exact: true }).closest('tr');
      expect(row).not.toBeNull();
      return within(row!);
    };
    await userEvent.click(userRow().getByRole('button', { name: 'Mô phỏng vô hiệu hóa demo.user.1@example.invalid' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vô hiệu hóa tài khoản mô phỏng?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(userRow().getByRole('button', { name: 'Mô phỏng vô hiệu hóa demo.user.1@example.invalid' })).toBeInTheDocument();
  });
  it('confirms pessimistic mutations and displays their audit', async () => {
    await mount('/admin/users', 'ADMIN'); await screen.findByText('24 tài khoản USER');
    const userRow = () => {
      const row = screen.getByText('demo.user.1@example.invalid', { selector: 'small', exact: true }).closest('tr');
      expect(row).not.toBeNull();
      return within(row!);
    };
    await userEvent.click(userRow().getByRole('button', { name: 'Mô phỏng vô hiệu hóa demo.user.1@example.invalid' }));
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận mô phỏng' }));
    await screen.findByText('Đã mô phỏng thay đổi trạng thái tài khoản.');
    await userEvent.click(screen.getByRole('button', { name: 'Đóng hồ sơ' }));
    await userRow().findByRole('button', { name: 'Mô phỏng kích hoạt demo.user.1@example.invalid' });
    await userEvent.click(userRow().getByRole('button', { name: /Nguyễn Minh Anh\s*demo.user.1@example.invalid/ }));
    await screen.findByRole('table', { name: 'Lịch sử thao tác mô phỏng' });
  });
  it('resets previously mutated demo users after confirmation', async () => {
    await mount('/admin/users', 'ADMIN', services => {
      const service = services.workspace['admin-users'] as AdminUsersService;
      const read = service.list.bind(service);
      vi.spyOn(service, 'list').mockImplementationOnce(async (principal, query, signal) => {
        const initial = await read(principal, query, signal);
        expect(initial.error).toBeUndefined();
        const user = initial.data!.rows.find(user => user.email === 'demo.user.1@example.invalid')!;
        const changed = await service.changeStatus(principal, { userId: user.id, targetStatus: 'disabled', expectedRevision: user.revision, operationId: 'reset-test-setup' });
        expect(changed.error).toBeUndefined();
        return read(principal, query, signal);
      });
    });
    await screen.findByRole('button', { name: 'Mô phỏng kích hoạt demo.user.1@example.invalid' });
    await userEvent.click(screen.getByRole('button', { name: 'Đặt lại phiên demo' }));
    const reset = await screen.findByRole('dialog', { name: 'Đặt lại các thay đổi tài khoản mô phỏng?' });
    await userEvent.click(within(reset).getByRole('button', { name: 'Đặt lại phiên demo' }));
    await screen.findByRole('button', { name: 'Mô phỏng vô hiệu hóa demo.user.1@example.invalid' });
  });
  it('does not report success when a mock mutation fails and supports retry', async () => {
    await mount('/admin/users?scenario=error', 'ADMIN'); await screen.findByText('24 tài khoản USER');
    await userEvent.click(screen.getByRole('button', { name: 'Mô phỏng vô hiệu hóa demo.user.1@example.invalid' }));
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận mô phỏng' }));
    await screen.findByText(/Thao tác chưa được xác nhận thành công/);
    expect(screen.queryByText('Đã mô phỏng thay đổi trạng thái tài khoản.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Đã mô phỏng thay đổi trạng thái tài khoản.');
  });
});
