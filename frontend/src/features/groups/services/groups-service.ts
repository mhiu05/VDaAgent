import type { ServiceResult } from "../../../shared/contracts/service-result";
import type { TeamAgent } from "../../chat/services/agent-chat-service";

export const GROUPS_KEY = "groups";
export type Member = { id: string; username: string; displayName: string };
export type Group = {
  id: string; name: string; status: "provisioning" | "active" | "failed";
  statusDetail: string | null; aiAvailable: boolean; roomThreadId: string;
  createdBy: string; createdAt: string; members: Member[];
};
export type GroupProgress = {
  status: Group["status"]; statusDetail: string | null; jobStatus: string | null;
  done: number; total: number;
  agents: { slug: string; name: string; state: "ready" | "installing" | "pending" }[];
};
export interface GroupsService {
  onChanged(listener: () => void): () => void;
  list(): Promise<ServiceResult<Group[]>>;
  detail(id: string): Promise<ServiceResult<Group>>;
  create(name: string): Promise<ServiceResult<Group>>;
  progress(id: string): Promise<ServiceResult<GroupProgress>>;
  retry(id: string): Promise<ServiceResult<void>>;
  agents(id: string): Promise<ServiceResult<TeamAgent[]>>;
  /** The caller's own agents (`/api/agents`), the candidates for a group copy. */
  personalAgents(): Promise<ServiceResult<TeamAgent[]>>;
  /** Copy one of the caller's personal agents into the group's own team (an async job). */
  addAgent(id: string, agentId: string): Promise<ServiceResult<void>>;
  candidates(q: string): Promise<ServiceResult<Member[]>>;
  addMember(id: string, userId: string): Promise<ServiceResult<Member[]>>;
  removeMember(id: string, userId: string): Promise<ServiceResult<void>>;
}
