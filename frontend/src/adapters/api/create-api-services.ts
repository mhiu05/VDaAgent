import type { ServiceOverrides } from "../../app/services/create-services";
import { createApiAdminUsers } from "./admin-users";
import { createApiAgentChat } from "./agent-chat";
import { createApiGroups } from "./groups";
import { createApiAgentBuilder } from "./agent-builder";
import { createApiAdminConsole } from "./admin-console";
import { createApiAuth } from "./auth";
import { createApiDashboard } from "./dashboard";
import { createApiClient } from "./http";
import { createApiNotifications } from "./notifications";
import { createApiPreferences } from "./preferences";
import { browserEventSource, createRealtime, type EventSourceFactory } from "./realtime";
import { createApiReports, createReportTargets } from "./reports";
import { createSessionStore } from "./session";
import { AGENT_CHAT_KEY } from "../../features/chat/services/agent-chat-service";
import { GROUPS_KEY } from "../../features/groups/services/groups-service";
import { AGENT_BUILDER_KEY } from "../../features/agents/services/builder-service";
import { ADMIN_CONSOLE_KEY } from "../../features/admin/services/admin-service";

export interface ApiServiceOptions {
  fetch?: typeof fetch;
  base?: string;
  eventSource?: EventSourceFactory;
  now?: () => Date;
}

/** The real API for every port; the scripted `chat` port stays mock and `/chat` uses the
 * `agent-chat` port instead (S12b). `VITE_SERVICE_MODE=hybrid` selects it. */
export function createApiHybridServices(options: ApiServiceOptions = {}): ServiceOverrides {
  const base = options.base ?? "";
  const now = options.now ?? (() => new Date());
  const session = createSessionStore();
  const client = createApiClient({ fetch: options.fetch, base,
    sessionIdentity: () => session.principal, onUnauthorized: () => session.expire() });
  const realtime = createRealtime(`${base}/api/stream`, options.eventSource ?? browserEventSource);
  const reportTargets = createReportTargets();
  const reports = createApiReports(client, reportTargets, realtime);
  return {
    auth: createApiAuth(client, session, now, realtime),
    preferences: createApiPreferences(client, session),
    notifications: createApiNotifications(client, realtime, now),
    reportTargets,
    workspace: {
      reports,
      dashboard: createApiDashboard(client, reports, now),
      "admin-users": createApiAdminUsers(client),
      [AGENT_CHAT_KEY]: createApiAgentChat(client, realtime, base),
      [GROUPS_KEY]: createApiGroups(client, realtime),
      [AGENT_BUILDER_KEY]: createApiAgentBuilder(client, realtime, base),
      [ADMIN_CONSOLE_KEY]: createApiAdminConsole(client, options.eventSource ?? browserEventSource, base),
    },
  };
}
