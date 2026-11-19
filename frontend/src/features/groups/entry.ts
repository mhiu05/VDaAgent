import type { FeatureRegistration } from "../../shared/contracts/feature-registration";
import { GROUPS_KEY } from "./services/groups-service";

export const featureRegistration: FeatureRegistration = {
  id: "groups", path: "/groups", detailPaths: ["/groups/:id"], role: "USER",
  layout: "user", frame: "page", loadPage: () => import("./pages/GroupsPage"),
  navigation: { labelKey: "app.groups", iconKey: "users", order: 2.5 }, requires: GROUPS_KEY,
};
