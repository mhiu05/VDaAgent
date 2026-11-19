import type { MockContext } from "../core/scenarios";
import type { PreferencesService } from "../../features/settings/services/preferences-service";
import {
  defaultPreferences,
  isPreferences,
} from "../../shared/contracts/preferences";
import { failure } from "../../shared/contracts/service-result";
export function createPreferencesMockService(
  ctx: MockContext,
): PreferencesService {
  return {
    get degraded() {
      return ctx.storage.degraded;
    },
    load: (id, name) =>
      ctx.storage.get(id, "preferences", isPreferences) ??
      defaultPreferences(name),
    async save(id, value) {
      await ctx.clock.sleep(200);
      if (ctx.scenario === "error") return failure("saveError");
      if (!isPreferences(value)) return failure("invalid", false);
      ctx.storage.set(id, "preferences", value);
      return { data: value };
    },
  };
}
