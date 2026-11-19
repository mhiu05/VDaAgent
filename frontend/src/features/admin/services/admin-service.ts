import type { ServiceResult } from "../../../shared/contracts/service-result";
import type { ChatMessage, ChatThread } from "../../chat/services/agent-chat-service";
import type { BuilderAgent } from "../../agents/services/builder-service";

/** The admin console on `/api/admin` (docs 12 "User management", 13 "Chat-trace view", 15). */
export interface DomainStatus { id: string; name: string; status: string; statusReason: string | null }

export interface CredentialKeyStatus { key: string; filled: boolean }
export interface CredentialSetDetail { name: string; description: string; keys: CredentialKeyStatus[] }
export interface StarterDetail {
  slug: string; displayName: string; description: string; avatar: { emoji: string; color: string };
  presets: string[]; credentials: string[]; prompt: string; isLead: boolean;
}
export interface DomainDetail extends DomainStatus {
  credentialSets: CredentialSetDetail[];
  starters: StarterDetail[];
}
export interface StarterInput {
  slug: string; displayName: string; description: string; avatar: { emoji: string; color: string };
  presets: string[]; credentials: string[]; prompt: string;
}

export interface OverviewAgent extends BuilderAgent {
  user: { id: string; username: string };
  domain: string | null;
  currentTask: { id: number; description: string } | null;
  queueLen: number | null;
  pending: number;
  costToday: number;
  lastErrorAt: string | null;
  compactionFailed: boolean;
  compactionPending: boolean;
}

/** Where a provisioning user's job is (doc 12): the next agent to create, from jobs/agents rows. */
export interface ProvisioningProgress {
  jobStatus: "queued" | "running" | null;
  step: string | null;
  agent: string | null;
  done: number;
  total: number;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  domain: DomainStatus | null;
  status: "provisioning" | "active" | "disabled" | "failed";
  statusDetail: string | null;
  createdAt: string;
  provisioning?: ProvisioningProgress | null;
}

export interface TraceEvent {
  seq: number;
  epoch: number;
  kind: "input" | "assistant" | "tool_result" | "error";
  payload: Record<string, unknown>;
  traceId: string | null;
  activationKind: string | null;
  taskId: number | null;
  createdAt: string;
}
export interface Epoch { epoch: number; startSeq: number; reason: string; summary: string | null; systemPrompt: string; createdAt: string }
export interface JevDecision {
  id: number; messageId: number; label: "task" | "side_question";
  fallback: boolean; observed: "task" | "side_question" | null;
}
export interface AgentTrace { agent: BuilderAgent; events: TraceEvent[]; epochs: Epoch[]; jev: JevDecision[] }
export type TraceStreamEvent =
  | { type: "appended"; seq: number }
  | { type: "status"; status: string; statusDetail: string | null };

type R<T> = Promise<ServiceResult<T>>;

export interface AdminConsoleService {
  config(signal?: AbortSignal): R<{ langfuseUrl: string; projectId: string }>;
  overview(signal?: AbortSignal): R<{ domains: DomainStatus[]; agents: OverviewAgent[] }>;
  users(signal?: AbortSignal): R<AdminUser[]>;
  createUser(user: { username: string; password: string; domainId: string; displayName: string }): R<AdminUser>;
  retryProvisioning(userId: string): R<string>;
  setDisabled(userId: string, disabled: boolean): R<AdminUser>;
  resetPassword(userId: string, password: string): R<AdminUser>;
  resetAgent(agentId: string): R<string>;
  userAgents(userId: string, signal?: AbortSignal): R<(BuilderAgent & { state: string })[]>;
  userThreads(userId: string, signal?: AbortSignal): R<ChatThread[]>;
  trace(agentId: string, afterSeq?: number, signal?: AbortSignal): R<AgentTrace>;
  watch(agentId: string, listener: (event: TraceStreamEvent) => void): () => void;
  compact(agentId: string): R<null>;
  thread(threadId: string, signal?: AbortSignal): R<{ thread: ChatThread; messages: (ChatMessage & { traceId: string | null })[] }>;
  markJev(messageId: number, label: "task" | "side_question"): R<null>;
  listDomainsDetailed(signal?: AbortSignal): R<DomainDetail[]>;
  createDomain(domain: { id: string; name: string }): R<DomainStatus>;
  renameDomain(domainId: string, name: string): R<DomainStatus>;
  createCredentialSet(
    domainId: string, set: { name: string; description: string; keys: string[] }
  ): R<DomainStatus>;
  setCredentialValues(domainId: string, name: string, values: Record<string, string>): R<DomainStatus>;
  deleteCredentialSet(domainId: string, name: string): R<null>;
  createStarter(domainId: string, starter: StarterInput): R<DomainStatus>;
  updateStarter(domainId: string, slug: string, starter: StarterInput): R<DomainStatus>;
  deleteStarter(domainId: string, slug: string): R<null>;
  setLeadPrompt(domainId: string, prompt: string): R<DomainStatus>;
}

export const ADMIN_CONSOLE_KEY = "admin-console";
