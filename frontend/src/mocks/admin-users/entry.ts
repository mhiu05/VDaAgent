import type { Principal } from "../../shared/contracts/auth";
import type { MockContext } from "../core/scenarios";
import type { AdminUsersService } from "../../features/admin-users/services/admin-users-service";
import type { AdminUsersRepository } from "../../features/admin-users/model/types";
import { RepositoryError } from "../../features/reports/model/types";
import { scopedPrincipal, serviceCall } from "../reports/integration";

export function createAdminUsersMockService(
  context: MockContext,
): AdminUsersService {
  let failNext = context.scenario === "error";
  let conflictNext = context.scenario === "out-of-order";
  const stores = new Map<string, Promise<AdminUsersRepository>>();
  async function repository(principal: Principal) {
    const scope = scopedPrincipal(principal, "ADMIN");
    let store = stores.get(principal.id);
    if (!store) {
      // Authorize before loading any Admin-only records or repository code.
      store = Promise.all([
        import("./repository"),
        context.scenario === "performance"
          ? import("./stress").then(({ createStressUsers }) =>
              createStressUsers(),
            )
          : import("./fixtures").then(({ createAdminFixtures }) =>
              createAdminFixtures(),
            ),
      ]).then(([{ createAdminUsersRepository }, data]) => {
        if (context.scenario === "empty") data.users = [];
        return createAdminUsersRepository(data, {
          principal: scope,
          clock: context.clock,
          timeoutAfterApply: context.scenario === "unknown-ack",
          fail: (operation) => {
            if (operation === "admin.changeStatus" && failNext) {
              failNext = false;
              return new RepositoryError("unavailable", "Demo failure");
            }
            return undefined;
          },
        });
      });
      stores.set(principal.id, store);
    }
    return store;
  }
  return {
    list: (p, query, signal) =>
      serviceCall(
        context,
        async () => (await repository(p)).list(query, signal),
        signal,
      ),
    detail: (p, id, signal) =>
      serviceCall(
        context,
        async () => (await repository(p)).readDetail(id, signal),
        signal,
      ),
    changeStatus: (p, command) => {
      const requested = structuredClone(command);
      const principal = structuredClone(p);
      return serviceCall(context, async () => {
        const instance = await repository(principal);
        if (conflictNext) {
          conflictNext = false;
          await instance.changeStatus({
            ...requested,
            operationId: `external-${requested.operationId}`,
          });
        }
        return instance.changeStatus(requested);
      });
    },
    reset: (p) =>
      serviceCall(context, async () => {
        (await repository(p)).reset();
        return null;
      }),
  };
}
