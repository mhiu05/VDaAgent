import type { GroupProgress } from "../services/groups-service";
import { Button } from "../../../shared/ui/button";

export function GroupProvisioning({ progress, retry, busy }: {
  progress: GroupProgress; retry(): void; busy: boolean;
}) {
  return <div className="gp-provisioning" aria-live="polite">
    <div className="gp-team-heading"><h2>Đội AI của nhóm</h2>
    <p>{progress.status === "active" ? `${progress.done}/${progress.total} sẵn sàng` : progress.status === "failed"
      ? "Khởi tạo thất bại" : `Đang khởi tạo ${progress.done}/${progress.total}`}</p>
    </div>
    <progress value={progress.done} max={progress.total || 6} aria-label="Tiến độ khởi tạo agent" />
    {progress.statusDetail ? <p role="alert">{progress.statusDetail}</p> : null}
    {progress.status === "failed" ? <Button onClick={retry} pending={busy}>Thử lại</Button> : null}
  </div>;
}
