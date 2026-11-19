import type { FeatureRegistration } from '../../shared/contracts/feature-registration';
export { messages } from './messages';
export const featureRegistration: FeatureRegistration = {
  id: 'dashboard', path: '/', role: 'USER', layout: 'user', frame: 'page',
  loadPage: () => import('./pages/DashboardPage'),
  navigation: { labelKey: 'dashboard:title', iconKey: 'dashboard', order: 0 },
};
