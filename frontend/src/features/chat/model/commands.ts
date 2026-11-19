import type { Conversation } from "./types";

export type MockCommand = "report" | "unsupported" | "message";
/** Scoped UI command only; never invokes a runtime or creates a report. */
export function resolveMockCommand(
  conversation: Conversation,
  body: string,
): MockCommand {
  if (!/^\/report(?:\s|$)/i.test(body.trim())) return "message";
  if (
    conversation.scenarioId !== "riverside-inventory-r010-agent-demo-v2" ||
    conversation.reportRef?.reportId !== "R010" ||
    conversation.reportRef.versionId !== "R010-v2"
  )
    return "unsupported";
  const intent = body.trim().replace(/^\/report\s*/i, "");
  if (!intent) return "report";
  const normalized = intent
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /riverside|r010/.test(normalized) &&
    !/green\s*park|long\s*garden|ha noi|da nang|sai gon/.test(normalized)
    ? "report"
    : "unsupported";
}
