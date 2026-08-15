import type { ReactNode } from "react";
import { formatStatus } from "@/lib/format";
import type { RunStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RunStatus }) {
  const normalized = status.toLowerCase();
  return <span className={`status status-${normalized}`}>{formatStatus(normalized)}</span>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
    {action && <div className="page-action">{action}</div>}
  </header>;
}

export function Metric({ label, value, detail, approximate = false }: { label: string; value: ReactNode; detail?: string; approximate?: boolean }) {
  return <article className="metric-card">
    <p>{label}</p>
    <strong>{approximate && <abbr title="Chỉ số được ước lượng từ mẫu">≈</abbr>} {value}</strong>
    {detail && <small>{detail}</small>}
  </article>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="empty-state"><span aria-hidden="true">◇</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Đã có lỗi không xác định.";
  return <section className="notice error" role="alert"><b>Không tải được dữ liệu.</b><p>{message}</p>{retry && <button className="button secondary" onClick={retry}>Thử lại</button>}</section>;
}

export function LoadingBlock({ label = "Đang tải dữ liệu…" }: { label?: string }) {
  return <section className="loading-block" aria-live="polite"><span className="spinner" aria-hidden="true" />{label}</section>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  return <section className={`notice ${tone}`}>{children}</section>;
}
