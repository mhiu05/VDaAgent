import type { SchemaBlock } from "../../reports/model/report-schema";

export type ReportReference = { reportId: string; versionId: string };
/** Public presentation data only. Transport adapters must never project private traces. */
export type AgentContentBlock =
  | SchemaBlock
  | { id: string; kind: "details"; title: string; blocks: AgentContentBlock[] }
  | { id: string; kind: "report-ref"; reference: ReportReference }
  | { id: string; kind: "action"; label: string; action: "report" | "group" };

export type AgentId =
  "orchestrator" | "data" | "compare" | "insight" | "chart" | "report";
export type Capability = "available" | "demo" | "unsupported" | "unknown";
export interface Agent {
  id: AgentId;
  name: string;
  glyph: string;
  description: { vi: string; en: string };
  skills: string[];
  tools: string[];
  mcp: string[];
  summary: { vi: string; en: string };
  capabilities: {
    group: Capability;
    mention: Capability;
    attachments: Capability;
    retry: Capability;
    cancel: Capability;
  };
}
export type MessageState =
  | "local-pending"
  | "accepted"
  | "responding"
  | "complete"
  | "send-rejected"
  | "response-interrupted"
  | "cancelled";
export interface Evidence {
  id: string;
  title: string;
  excerpt: string;
  access: "available" | "missing" | "restricted";
  url?: string;
}
export interface Artifact {
  kind: "table" | "report" | "unknown";
  caption: string;
  columns?: string[];
  rows?: string[][];
  reportId?: string;
  versionId?: string;
  access?: "available" | "missing" | "restricted";
  sourceMode?: "mock" | "api";
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  presence: "memory" | "reattach";
}
export interface Message {
  id: string;
  requestId?: string;
  author: "user" | AgentId;
  body: string;
  createdAt: string;
  state: MessageState;
  sequence: number;
  evidence?: Evidence[];
  artifact?: Artifact;
  attachments?: Attachment[];
  contributions?: { agentId: AgentId; body: string }[];
  blocks?: AgentContentBlock[];
  surface?:
    | "user"
    | "agent_public_reply"
    | "team_result_projection"
    | "report_reference";
  source?: "mock_fixture" | "runtime_projection";
  dataThrough?: string;
}
export interface Conversation {
  id: string;
  title: string;
  kind: "direct" | "group";
  participants: AgentId[];
  updatedAt: string;
  messages: Message[];
  draft: string;
  attachments: Attachment[];
  scenarioId?: string;
  reportRef?: ReportReference;
  context?: { project: string; dataThrough: string };
}
export interface ChatBundle {
  version: 2;
  conversations: Conversation[];
}
export const canUse = (capability: Capability | undefined) =>
  capability === "available" || capability === "demo";
export function applyMessage(messages: Message[], incoming: Message) {
  const index = messages.findIndex((m) => m.id === incoming.id);
  if (index < 0) return [...messages, incoming];
  if (messages[index].sequence >= incoming.sequence) return messages;
  return messages.map((m, i) => (i === index ? incoming : m));
}
