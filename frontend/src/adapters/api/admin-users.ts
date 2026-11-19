import type { Principal } from "../../shared/contracts/auth";
import type { AdminUsersService } from "../../features/admin-users/services/admin-users-service";
import type { ManagedUser, MutationResult } from "../../features/admin-users/model/types";
import { queryUsers } from "../../features/admin-users/model/query";
import { RepositoryError } from "../../features/reports/model/types";
import { failure } from "../../shared/contracts/service-result";
import type { ApiClient } from "./http";
import { call, forbidden } from "./result";

/** `User` of doc 15. The API has no revisions, audit trail or paging (doc 14c): revisions are a
 * constant 1, audit is empty, and paging/sorting run on the client with `queryUsers`. */
interface UserDto {
  id: string; username: string; display_name: string; status: string; created_at: string;
}
export function managedUser(u: UserDto): ManagedUser {
  return { id: u.id, name: u.display_name || u.username, email: u.username, role: "USER",
    status: u.status === "disabled" ? "disabled" : "active", createdAt: u.created_at,
    lastActiveAt: null, revision: 1 };
}

export function createApiAdminUsers(client: ApiClient): AdminUsersService {
  const admin = (p: Principal) => p.role === "ADMIN";
  const all = async (signal?: AbortSignal) =>
    (await client.get<UserDto[]>("/api/admin/users", undefined, signal)).map(managedUser);
  return {
    list: async (p, query, signal) => !admin(p) ? forbidden() : call(async () =>
      queryUsers({ users: await all(signal), audit: [] }, query), signal),
    detail: async (p, id, signal) => !admin(p) ? forbidden() : call(async () => {
      const user = (await all(signal)).find((u) => u.id === id);
      if (!user) throw new RepositoryError("notFound", "Managed USER not found");
      return { user, audit: [] };
    }, signal),
    changeStatus: async (p, command) => !admin(p) ? forbidden() : call(async () => {
      if (!command.operationId.trim() || !["active", "disabled"].includes(command.targetStatus)) {
        throw new RepositoryError("validation", "Invalid mutation command");
      }
      const dto = await client.patch<UserDto>(`/api/admin/users/${encodeURIComponent(command.userId)}`,
        { disabled: command.targetStatus === "disabled" });
      const result: MutationResult = { user: managedUser(dto), audit: null, replayed: false, sourceMode: "api" };
      return result;
    }),
    reset: async () => failure("unsupported", false),
  };
}
