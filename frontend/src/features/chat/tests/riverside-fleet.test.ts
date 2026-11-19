import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import canonical from "../../../mocks/reports/data/riverside-r010-v2/report.json";
import { selectRiverside } from "../../../mocks/chat/riverside-selectors";
import {
  riversideConversations,
  withRiversideConversations,
} from "../../../mocks/chat/riverside-scenario";
import { makeBundle } from "../../../mocks/chat/fixtures";
import { createChatRepository, isBundle } from "../../../mocks/chat/repository";
import { createChatMockService } from "../../../mocks/chat/entry";
import { createStorage } from "../../../mocks/core/storage";
import { fixtureEpoch } from "../../../mocks/core/clock";
import { resolveMockCommand } from "../model/commands";
import { chatReturnPath, pinnedReportPath } from "../model/report-navigation";
import { agentResultText } from "../components/AgentMessageBlocks";
import { createReportFixtures } from "../../../mocks/reports/fixtures";
import { summarizeRecord } from "../../reports/model/lifecycle";

describe("Riverside public analytical workspace", () => {
  it("reads canonical metrics, denominators, buckets and both chart arrays without source mutation", () => {
    const data = selectRiverside();
    expect(data.metrics.kind).toBe("metric-grid");
    if (data.metrics.kind !== "metric-grid" || data.age.kind !== "data-table")
      throw new Error("Missing canonical projections");
    expect(data.metrics.metrics.map((m) => m.value)).toEqual(
      canonical.kpis.map((k) => k.value),
    );
    expect(data.metrics.metrics[2].definition).toContain("20/56");
    expect(data.age.rows.map((r) => r[1])).toEqual([24, 12, 14, 6, 4]);
    expect(
      data.age.rows
        .map((r) => r[1])
        .reduce<number>((sum, n) => sum + Number(n), 0),
    ).toBe(60);
    expect(
      data.charts.map((c) =>
        c.block.kind === "chart"
          ? c.block.chart.series.map((s) => s.values)
          : [],
      ),
    ).toEqual([
      [[24, 12, 14, 6, 4]],
      [
        [66, 64, 18],
        [60, 56, 20],
      ],
    ]);
    expect(data.methodology).toMatch(/20\/56 = 35,7%/);
    expect(data.methodology).toMatch(/18\/64 = 28,1%/);
    expect(data.changes).toContain("+7,6 điểm phần trăm");
    data.metrics.metrics[0].value = -1;
    expect(selectRiverside().metrics).not.toEqual(data.metrics);
    expect(canonical.snapshots.current.available).toBe(60);
  });

  it("projects exactly ten ordered public events and six distinct two-message DMs", () => {
    const [group, ...direct] = riversideConversations();
    expect(group.messages.map((m) => m.id)).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `r010-g-${String(i + 1).padStart(3, "0")}`,
      ),
    );
    expect(group.messages.map((m) => m.author)).toEqual([
      "user",
      "orchestrator",
      "data",
      "compare",
      "chart",
      "insight",
      "orchestrator",
      "user",
      "orchestrator",
      "report",
    ]);
    expect(group.participants).toHaveLength(6);
    expect(direct).toHaveLength(6);
    expect(new Set(direct.map((c) => c.id)).size).toBe(6);
    expect(new Set(direct.map((c) => c.messages[0].body)).size).toBe(6);
    expect(direct.every((c) => c.messages.length === 2)).toBe(true);
    expect(
      group.messages.every((m) => m.source === "mock_fixture" && m.surface),
    ).toBe(true);
    const report = group.messages
      .flatMap((m) => m.blocks ?? [])
      .filter((b) => b.kind === "report-ref");
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      reference: { reportId: "R010", versionId: "R010-v2" },
    });
    expect(
      group.messages
        .flatMap((m) => m.blocks ?? [])
        .filter((b) => b.kind === "chart"),
    ).toHaveLength(2);
    const text = group.messages
      .map((m) => agentResultText(m.body, m.blocks))
      .join("\n");
    expect(text).toContain("P0");
    expect(text).toContain("Chưa có dữ liệu giá/CRM");
    expect(text).not.toMatch(
      /lease|backoff|SendToAgent|internal_mock_context|đã bán 6 căn|Đã xuất bản/,
    );
  });

  it("adds only missing scenario threads to old storage; preserves drafts, custom groups and edited transcripts", async () => {
    const old = makeBundle("empty");
    old.conversations[0].draft = "Existing draft";
    old.conversations[0].messages.push({
      id: "custom",
      author: "user",
      body: "Existing history",
      state: "complete",
      sequence: 1,
      createdAt: fixtureEpoch,
    });
    const before = structuredClone(old);
    const merged = withRiversideConversations(old);
    expect(merged.conversations.slice(0, old.conversations.length)).toEqual(
      before.conversations,
    );
    expect(withRiversideConversations(merged)).toBe(merged);
    expect(isBundle(merged)).toBe(true);
    const repo = createChatRepository();
    await repo.write("fleet-upgrade", before);
    const service = createChatMockService({
      seed: 42,
      scenario: "success",
      storage: createStorage("localStorage"),
      clock: { now: () => new Date(fixtureEpoch), sleep: async () => {} },
    });
    const loaded = (await service.load("fleet-upgrade")).data!;
    expect(loaded.conversations).toHaveLength(before.conversations.length + 7);
    const group = loaded.conversations.find(
      (c) => c.id === "riverside-r010-group",
    )!;
    await service.saveDraft("fleet-upgrade", group.id, "Group draft", []);
    const persisted = (await createChatRepository().read("fleet-upgrade"))!;
    expect(persisted.conversations[0]).toEqual(before.conversations[0]);
    expect(persisted.conversations.find((c) => c.id === group.id)?.draft).toBe(
      "Group draft",
    );
    expect(withRiversideConversations(persisted).conversations).toHaveLength(
      loaded.conversations.length,
    );
  });

  it("report commands and unknown questions never mutate the transcript, generate reports or run generic replies", async () => {
    const [group] = riversideConversations();
    expect(resolveMockCommand(group, "/report")).toBe("report");
    expect(resolveMockCommand(group, "/report Riverside đợt 10")).toBe(
      "report",
    );
    for (const body of [
      "/report Green Park",
      "/report Hà Nội",
      "/report unrelated",
    ])
      expect(resolveMockCommand(group, body)).toBe("unsupported");
    expect(
      resolveMockCommand(makeBundle("empty").conversations[0], "/report"),
    ).toBe("unsupported");
    const service = createChatMockService({
      seed: 43,
      scenario: "success",
      storage: createStorage("localStorage"),
      clock: {
        now: () => new Date(fixtureEpoch),
        sleep: vi.fn(async () => {}),
      },
    });
    const before = (await service.load("fleet-command")).data!;
    const update = vi.fn();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await service.send(
            "fleet-command",
            group.id,
            "/report",
            [],
            `cmd-${i}`,
            new AbortController().signal,
            update,
          )
        ).data,
      ).toEqual(before);
    expect(
      (
        await service.send(
          "fleet-command",
          group.id,
          "A new question",
          [],
          "unknown",
          new AbortController().signal,
          update,
        )
      ).error?.code,
    ).toBe("unsupported");
    expect(update).not.toHaveBeenCalled();
    expect((await service.load("fleet-command")).data).toEqual(before);
    const reports = createReportFixtures();
    const record = reports.records.find((r) => r.id === "R010")!;
    expect(reports.records.filter((r) => r.id === "R010")).toHaveLength(1);
    expect(reports.versions.filter((v) => v.id === "R010-v2")).toHaveLength(1);
    expect(summarizeRecord(record, reports).status).toBe("completed");
  });

  it("rejects corrupt persisted rich blocks and external or malformed chat return paths", () => {
    const bundle = makeBundle("success");
    const message = bundle.conversations.find((c) => c.scenarioId)!.messages[2];
    message.blocks = [
      {
        id: "bad",
        kind: "metric-grid",
        title: "Bad",
        evidenceIds: [],
        metrics: [{ id: "x", label: "x", unit: "x", value: NaN }],
      },
    ];
    expect(isBundle(bundle)).toBe(false);
    expect(chatReturnPath("/chat?conversation=riverside-r010-group")).toBe(
      "/chat?conversation=riverside-r010-group",
    );
    expect(chatReturnPath("/chat/0b7c-11")).toBe("/chat/0b7c-11");
    for (const path of [
      "https://evil.test/chat",
      "/chat/a/b",
      "//evil.test/chat",
      "/reports",
      "/chat/../reports",
      "/chat#x",
    ])
      expect(chatReturnPath(path)).toBeUndefined();
    expect(
      pinnedReportPath(
        { reportId: "R010", versionId: "R010-v2" },
        "?scenario=success&conversation=other",
      ),
    ).toBe(
      "/reports?report=R010&version=R010-v2&view=dashboard&scenario=success",
    );
  });
});
