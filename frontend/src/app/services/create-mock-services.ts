import { clock } from "../../mocks/core/clock";
import { createStorage } from "../../mocks/core/storage";
import { readScenario } from "../../mocks/core/scenarios";
import { createAuthMockService } from "../../mocks/auth/entry";
import { createPreferencesMockService } from "../../mocks/settings/entry";
import { workspace } from "../integrations/workspace";
import { createChatMockService } from "../../mocks/chat/entry";
import { createNotificationsMockService } from "../../mocks/notifications/entry";
import type { Services } from './services';
export function createMockServices() {
  const scenario = readScenario();
  const context = {
    clock,
    seed: 42,
    scenario,
    storage: createStorage("localStorage", scenario === "storage-unavailable"),
  };
  return {
    context,
    auth: createAuthMockService({
      ...context,
      storage: createStorage(
        "sessionStorage",
        scenario === "storage-unavailable",
      ),
    }),
    preferences: createPreferencesMockService(context),
    chat: createChatMockService(context),
    notifications: createNotificationsMockService(context),
    reportTargets: { hasReport: workspace.hasReport },
    workspace: workspace.createServices(context),
  } satisfies Services;
}
export type { Services } from './services';
