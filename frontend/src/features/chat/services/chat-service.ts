import type { Agent, AgentId, Attachment, ChatBundle } from "../model/types";
import type { ServiceResult } from "../../../shared/contracts/service-result";
/**
 * Domain transport boundary for both prerecorded and live responses.
 * Adapters translate their wire events into ordered ChatBundle snapshots;
 * presentation code never consumes SSE/WebSocket frames or private traces.
 * requestId is stable for acknowledgement reconciliation. Aborting stops this
 * subscription; cancel explicitly asks the adapter to stop the remote work.
 */
export interface ChatTransport {
  send(
    principal: string,
    conversation: string,
    body: string,
    attachments: Attachment[],
    requestId: string,
    signal: AbortSignal,
    onUpdate: (bundle: ChatBundle) => void,
  ): Promise<ServiceResult<ChatBundle>>;
  cancel(principal: string, requestId: string): Promise<boolean>;
}

export interface ChatService extends ChatTransport {
  readonly sourceMode?: "mock" | "api";
  readonly delivery: "replay" | "stream" | "complete";
  readonly connection: "online" | "offline";
  allocateId(prefix: string): string;
  inspectorOpen(principal: string): boolean;
  saveInspector(principal: string, open: boolean): void;
  catalog(): readonly Agent[];
  load(principal: string): Promise<ServiceResult<ChatBundle>>;
  saveDraft(
    principal: string,
    conversation: string,
    draft: string,
    attachments: Attachment[],
  ): Promise<void>;
  create(principal: string, participants: AgentId[]): Promise<ChatBundle>;
  reset(principal: string): Promise<void>;
  release(principal: string): void;
  readonly degraded: boolean;
}
