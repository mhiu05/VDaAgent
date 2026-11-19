import { RepositoryError } from "./types";
import type { Page, ReportQuery } from "./types";
import { dayKey } from "../../../shared/lib/format";

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    validDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
export function businessDate(instant: string, timezone: string): string | null {
  if (!validInstant(instant)) return null;
  return dayKey(instant, timezone) || null;
}
export function inPeriod(
  instant: string | null,
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): boolean {
  if (!from && !to) return instant !== null && validInstant(instant);
  const date = instant ? businessDate(instant, timezone) : null;
  return date !== null && (!from || date >= from) && (!to || date < to);
}
export function validateRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new RepositoryError("validation", "Invalid timezone");
  }
  if (
    (from && !validDate(from)) ||
    (to && !validDate(to)) ||
    (from && to && from >= to)
  ) {
    throw new RepositoryError(
      "validation",
      "Expected a valid [from,to) business-date interval",
    );
  }
}
export const defaultReportQuery = (): ReportQuery => ({
  q: "",
  types: [],
  statuses: [],
  markets: [],
  projects: [],
  authors: [],
  agents: [],
  dateField: "createdAt",
  timezone: "Asia/Bangkok",
  sort: "createdAt",
  direction: "desc",
  page: 1,
  pageSize: 25,
  from: undefined,
  to: undefined,
});
const values = (params: URLSearchParams, key: string) =>
  [...new Set(params.getAll(key).filter(Boolean))].sort();
export function parseReportQuery(input: URLSearchParams): {
  query: ReportQuery;
  warnings: string[];
} {
  const query = defaultReportQuery();
  const warnings: string[] = [];
  query.q = (input.get("q") ?? "").trim().slice(0, 500);
  query.types = values(input, "type").filter(
    (v): v is ReportQuery["types"][number] =>
      /^[a-z][a-z0-9-]{0,79}$/.test(v),
  );
  query.statuses = values(input, "status").filter(
    (v): v is ReportQuery["statuses"][number] =>
      ["completed", "generating", "failed", "draft", "unsupported"].includes(v),
  );
  if (values(input, "type").length !== query.types.length)
    warnings.push("type");
  if (values(input, "status").length !== query.statuses.length)
    warnings.push("status");
  query.markets = values(input, "market");
  query.projects = values(input, "project");
  query.authors = values(input, "author");
  query.agents = values(input, "agent");
  if (input.get("dateField") === "completedAt") query.dateField = "completedAt";
  else if (input.has("dateField") && input.get("dateField") !== "createdAt")
    warnings.push("dateField");
  const sort = input.get("sort");
  if (sort && ["createdAt", "completedAt", "title", "status"].includes(sort))
    query.sort = sort as ReportQuery["sort"];
  else if (sort) warnings.push("sort");
  if (input.get("direction") === "asc") query.direction = "asc";
  else if (input.has("direction") && input.get("direction") !== "desc")
    warnings.push("direction");
  const page = Number(input.get("page") ?? 1);
  if (Number.isSafeInteger(page) && page >= 1) query.page = page;
  else warnings.push("page");
  const size = Number(input.get("pageSize") ?? 25);
  if (size === 25 || size === 50 || size === 100) query.pageSize = size;
  else warnings.push("pageSize");
  const timezone = input.get("timezone") ?? query.timezone;
  try {
    validateRange(undefined, undefined, timezone);
    query.timezone = timezone;
  } catch {
    warnings.push("timezone");
  }
  const from = input.get("from") || undefined;
  const to = input.get("to") || undefined;
  try {
    validateRange(from, to, query.timezone);
    query.from = from;
    query.to = to;
  } catch {
    warnings.push("dateRange");
  }
  return { query, warnings };
}
export function serializeReportQuery(query: ReportQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const [key, items] of [
    ["type", query.types],
    ["status", query.statuses],
    ["market", query.markets],
    ["project", query.projects],
    ["author", query.authors],
    ["agent", query.agents],
  ] as const) {
    for (const item of [...new Set(items)].sort()) params.append(key, item);
  }
  for (const key of [
    "dateField",
    "from",
    "to",
    "timezone",
    "sort",
    "direction",
    "page",
    "pageSize",
  ] as const) {
    if (query[key] !== undefined) params.set(key, String(query[key]));
  }
  return params;
}
export function updateReportQuery(
  query: ReportQuery,
  patch: Partial<ReportQuery>,
): ReportQuery {
  return { ...query, ...patch, page: patch.page ?? 1 };
}
export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): Page<T> {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    ![25, 50, 100].includes(pageSize)
  )
    throw new RepositoryError("validation", "Invalid pagination");
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(page, pageCount);
  return {
    rows: rows.slice((clamped - 1) * pageSize, clamped * pageSize),
    totalRows: rows.length,
    page: clamped,
    pageSize,
    pageCount,
  };
}
