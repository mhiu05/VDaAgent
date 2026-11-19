import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/adapters/api/http";
import { createApiGroups } from "../../src/adapters/api/groups";

const group = { id: "g1", name: "Sales Team", status: "provisioning", status_detail: null,
  ai_available: false, room_thread_id: "r1", created_by: "alice", created_at: "2026-10-20T00:00:00Z",
  members: [{ id: "alice", username: "alice", display_name: "Alice" }] };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

describe("groups adapter", () => {
  it("maps lifecycle, provisioning, candidates and membership calls", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : null });
      if (url.endsWith("/provisioning")) return json({ status: "provisioning", status_detail: null,
        job_status: "running", done: 2, total: 6, agents: [] });
      if (url.includes("member-candidates")) return json([{ id: "bob", username: "bob", display_name: "Bob" }]);
      if (url.endsWith("/members")) return json({ members: [...group.members, { id: "bob", username: "bob", display_name: "Bob" }] }, 201);
      if (method === "POST") return json({ group, job_id: "job" }, 202);
      if (url.endsWith("/api/groups")) return json([group]);
      return json(group);
    });
    const service = createApiGroups(createApiClient({ fetch: fetcher as typeof fetch }));
    expect((await service.list()).data?.[0].roomThreadId).toBe("r1");
    expect((await service.create("Sales Team")).data?.members[0].displayName).toBe("Alice");
    expect((await service.progress("g1")).data?.done).toBe(2);
    expect((await service.candidates("bo")).data?.[0].username).toBe("bob");
    expect((await service.addMember("g1", "bob")).data).toHaveLength(2);
    expect(calls.find((call) => call.url.endsWith("/members"))?.body).toEqual({ user_id: "bob" });
  });
});
