import { createMockServices } from './create-mock-services';
import type { Services } from './services';
import type { ReportsService } from '../../features/reports/services/reports-service';
import type { DashboardService } from '../../features/dashboard/services/dashboard-service';
import type { AdminUsersService } from '../../features/admin-users/services/admin-users-service';

type RequiredWorkspaceServices = { reports: ReportsService; dashboard: DashboardService; 'admin-users': AdminUsersService };
const workspaceMethods = {
  reports: ['catalog', 'list', 'detail', 'download', 'summarize', 'recent', 'onChanged'],
  dashboard: ['catalog', 'overview', 'breakdown'],
  'admin-users': ['list', 'detail', 'changeStatus', 'reset'],
} as const satisfies { [Key in keyof RequiredWorkspaceServices]: readonly (keyof RequiredWorkspaceServices[Key])[] };

export type ServiceMode = 'mock' | 'api' | 'hybrid';
export type ServiceOverrides = Partial<Omit<Services, 'workspace'>> & {
  workspace?: Record<string, unknown>;
};
export interface ServiceFactories {
  mock?: () => Services;
  api?: () => Services;
  /** Explicit feature overrides, so missing integrations retain mock implementations. */
  hybrid?: () => ServiceOverrides;
}
export class ServiceConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'ServiceConfigurationError'; }
}
export function readServiceMode(value: unknown): ServiceMode {
  if (value === undefined || value === '') return 'mock';
  if (value === 'mock' || value === 'api' || value === 'hybrid') return value;
  throw new ServiceConfigurationError(`Invalid VITE_SERVICE_MODE: ${String(value)}. Use mock, api, or hybrid.`);
}
function requireServices(services: Services): Services {
  for (const key of ['context', 'auth', 'preferences', 'chat', 'notifications', 'reportTargets', 'workspace'] as const) {
    if (!services?.[key]) throw new ServiceConfigurationError(`Missing application service: ${key}.`);
  }
  const methods = {
    auth: ['restore', 'login', 'loginAdminDemo', 'loginDemo', 'demoOptions', 'logout'], preferences: ['load', 'save'],
    chat: ['allocateId', 'inspectorOpen', 'saveInspector', 'catalog', 'load', 'saveDraft', 'create', 'send', 'cancel', 'reset', 'release'],
    notifications: ['list', 'snapshot', 'subscribe', 'markRead', 'reset'],
    reportTargets: ['hasReport'],
  } as const;
  for (const key of Object.keys(methods) as (keyof typeof methods)[]) {
    for (const method of methods[key]) {
      if (typeof (services[key] as unknown as Record<string, unknown>)[method] !== 'function') {
        throw new ServiceConfigurationError(`Missing service method: ${key}.${method}.`);
      }
    }
  }
  if (typeof services.context.clock?.now !== 'function' || typeof services.context.clock?.sleep !== 'function') {
    throw new ServiceConfigurationError('Missing application clock.');
  }
  for (const [feature, methods] of Object.entries(workspaceMethods)) {
    const service = services.workspace[feature];
    if (!service || typeof service !== 'object') throw new ServiceConfigurationError(`Missing workspace service: ${feature}.`);
    for (const method of methods) {
      if (typeof (service as Record<string, unknown>)[method] !== 'function') {
        throw new ServiceConfigurationError(`Missing workspace service method: ${feature}.${method}.`);
      }
    }
  }
  return services;
}
/** Real adapters are injected here once their backend contracts are agreed. No guessed endpoints. */
export function createServices(mode: ServiceMode = 'mock', factories: ServiceFactories = {}): Services {
  const selected = readServiceMode(mode);
  if (selected === 'api') {
    if (!factories.api) throw new ServiceConfigurationError('API services are not configured. Register an API factory at bootstrap.');
    return requireServices(factories.api());
  }
  if (selected === 'hybrid' && !factories.hybrid) {
    throw new ServiceConfigurationError('Hybrid services are not configured. Register explicit feature overrides at bootstrap.');
  }
  const mock = requireServices((factories.mock ?? createMockServices)());
  if (selected === 'mock') return mock;
  const overrides = factories.hybrid!();
  if (Object.keys(overrides).length === 0) throw new ServiceConfigurationError('Hybrid mode requires at least one service override.');
  if (overrides.workspace?.reports && (!overrides.workspace.dashboard || !overrides.reportTargets)) {
    throw new ServiceConfigurationError('Replacing hybrid reports requires explicit dashboard and reportTargets dependencies for the same report source.');
  }
  return requireServices({ ...mock, ...overrides, workspace: { ...mock.workspace, ...overrides.workspace } });
}
