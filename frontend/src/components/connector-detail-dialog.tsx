"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import type { Connector } from "@/lib/api";
import { LoadingButton, Notice } from "@/components/ui";

const labels: Record<string, string> = { mysql: "MySQL", mongodb: "MongoDB", duckdb: "DuckDB", google_drive: "Google Drive" };

function target(connector: Connector): string {
  const value = connector.safe_target;
  if (connector.provider === "google_drive") return value.configured ? "Storage workspace" : "Chưa cấu hình OAuth";
  if (connector.provider === "mysql" || connector.provider === "mongodb") return [value.host, value.database].filter(Boolean).join(" · ") || "Datasource đã lưu";
  return String(value.file || "DuckDB trên backend");
}

export function ConnectorDetailDialog({ connector, onClose, onTest, onDisconnect, busy }: {
  connector: Connector | null;
  onClose: () => void;
  onTest: (id: string) => void;
  onDisconnect: (id: string) => void;
  busy: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!connector) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    if (ref.current && typeof ref.current.showModal === "function") ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    const dialog = ref.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a, input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute("disabled"));
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
      if (index === -1 || next !== index) { event.preventDefault(); focusable[next].focus(); }
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => { dialog?.removeEventListener("keydown", onKeyDown); if (dialog?.open) { if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); } previouslyFocused.current?.focus(); };
  }, [connector, onClose]);
  if (!connector) return null;
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget) onClose(); };
  return <dialog ref={ref} className="connector-detail-dialog" aria-labelledby="connector-detail-title" onClick={closeOnBackdrop}>
    <div className="connector-detail-sheet">
      <div className="panel-title"><div><p className="eyebrow">{connector.category}</p><h2 id="connector-detail-title">{labels[connector.provider] || connector.provider}</h2></div><button className="button secondary" type="button" onClick={onClose} aria-label="Đóng chi tiết connector">Đóng</button></div>
      <p className="connector-detail-name">{connector.name}</p>
      <dl className="connector-detail-meta"><div><dt>Target</dt><dd>{target(connector)}</dd></div><div><dt>Scope</dt><dd>{connector.owner_scope === "workspace_user" ? "Theo người dùng" : "Theo workspace"}</dd></div><div><dt>Dataset</dt><dd>{connector.dataset_count}</dd></div><div><dt>Kiểm tra gần nhất</dt><dd>{connector.last_tested_at ? new Date(connector.last_tested_at).toLocaleString("vi-VN") : "Chưa kiểm tra"}</dd></div></dl>
      {connector.last_error_code && <Notice tone="warning"><span aria-live="polite">{connector.last_error_code}. Hãy kiểm tra hoặc kết nối lại.</span></Notice>}
      <p className="sr-only" aria-live="polite">{busy === `test:${connector.id}` ? "Đang kiểm tra kết nối…" : busy === `delete:${connector.id}` ? "Đang ngắt kết nối…" : ""}</p>
      <div className="form-actions">
        {connector.can_test && connector.category === "data" && <LoadingButton className="button primary" type="button" busy={busy === `test:${connector.id}`} disabled={busy !== null} onClick={() => onTest(connector.id)}>Kiểm tra kết nối</LoadingButton>}
        {connector.category === "data" && <a className="button secondary" href="/datasets/new">Dùng cho dataset</a>}
        {connector.provider === "google_drive" && <a className="button secondary" href="/datasets/new">Dùng cho upload</a>}
        {connector.can_disconnect && <LoadingButton className="button danger" type="button" busy={busy === `delete:${connector.id}`} disabled={busy !== null} onClick={() => onDisconnect(connector.id)}>Ngắt kết nối</LoadingButton>}
      </div>
    </div>
  </dialog>;
}
