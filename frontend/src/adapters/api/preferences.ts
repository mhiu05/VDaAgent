import type { PreferencesService } from "../../features/settings/services/preferences-service";
import { defaultPreferences, isPreferences, type Preferences } from "../../shared/contracts/preferences";
import { failure } from "../../shared/contracts/service-result";
import type { ApiClient } from "./http";
import { call } from "./result";
import type { SessionStore } from "./session";

/** `load` is synchronous in the port, so it reads what login/restore fetched (doc 19). */
export function createApiPreferences(client: ApiClient, session: SessionStore): PreferencesService {
  return {
    degraded: false,
    load(_principalId, displayName) {
      const cached = session.preferences;
      if (!cached) return defaultPreferences(displayName);
      return { ...cached, displayName: cached.displayName || displayName };
    },
    async save(_principalId, value) {
      if (!isPreferences(value) || !value.displayName.trim()) return failure("invalid", false);
      const result = await call(() => client.put<Preferences>("/api/me/preferences", value));
      if (result.data) session.preferences = result.data;
      return result.error ? { error: { ...result.error, messageKey: "app:saveError" } } : result;
    },
  };
}
