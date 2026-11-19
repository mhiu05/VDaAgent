import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../shared/ui/button";
import { PageState } from "../../../shared/ui/page";
import { GroupTeam } from "../components/GroupTeam";
import { MemberPicker } from "../components/MemberPicker";
import type { Group, GroupProgress, GroupsService } from "../services/groups-service";

export default function GroupDetailPage({ id, service }: { id: string; service: GroupsService }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [progress, setProgress] = useState<GroupProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await service.detail(id);
    setLoading(false);
    if (result.error) { setMissing(true); return; }
    setGroup(result.data);
    setMissing(false);
    const p = await service.progress(id);
    if (!p.error) setProgress(p.data);
  }, [id, service]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => service.onChanged(() => { void load(); }), [service, load]);
  useEffect(() => {
    if (!group || group.status === "active") return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [group, load]);
  if (loading) return <main className="gp-page"><p>Đang tải nhóm…</p></main>;
  if (missing || !group) return <PageState kind="error" title="Không tìm thấy nhóm hoặc bạn không còn là thành viên." />;
  async function retry() {
    setBusy(true);
    const result = await service.retry(id);
    setBusy(false);
    if (result.error) setError("Không thể thử lại lúc này.");
    else { setError(""); void load(); }
  }
  async function addMember(userId: string) {
    const result = await service.addMember(id, userId);
    if (result.error) setError("Không thể thêm thành viên.");
    else setGroup((current) => current ? { ...current, members: result.data } : current);
  }
  async function removeMember(userId: string) {
    const result = await service.removeMember(id, userId);
    if (result.error) setError("Không thể xóa thành viên cuối cùng hoặc bạn không còn quyền truy cập.");
    else void load();
  }
  return <main className="gp-page gp-detail">
    <Link to="/groups">← Nhóm</Link>
    <header className="gp-heading"><h1>{group.name}</h1><p>{group.members.length} thành viên</p>
      <Link className="button button-primary" to={`/chat/${group.roomThreadId}`}>Mở phòng chat</Link>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    <GroupTeam id={id} service={service} ready={group.status === "active"}
      progress={progress} retry={() => void retry()} retryBusy={busy} />
    <section className="gp-panel"><h2>Thành viên</h2>
      <ul className="gp-members">{group.members.map((member) => <li key={member.id}>
        <span className="gp-member-avatar" aria-hidden="true">{(member.displayName || member.username).slice(0, 1).toLocaleUpperCase()}</span>
        <span className="gp-member-name">{member.displayName || member.username} <small>@{member.username}</small></span>
        <Button disabled={group.members.length <= 1} onClick={() => void removeMember(member.id)}>Xóa</Button>
      </li>)}</ul>
      <MemberPicker service={service} existing={group.members} onAdd={addMember} />
    </section>
  </main>;
}
