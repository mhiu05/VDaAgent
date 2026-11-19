import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/button";
import type { GroupsService, Member } from "../services/groups-service";

export function MemberPicker({ service, existing, onAdd }: {
  service: GroupsService; existing: readonly Member[]; onAdd(id: string): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void service.candidates(query).then((result) => {
        if (alive && !result.error) setCandidates(result.data.filter((m) => !existing.some((e) => e.id === m.id)));
      });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, existing, service]);
  return <div className="gp-picker">
    <label htmlFor="gp-search">Thêm thành viên</label>
    <input id="gp-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên" />
    <ul>{candidates.map((person) => <li key={person.id}>
      <span>{person.displayName || person.username} <small>@{person.username}</small></span>
      <Button disabled={busy !== null} onClick={async () => { setBusy(person.id); await onAdd(person.id); setBusy(null); }}>Thêm</Button>
    </li>)}</ul>
  </div>;
}
