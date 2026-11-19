// The trace timeline renders execd's `changed` entries (`{path, status}` objects) as file
// names: rendering the raw object crashed the page (React error #31) in the e2e run.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../../../app/App";
// warm the lazily loaded page so the assertion is not waiting on its compilation
import "../pages/AdminPage";
import { createMockServices } from "../../../app/services/create-mock-services";
import {
  ADMIN_CONSOLE_KEY, type AdminConsoleService, type AgentTrace, type TraceEvent,
} from "../services/admin-service";
import type { BuilderAgent } from "../../agents/services/builder-service";

const AGENT: BuilderAgent = {
  id: "a1",
  slug: "data",
  name: "Data",
  avatar: { emoji: "🗄️", color: "#2563EB" },
  description: "",
  origin: "starter:data",
  isLead: false,
  status: "idle",
  statusDetail: null,
  createdAt: "2026-10-18T05:00:00Z",
};

const EVENTS: TraceEvent[] = [
  {
    seq: 1,
    epoch: 0,
    kind: "assistant",
    payload: { text: "", tool_calls: [{ id: "c1", code: "open('files/units.csv','w')" }] },
    traceId: "x1",
    activationKind: "notification",
    taskId: null,
    createdAt: "2026-10-18T05:01:00Z",
  },
  {
    seq: 2,
    epoch: 0,
    kind: "tool_result",
    payload: {
      tool_call_id: "c1",
      text: "exit_code: 0\nok",
      exit_code: 0,
      duration_ms: 12,
      changed: [{ path: "files/units.csv", status: "A" }],
      head: null,
      offload_path: null,
      timed_out: false,
    },
    traceId: "x1",
    activationKind: "notification",
    taskId: null,
    createdAt: "2026-10-18T05:01:01Z",
  },
];

describe("admin trace view", () => {
  it("renders the changed files of a Python call", async () => {
    const services = createMockServices();
    await services.auth.loginAdminDemo();
    const trace = vi.fn(async (): Promise<{ data: AgentTrace }> => ({
      data: { agent: AGENT, events: EVENTS, epochs: [], jev: [] },
    }));
    services.workspace[ADMIN_CONSOLE_KEY] = {
      trace,
      overview: async () => ({ data: { domains: [], agents: [] } }),
      config: async () => ({ data: { langfuseUrl: "http://localhost:3100", projectId: "contoso-poc" } }),
      watch: () => () => undefined,
    } as unknown as AdminConsoleService;
    history.replaceState({}, "", "/admin/trace/a1");
    render(<App services={services} />);
    expect(await screen.findByText("files/units.csv")).toBeInTheDocument();
  });
});
