import type { ReportReference } from "./types";

export function pinnedReportPath(reference: ReportReference, search: string) {
  const params = new URLSearchParams();
  params.set("report", reference.reportId);
  params.set("version", reference.versionId);
  params.set("view", "dashboard");
  const scenario = new URLSearchParams(search).get("scenario");
  if (scenario) params.set("scenario", scenario);
  return `/reports?${params}`;
}

/** Only internal chat origins can become a viewer return target. */
export function chatReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\/chat(?:\/[\w-]+)?(?:\?|$)/.test(value)) return;
  const url = new URL(value, "https://vdaagent.invalid");
  if (!/^\/chat(?:\/[\w-]+)?$/.test(url.pathname) || url.hash) return;
  return `${url.pathname}${url.search}`;
}
