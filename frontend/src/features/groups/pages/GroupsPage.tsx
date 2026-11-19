import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { Button } from "../../../shared/ui/button";
import { GROUPS_KEY, type Group, type GroupsService } from "../services/groups-service";
import GroupDetailPage from "./GroupDetailPage";
import "./groups.css";

export default function GroupsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const service = useWorkspaceService<GroupsService>(GROUPS_KEY);
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await service.list();
    if (result.error) setError("Không tải được danh sách nhóm.");
    else { setGroups(result.data); setError(""); }
  }, [service]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => service.onChanged(() => { void load(); }), [service, load]);
  if (id) return <GroupDetailPage id={id} service={service} />;
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const result = await service.create(name.trim());
    setBusy(false);
    if (result.error) { setError("Không tạo được nhóm. Vui lòng thử lại."); return; }
    navigate(`/groups/${result.data.id}`);
  }
  return <main className="gp-page">
    <header className="gp-heading"><h1>Nhóm</h1><p>Không gian chung cho mọi người và đội AI của nhóm.</p></header>
    <section className="gp-panel"><h2>Tạo nhóm</h2>
      <form className="gp-create" onSubmit={(event) => void create(event)}>
        <label htmlFor="gp-name">Tên nhóm</label>
        <input id="gp-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Sales Team" />
        <Button type="submit" variant="primary" disabled={!name.trim()} pending={busy}>Tạo nhóm</Button>
      </form>
    </section>
    {error ? <p role="alert">{error}</p> : null}
    <section className="gp-panel"><h2>Nhóm của bạn</h2>
      {groups.length ? <ul className="gp-list">{groups.map((group) => <li key={group.id}>
        <Link to={`/groups/${group.id}`}><strong>{group.name}</strong><span>{group.members.length} thành viên · {group.status === "active" ? "Sẵn sàng" : group.status === "failed" ? "Cần thử lại" : "Đang khởi tạo"}</span></Link>
      </li>)}</ul> : <p>Chưa có nhóm nào.</p>}
    </section>
  </main>;
}
