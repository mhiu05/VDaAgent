import {
  validateRegistrations,
  type FeatureRegistration,
} from "../shared/contracts/feature-registration";
import { workspace } from "./integrations/workspace";
import { featureRegistration as chat } from "../features/chat/entry";
import { featureRegistration as notifications } from "../features/notifications/entry";
import { featureRegistration as settings } from "../features/settings/entry";
import { featureRegistration as agents } from "../features/agents/entry";
import { featureRegistration as groups } from "../features/groups/entry";
import { featureRegistration as admin } from "../features/admin/entry";
import { featureRegistration as adminDomains } from "../features/admin/domains-entry";
export const coreRegistrations: FeatureRegistration[] = [
  chat,
  groups,
  notifications,
  settings,
  agents,
  admin,
  adminDomains,
];
export const features = validateRegistrations([
  ...workspace.registrations,
  ...coreRegistrations,
]);
