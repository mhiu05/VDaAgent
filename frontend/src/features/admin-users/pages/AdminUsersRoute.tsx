import { lazy } from "react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { ADMIN_CONSOLE_KEY } from "../../admin/services/admin-service";

const ApiUsersPage = lazy(() => import("../../admin/pages/UsersPage"));
const MockUsersPage = lazy(() => import("./AdminUsersPage"));

/** `/admin/users` on the API (doc 12 "User management") when the admin console is configured;
 * the mock page otherwise. */
export default function AdminUsersRoute() {
  return useServices().workspace[ADMIN_CONSOLE_KEY] ? <ApiUsersPage /> : <MockUsersPage />;
}
