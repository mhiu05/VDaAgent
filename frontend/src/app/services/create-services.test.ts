import { describe, expect, it, vi } from 'vitest';
import { createMockServices } from './create-mock-services';
import { createServices, readServiceMode, ServiceConfigurationError } from './create-services';
import type { Services } from './services';
import type { ReportsService } from '../../features/reports/services/reports-service';

describe('application adapter composition', () => {
  it('defaults to working mock services without invoking real factories', () => {
    const mock = createMockServices();
    const api = vi.fn();
    expect(createServices(readServiceMode(undefined), { mock: () => mock, api })).toBe(mock);
    expect(mock.chat.catalog()).toHaveLength(6);
    expect(api).not.toHaveBeenCalled();
  });
  it('injects API services unchanged without constructing mocks', () => {
    const apiServices = createMockServices();
    const mock = vi.fn();
    expect(createServices('api', { api: () => apiServices, mock })).toBe(apiServices);
    expect(mock).not.toHaveBeenCalled();
  });
  it('only replaces explicitly injected hybrid capabilities', () => {
    const base = createMockServices();
    const reports = { ...(base.workspace.reports as ReportsService), list: vi.fn() };
    const hybrid = createServices('hybrid', { mock: () => base, hybrid: () => ({ workspace: { reports, dashboard: base.workspace.dashboard }, reportTargets: base.reportTargets }) });
    expect(hybrid.workspace.reports).toBe(reports);
    expect(hybrid.workspace.dashboard).toBe(base.workspace.dashboard);
    expect(hybrid.auth).toBe(base.auth);
  });
  it('requires explicit dependent sources when replacing hybrid reports', () => {
    const base = createMockServices();
    expect(() => createServices('hybrid', { mock: () => base, hybrid: () => ({ workspace: { reports: base.workspace.reports } }) })).toThrow(/explicit dashboard and reportTargets/);
  });
  it('reports invalid modes and missing adapter configuration explicitly', () => {
    expect(() => readServiceMode('production')).toThrow(ServiceConfigurationError);
    expect(() => readServiceMode(null)).toThrow(ServiceConfigurationError);
    expect(() => createServices('api')).toThrow(/API services are not configured/);
    expect(() => createServices('hybrid')).toThrow(/Hybrid services are not configured/);
    expect(() => createServices('hybrid', { hybrid: () => ({}) })).toThrow(/at least one/);
    expect(() => createServices('api', { api: () => ({}) as Services })).toThrow(/Missing application service/);
    const malformed = createMockServices();
    expect(() => createServices('api', { api: () => ({ ...malformed, auth: {} }) as unknown as Services })).toThrow(/auth.restore/);
  });
  it('rejects malformed or absent feature adapters before rendering pages', () => {
    const base = createMockServices();
    expect(() => createServices('api', { api: () => ({ ...base, workspace: {} }) })).toThrow(/workspace service: reports/);
    for (const feature of ['reports', 'dashboard', 'admin-users']) {
      expect(() => createServices('hybrid', { mock: () => base, hybrid: () => ({ workspace: { dashboard: base.workspace.dashboard, [feature]: {} }, reportTargets: base.reportTargets }) })).toThrow(new RegExp(`workspace service method: ${feature}\\.`));
    }
  });
});
