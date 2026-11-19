import type { FeatureRegistration } from '../../shared/contracts/feature-registration';
export { messages } from './messages';
export const featureRegistration: FeatureRegistration = {
  id: 'admin-users', path: '/admin/users', role: 'ADMIN', layout: 'admin', frame: 'page',
  loadPage: () => import('./pages/AdminUsersRoute'),
  navigation: { labelKey: 'admin-users:title', iconKey: 'users', order: 0 },
};
