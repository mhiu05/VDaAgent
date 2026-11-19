import type { FeatureRegistration } from '../../shared/contracts/feature-registration';
export { messages } from './messages';
export const featureRegistration: FeatureRegistration = {
  id: 'reports', path: '/reports', detailPaths: ['/reports/:id'], role: 'USER', layout: 'user', frame: 'page',
  loadPage: () => import('./pages/ReportsPage'),
  navigation: { labelKey: 'reports:title', iconKey: 'reports', order: 1 },
};
