import type { Clock } from "./clock";
import type { StorageAdapter } from "./storage";
export const scenarios = [
  "success",
  "loading",
  "empty",
  "error",
  "offline",
  "expired-session",
  "demo-replay",
  "duplicate-delivery",
  "out-of-order",
  "interrupted",
  "unknown-ack",
  "unsupported-capability",
  "storage-unavailable",
  "long-conversation",
  "performance",
  "report-no-chart",
  "report-no-kpi",
  "report-multiple-charts",
  "report-partial",
  "report-showcase",
  "report-unknown-chart",
  "report-invalid-chart",
  "report-unknown-schema",
  "report-unknown-type",
  "report-empty-schema",
  "report-large-table",
] as const;
export type Scenario = (typeof scenarios)[number];
export interface MockContext {
  clock: Clock;
  seed: number;
  storage: StorageAdapter;
  scenario: Scenario;
}
export function readScenario(): Scenario {
  const value = new URLSearchParams(location.search).get("scenario");
  return scenarios.find((s) => s === value) ?? "success";
}
export const seededId = (seed: number, prefix: string, sequence: number) =>
  `${prefix}-${seed}-${sequence}`;
