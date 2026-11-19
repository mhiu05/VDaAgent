import type { ApiClient } from "./http";
import type { Realtime } from "./realtime";
import { call } from "./result";
import type { Group, GroupProgress, GroupsService, Member } from "../../features/groups/services/groups-service";
import type { TeamAgent } from "../../features/chat/services/agent-chat-service";

type MemberDto = { id: string; username: string; display_name: string };
type GroupDto = { id: string; name: string; status: Group["status"]; status_detail: string | null;
  ai_available: boolean; room_thread_id: string; created_by: string; created_at: string; members: MemberDto[] };
type ProgressDto = { status: Group["status"]; status_detail: string | null; job_status: string | null;
  done: number; total: number; agents: GroupProgress["agents"] };
type AgentDto = { id: string; slug: string; display_name: string; avatar: TeamAgent["avatar"];
  description: string; is_lead: boolean; status: TeamAgent["status"]; status_detail: string | null };
const member = (m: MemberDto): Member => ({ id: m.id, username: m.username, displayName: m.display_name });
const group = (g: GroupDto): Group => ({ id: g.id, name: g.name, status: g.status,
  statusDetail: g.status_detail, aiAvailable: g.ai_available, roomThreadId: g.room_thread_id,
  createdBy: g.created_by, createdAt: g.created_at, members: g.members.map(member) });
const agent = (a: AgentDto): TeamAgent => ({ id: a.id, slug: a.slug, name: a.display_name,
  avatar: a.avatar, description: a.description, isLead: a.is_lead,
  status: a.status, statusDetail: a.status_detail });

export function createApiGroups(client: ApiClient, realtime?: Realtime): GroupsService {
  const path = (id: string) => `/api/groups/${encodeURIComponent(id)}`;
  return {
    onChanged: (listener) => {
      if (!realtime) return () => undefined;
      const stop = realtime.on("groups.changed", () => { listener(); realtime.restart(); });
      realtime.restart(); // include groups added while this page was closed
      return stop;
    },
    list: () => call(async () => (await client.get<GroupDto[]>("/api/groups")).map(group)),
    detail: (id) => call(async () => group(await client.get<GroupDto>(path(id)))),
    create: (name) => call(async () => group((await client.post<{ group: GroupDto }>("/api/groups", { name })).group)),
    progress: (id) => call(async () => { const p = await client.get<ProgressDto>(`${path(id)}/provisioning`);
      return { status: p.status, statusDetail: p.status_detail, jobStatus: p.job_status,
        done: p.done, total: p.total, agents: p.agents }; }),
    retry: (id) => call(async () => { await client.post(`${path(id)}/provisioning/retry`); }),
    agents: (id) => call(async () => (await client.get<AgentDto[]>(`${path(id)}/agents`)).map(agent)),
    personalAgents: () => call(async () => (await client.get<AgentDto[]>("/api/agents")).map(agent)),
    addAgent: (id, agentId) => call(async () => { await client.post(`${path(id)}/agents`, { agent_id: agentId }); }),
    candidates: (q) => call(async () => (await client.get<MemberDto[]>("/api/groups/member-candidates", { q })).map(member)),
    addMember: (id, userId) => call(async () =>
      (await client.post<{ members: MemberDto[] }>(`${path(id)}/members`, { user_id: userId })).members.map(member)),
    removeMember: (id, userId) => call(async () => { await client.delete(`${path(id)}/members/${encodeURIComponent(userId)}`); }),
  };
}
