"use client";

import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { formatStatus } from "@/lib/format";
import type { RunStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RunStatus }) {
  const normalized = status.toLowerCase();
  const glyph = normalized === "completed" ? "✓" : ["failed", "cancelled"].includes(normalized) ? "×" : ["pending_review", "queued", "resuming"].includes(normalized) ? "!" : normalized === "running" ? "↻" : "•";
  return <span className={`status status-${normalized}`}><span className="status-icon" aria-hidden="true">{glyph}</span><span>{formatStatus(normalized)}</span></span>;
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

export function BusySpinner({ small = false }: { small?: boolean }) {
  return <span className={small ? "button-spinner small" : "button-spinner"} aria-hidden="true" />;
}

export function LoadingButton({ busy = false, children, disabled, className = "button primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} className={className} disabled={disabled || busy} aria-busy={busy || undefined}>
    {busy && <BusySpinner small />}
    <span>{children}</span>
  </button>;
}

export function ProgressSteps({ steps, activeStep, detail }: { steps: string[]; activeStep: number; detail?: string }) {
  const boundedStep = Math.max(0, Math.min(activeStep, steps.length - 1));
  return <section className="progress-steps" aria-live="polite" aria-label="Tiến trình xử lý">
    <ol>
      {steps.map((step, index) => <li className={index < boundedStep ? "done" : index === boundedStep ? "active" : ""} key={step}>
        <span aria-hidden="true">{index < boundedStep ? "✓" : index + 1}</span>
        <b>{step}</b>
      </li>)}
    </ol>
    {detail && <p>{detail}</p>}
  </section>;
}

type ToastTone = "info" | "success" | "warning" | "error";
type ToastItem = { id: number; tone: ToastTone; message: string };
type ToastApi = { show: (message: string, tone?: ToastTone) => void; success: (message: string) => void; error: (message: string) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 4000);
  }, [dismiss]);
  const api = { show, success: (message: string) => show(message, "success"), error: (message: string) => show(message, "error") };
  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-viewport" aria-label="Thông báo" aria-live="polite">
      {items.map((item) => <div className={`toast toast-${item.tone}`} key={item.id} role={item.tone === "error" ? "alert" : "status"}>
        <span className="toast-icon" aria-hidden="true">{item.tone === "success" ? "✓" : item.tone === "error" ? "!" : "•"}</span>
        <span>{item.message}</span>
        <button type="button" onClick={() => dismiss(item.id)} aria-label="Đóng thông báo">×</button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => undefined, success: () => undefined, error: () => undefined };
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
