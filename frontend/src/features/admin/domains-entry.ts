import type { FeatureRegistration } from "../../shared/contracts/feature-registration";
import { ADMIN_CONSOLE_KEY } from "./services/admin-service";

/** Admin "Domains" page: create/manage domains, credential sets and starters (doc 12). */
export const featureRegistration: FeatureRegistration = {
  id: "admin-domains",
  path: "/admin/domains",
  role: "ADMIN",
  layout: "admin",
  frame: "page",
  loadPage: () => import("./pages/DomainsPage"),
  navigation: { labelKey: "admin:domainsTitle", iconKey: "domains", order: 1 },
  requires: ADMIN_CONSOLE_KEY,
};
