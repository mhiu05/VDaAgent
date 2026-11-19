// A dataset shaped exactly as `contoso.dashboard.build()` publishes it (a warehouse snapshot,
// `closingBefore` a date, two years of covered sale days) goes through the real KPI rules.
import { describe, expect, it } from "vitest";
import { attentionItems } from "../model/attention";
import { inventoryMetrics, inventorySummary, transactionMetric } from "../model/metrics";
import type { DashboardDataset, PropertySnapshot, Transaction } from "../model/types";

const TZ = "Asia/Ho_Chi_Minh";
const source = { mode: "api" as const, dataThrough: "2026-07-01T00:00:00+07:00",
  updatedAt: "2026-10-21T00:00:00Z", completeness: "full" as const };
const unit = (id: string, projectId: string, listed: string | null, status: PropertySnapshot["status"] = "available"): PropertySnapshot =>
  ({ id, snapshotId: "SNAP-1", projectId, status, listedBusinessDate: listed, sourceId: `DW:unit:${id}` });
const sale = (id: string, projectId: string, day: string, extra: Partial<Transaction> = {}): Transaction =>
  ({ id: `sale:${id}`, propertyId: id, projectId, status: "completed", completedAt: `${day}T12:00:00+07:00`,
    test: false, sourceId: `DW:sale:${id}`, ...extra });
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = Date.parse(from); d <= Date.parse(to); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
};

function dataset(): DashboardDataset {
  const a = [...Array(10)].map((_, i) => unit(`A-old-${i}`, "PRJ-A", "2025-12-01"))      // 211 days at 2026-06-30
    .concat([...Array(15)].map((_, i) => unit(`A-new-${i}`, "PRJ-A", "2026-06-20")));    // 10 days
  const b = [...Array(3)].map((_, i) => unit(`B-old-${i}`, "PRJ-B", "2025-05-01"))       // 425 days
    .concat([...Array(27)].map((_, i) => unit(`B-new-${i}`, "PRJ-B", "2026-04-01")))     // 90 days
    .concat([unit("B-booked", "PRJ-B", "2025-01-01", "reserved")]);
  return {
    businessTimezone: TZ,
    projects: [
      { id: "PRJ-A", name: "Dự án A", marketId: "MA", marketLabel: "Thị trường A", sourceId: "DW:project:PRJ-A" },
      { id: "PRJ-B", name: "Dự án B", marketId: "MB", marketLabel: "Thị trường B", sourceId: "DW:project:PRJ-B" },
    ],
    snapshots: [{ id: "SNAP-1", businessDate: "2026-06-30", closingBefore: "2026-07-01", policyVersion: "slow-demo-180d-v1",
      properties: [...a, ...b], source: { ...source, id: "warehouse:SNAP-1", label: "Kho dữ liệu" } }],
    transactions: [
      sale("S1", "PRJ-A", "2026-06-02"), sale("S2", "PRJ-A", "2026-06-15"), sale("S3", "PRJ-B", "2026-06-30"),
      sale("P1", "PRJ-A", "2026-05-10"), sale("P2", "PRJ-B", "2026-05-20"),
      sale("T1", "PRJ-A", "2026-06-10", { test: true }), sale("C1", "PRJ-A", "2026-06-11", { status: "cancelled" }),
    ],
    tasks: [],
    transactionSource: { ...source, id: "warehouse:SNAP-1:sales", label: "Giao dịch" },
    taskSource: { ...source, id: "tasks", label: "Việc" },
    coveredDates: days("2024-07-01", "2026-06-30"),
  };
}
// the catalog's default for this dataset: 31 days ending at the snapshot's closingBefore
const scope = { from: "2026-05-31", to: "2026-07-01", timezone: TZ };
const all = ["PRJ-A", "PRJ-B"];

describe("dashboard from a warehouse dataset", () => {
  it("counts inventory, the ≥180-day share and the age bands from the snapshot (DASH-2/3/5)", () => {
    const { metrics, summary } = inventoryMetrics(dataset(), scope, all);
    expect(metrics.find((m) => m.id === "inventory")!.value).toBe(55);   // available only, not the booked unit
    const share = metrics.find((m) => m.id === "slowShare")!;
    expect([share.numerator, share.denominator]).toEqual([13, 55]);
    expect(share.value).toBeCloseTo(13 / 55 * 100);
    expect(summary!.bins.map((b) => b.count)).toEqual([15, 27, 10, 3, 0]);   // 0–89, 90–179, 180–359, 360+, unknown
    expect(summary!.bins.reduce((n, b) => n + b.count, 0)).toBe(summary!.total);   // bands reconcile
    // one snapshot only: no comparable baseline, so no invented delta
    expect(metrics.find((m) => m.id === "inventory")!.delta).toBeNull();
  });

  it("counts completed real sales in the period and the previous one (DASH-4/6)", () => {
    const { metric, trend } = transactionMetric(dataset(), scope, all);
    expect([metric.value, metric.baseline]).toEqual([3, 2]);   // test and cancelled rows excluded
    expect(trend).toHaveLength(31);
    expect(trend.find((p) => p.currentDate === "2026-06-15")!.current).toBe(1);
  });

  it("filters by project (DASH-7) and by period (DASH-8)", () => {
    expect(inventoryMetrics(dataset(), scope, ["PRJ-A"]).metrics[0].value).toBe(25);
    expect(transactionMetric(dataset(), scope, ["PRJ-B"]).metric.value).toBe(1);
    // a period the warehouse snapshot does not close: honestly empty, not zero
    const later = { from: "2026-09-20", to: "2026-10-21", timezone: TZ };
    expect(inventoryMetrics(dataset(), later, all).metrics[0].value).toBeNull();
    expect(transactionMetric(dataset(), later, all).metric.value).toBeNull();
  });

  it("keeps an uncovered day unknown instead of zero (DASH-9)", () => {
    const data = dataset();
    data.coveredDates = data.coveredDates.filter((d) => d !== "2026-06-20");
    const { metric, trend } = transactionMetric(data, scope, all);
    expect(metric.value).toBeNull();
    expect(trend.find((p) => p.currentDate === "2026-06-20")!.current).toBeNull();
    expect(trend.find((p) => p.currentDate === "2026-06-21")!.current).toBe(0);
  });

  it("flags only projects meeting the review rule: ≥20 units, ≥90% known age, ≥35% aged", () => {
    const data = dataset(); const snap = data.snapshots[0];
    const projects = data.projects.map((project) => ({ project, summary: inventorySummary(snap, [project.id]) }));
    const items = attentionItems(data, inventorySummary(snap, all), projects, [], snap.id);
    expect(items.filter((i) => i.projectId).map((i) => i.projectId)).toEqual(["PRJ-A"]);   // A 40%, B 10%
  });
});
