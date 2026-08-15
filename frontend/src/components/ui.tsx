"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

export function InfoTip({ children, label = "Thông tin" }: { children: ReactNode; label?: string }) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"left" | "right" | "below">("right");
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const tooltipWidth = Math.min(270, window.innerWidth - 32);
      const gap = 12;
      if (rect.right + tooltipWidth + gap <= window.innerWidth - 12) {
        setPlacement("right");
        setPosition({ top: rect.top + rect.height / 2, left: rect.right + gap });
      } else if (rect.left - tooltipWidth - gap >= 12) {
        setPlacement("left");
        setPosition({ top: rect.top + rect.height / 2, left: rect.left - gap });
      } else {
        setPlacement("below");
        setPosition({ top: Math.min(rect.bottom + gap, window.innerHeight - 16), left: Math.max(16, Math.min(rect.left, window.innerWidth - tooltipWidth - 16)) });
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const tooltipStyle = { top: position.top, left: position.left, "--tooltip-width": `${Math.min(270, typeof window === "undefined" ? 270 : window.innerWidth - 32)}px` } as CSSProperties;
  return <span className="info-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button ref={triggerRef} type="button" className="info-tip-trigger" aria-label={label} aria-expanded={open} aria-describedby={open ? tooltipId : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}>!</button>
    {open && typeof document !== "undefined" && createPortal(<span id={tooltipId} role="tooltip" className="info-tip-portal" data-placement={placement} style={tooltipStyle}>{children}</span>, document.body)}
  </span>;
}
