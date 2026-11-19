import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/button";
import { AgentFace } from "../../chat/components/AgentChatList";
import type { TeamAgent } from "../../chat/services/agent-chat-service";
import type { GroupProgress, GroupsService } from "../services/groups-service";
import { GroupProvisioning } from "./GroupProvisioning";

/** The group's own AI team, and adding a copy of one of your agents to it. The copy is the
 * group's (its own folder, no shared chat); people reach it in the room with @mention. */
export function GroupTeam({ id, service, ready, progress, retry, retryBusy = false }: {
  id: string; service: GroupsService; ready: boolean; progress?: GroupProgress | null;
  retry?: () => void; retryBusy?: boolean;
}) {
  const [team, setTeam] = useState<TeamAgent[]>([]);
  const [mine, setMine] = useState<TeamAgent[]>([]);
  const [picked, setPicked] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [group, own] = await Promise.all([service.agents(id), service.personalAgents()]);
    if (!group.error) setTeam(group.data);
    if (!own.error) setMine(own.data);
  }, [id, service]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => service.onChanged(() => { void load(); }), [service, load]);
  const taken = new Set(team.map((a) => a.slug));
  const eligible = mine.filter((a) => !a.isLead && !taken.has(a.slug));
  const shownAgents = !ready && progress?.agents.length ? progress.agents : team;
  async function add() {
    if (!picked) return;
    setAdding(true);
    const result = await service.addAgent(id, picked);
    setAdding(false);
    if (result.error) setMessage("Không thêm được agent này vào nhóm.");
    else { setMessage("Đang tạo bản sao cho nhóm…"); setPicked(""); }
  }
  return <>
    <section className="gp-panel gp-team" aria-label="Đội AI của nhóm">
    {progress ? <GroupProvisioning progress={progress} busy={retryBusy} retry={() => retry?.()} />
      : <h2>Đội AI của nhóm</h2>}
    <ul className="gp-agents">
      {shownAgents.map((agent) => <li key={"id" in agent ? agent.id : agent.slug}>
        <span className="gp-agent-avatar"><AgentFace name={agent.name} identity={"id" in agent ? agent.id : agent.slug}
          avatar={"id" in agent ? agent.avatar : null} size={40} status={"id" in agent ? agent.status : undefined} /></span>
        <span className="gp-agent-name">{agent.name}</span>
        <small className="gp-agent-status">{"state" in agent
          ? agent.state === "ready" ? "Sẵn sàng" : agent.state === "installing" ? "Đang cài" : "Đang chờ"
          : agent.status === "busy" || agent.status === "routine" || agent.status === "compacting" ? "Đang xử lý" : "Sẵn sàng"}</small>
      </li>)}
    </ul>
    </section>
    {ready ? <section className="gp-panel gp-add-agent" aria-label="Thêm Agent vào nhóm">
      <h2>Thêm Agent vào nhóm</h2>
      {eligible.length ? <div className="gp-add-agent-controls">
      <label className="sr-only" htmlFor="gp-add-agent">Thêm agent của bạn vào nhóm</label>
      <select id="gp-add-agent" value={picked} onChange={(e) => setPicked(e.target.value)}>
        <option value="">Chọn agent cá nhân...</option>
        {eligible.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} (@{agent.slug})</option>)}
      </select>
      <Button disabled={!picked} pending={adding} onClick={() => void add()}>Thêm vào nhóm</Button>
      </div> : <p className="gp-empty">Không có Agent cá nhân khả dụng để thêm.</p>}
    {message ? <p role="status">{message}</p> : null}
    </section> : null}
  </>;
}
