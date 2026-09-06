"use client";

import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { formatStatus } from "@/lib/format";
import type { RunStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RunStatus }) {
  const normalized = status.toLowerCase();
  const glyph = normalized === "completed" ? "✓" : ["failed", "cancelled"].includes(normalized) ? "×" : ["pending_review", "queued", "resuming"].includes(normalized) ? "!" : normalized === "running" ? "↻" : "•";
  return <span className={`status status-${normalized}`} data-status={normalized}><span aria-hidden="true">{glyph}</span> {formatStatus(normalized)}</span>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header workspace-page-header">
    <div className="page-header-copy">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
    {action && <div className="page-action">{action}</div>}
  </header>;
}

export function Metric({ label, value, detail, approximate = false }: { label: string; value: ReactNode; detail?: string; approximate?: boolean }) {
  return <article className="metric-card workspace-metric">
    <p>{label}</p>
    <strong>{approximate && <abbr title="Chỉ số được ước lượng từ mẫu">≈</abbr>} {value}</strong>
    {detail && <small>{detail}</small>}
  </article>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="empty-state workspace-empty-state">
    <span className="empty-state-mark" aria-hidden="true">◇</span>
    <div className="empty-state-copy"><h2>{title}</h2><p>{detail}</p>{action}</div>
  </section>;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Đã có lỗi không xác định.";
  return <section className="notice error workspace-notice" role="alert"><span className="notice-mark" aria-hidden="true">!</span><div className="notice-copy"><b>Không tải được dữ liệu.</b><p>{message}</p>{retry && <button className="button secondary" onClick={retry}>Thử lại</button>}</div></section>;
}

export function LoadingBlock({ label = "Đang tải dữ liệu…" }: { label?: string }) {
  return <section className="loading-block workspace-loading-block" aria-live="polite"><span className="spinner" aria-hidden="true" /><span className="loading-block-label">{label}</span></section>;
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

type DialogTone = "info" | "warning" | "danger";
type DialogOptions = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: DialogTone; requireText?: string };
type DialogRequest = Required<Pick<DialogOptions, "message" | "confirmLabel" | "cancelLabel" | "tone">> & Pick<DialogOptions, "title" | "requireText"> & { mode: "confirm" | "alert" };
type DialogApi = { confirm: (options: DialogOptions) => Promise<boolean>; alert: (message: string, options?: Omit<DialogOptions, "message" | "cancelLabel" | "requireText">) => Promise<void> };
const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const messageId = useId();

  const finish = useCallback((accepted: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    setInputValue("");
    resolver?.(accepted);
  }, []);

  const open = useCallback((nextRequest: DialogRequest) => new Promise<boolean>((resolve) => {
    resolverRef.current = resolve;
    setInputValue("");
    setRequest(nextRequest);
  }), []);

  const confirm = useCallback((options: DialogOptions) => open({
    mode: "confirm",
    title: options.title || "Xác nhận thao tác",
    message: options.message,
    confirmLabel: options.confirmLabel || "Xác nhận",
    cancelLabel: options.cancelLabel || "Hủy",
    tone: options.tone || "warning",
    requireText: options.requireText,
  }), [open]);

  const alert = useCallback((message: string, options: Omit<DialogOptions, "message" | "cancelLabel" | "requireText"> = {}) => open({
    mode: "alert",
    title: options.title || "Thông báo",
    message,
    confirmLabel: options.confirmLabel || "Đã hiểu",
    cancelLabel: "",
    tone: options.tone || "info",
  }).then(() => undefined), [open]);

  useEffect(() => {
    if (!request) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      if (request.requireText) inputRef.current?.focus();
      else dialog?.querySelector<HTMLButtonElement>("[data-dialog-autofocus]")?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
    };
  }, [finish, request]);

  const api = { confirm, alert };
  const canSubmit = !request?.requireText || inputValue === request.requireText;

  return <DialogContext.Provider value={api}>
    {children}
    {request && typeof document !== "undefined" && createPortal(
      <dialog
        ref={dialogRef}
        className={`confirm-dialog confirm-dialog-${request.tone}`}
        role={request.mode === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onCancel={(event) => { event.preventDefault(); finish(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) finish(false); }}
      >
        <form
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => { event.preventDefault(); if (request.mode === "alert" || canSubmit) finish(true); }}
        >
          <div className="confirm-dialog-header">
            <span className="confirm-dialog-icon" aria-hidden="true">{request.tone === "danger" ? "!" : request.mode === "alert" ? "i" : "?"}</span>
            <div>
              <p className="eyebrow">{request.mode === "confirm" ? "XÁC NHẬN" : "THÔNG BÁO"}</p>
              <h2 id={titleId}>{request.title}</h2>
            </div>
          </div>
          <div className="confirm-dialog-body">
            <p id={messageId} className="confirm-dialog-message">{request.message}</p>
            {request.requireText && <label className="confirm-dialog-required">Nhập <strong>{request.requireText}</strong> để tiếp tục
              <input ref={inputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>}
          </div>
          <div className="confirm-dialog-actions">
            {request.mode === "confirm" && <button type="button" className="button secondary" onClick={() => finish(false)}>{request.cancelLabel}</button>}
            <button type="submit" className={`button ${request.tone === "danger" ? "danger" : "primary"}`} disabled={!canSubmit} data-dialog-autofocus={!request.requireText || undefined}>{request.confirmLabel}</button>
          </div>
        </form>
      </dialog>,
      document.body,
    )}
  </DialogContext.Provider>;
}

export function useDialog(): DialogApi {
  return useContext(DialogContext) ?? { confirm: () => Promise.resolve(false), alert: () => Promise.resolve() };
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
