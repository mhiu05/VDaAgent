"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConnectionWizard } from "@/components/connection-wizard";
import { ConnectorDetailDialog } from "@/components/connector-detail-dialog";
import { ErrorNotice, LoadingButton, Notice, PageHeader, useDialog } from "@/components/ui";
import { disconnectConnector, disconnectGoogleDrive, listConnectors, testSavedConnector, type Connector } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import type { DatasourceKind } from "@/lib/types";

type Filter = "all" | "data" | "storage" | "productivity";
const providerLabel: Record<string, string> = { mysql: "MySQL", mongodb: "MongoDB", duckdb: "DuckDB", google_drive: "Google Drive" };
function statusLabel(status: Connector["status"]) { return status === "attention_required" ? "Cần xử lý" : status === "expired" ? "Đã hết hạn" : status === "disconnected" ? "Chưa kết nối" : "Đã kết nối"; }
function targetLabel(connector: Connector) { const target = connector.safe_target; if (connector.provider === "google_drive") return target.configured ? "Storage workspace" : "Chưa cấu hình OAuth"; if (connector.provider === "mysql" || connector.provider === "mongodb") return [target.host, target.database].filter(Boolean).join(" · ") || "Datasource đã lưu"; return String(target.file || "DuckDB trên backend"); }

function ConnectorCard({ connector, onOpen, instanceCount }: { connector: Connector; onOpen: (connector: Connector) => void; instanceCount: number }) {
  return <article className="panel connector-card connector-tile"><button type="button" className="connector-card-trigger" onClick={() => onOpen(connector)} aria-label={`Mở chi tiết ${connector.name}`}><span className="connector-icon" aria-hidden="true">{connector.provider === "mongodb" ? "◈" : connector.provider === "google_drive" ? "▣" : "◉"}</span><span className="connector-card-heading"><span className="eyebrow">{connector.category}</span><strong>{providerLabel[connector.provider] || connector.provider}</strong></span><span className={`badge connector-status connector-status-${connector.status}`}>{statusLabel(connector.status)}</span><span className="connector-card-name">{connector.name}</span><small className="muted">{targetLabel(connector)}</small><span className="connector-card-meta"><small>{connector.category === "data" ? `${connector.dataset_count} dataset sử dụng` : "Kết nối theo workspace"}</small><small>{instanceCount > 1 ? `${instanceCount} instance` : connector.last_success_at ? `Xác nhận ${new Date(connector.last_success_at).toLocaleDateString("vi-VN")}` : "Chưa kiểm tra"}</small></span><span className="connector-primary-action">Xem chi tiết →</span></button></article>;
}

export default function ConnectorsPage() {
  const { authenticated, workspaceId } = useAuth(); const queryClient = useQueryClient(); const dialog = useDialog(); const [filter, setFilter] = useState<Filter>("all"); const [selected, setSelected] = useState<Connector | null>(null); const [adding, setAdding] = useState(false); const [addingKind, setAddingKind] = useState<DatasourceKind | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const connectorsQuery = useQuery({ queryKey: ["connectors", workspaceId], queryFn: listConnectors, enabled: authenticated && Boolean(workspaceId), staleTime: 30_000 });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["connectors", workspaceId] });
  const testMutation = useMutation({ mutationFn: testSavedConnector, onSettled: invalidate });
  const disconnectMutation = useMutation({ mutationFn: (id: string) => id.startsWith("google-drive:") ? disconnectGoogleDrive() : disconnectConnector(id), onSettled: invalidate });
  const connectors = connectorsQuery.data?.connectors || []; const visible = useMemo(() => connectors.filter((item) => filter === "all" || item.category === filter), [connectors, filter]); const counts = { connected: connectors.filter((item) => item.status === "connected").length, attention: connectors.filter((item) => item.status === "attention_required" || item.status === "expired").length, available: connectorsQuery.data?.available.length || 0 };
  function handleTest(id: string) { setBusy(`test:${id}`); testMutation.mutate(id, { onSettled: () => setBusy(null) }); }
  async function handleDisconnect(id: string) {
    const confirmed = await dialog.confirm({
      title: "Xác nhận ngắt kết nối",
      message: "Ngắt kết nối connector này? Dataset hiện có sẽ được giữ nguyên.",
      confirmLabel: "Ngắt kết nối",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(`delete:${id}`);
    disconnectMutation.mutate(id, {
      onSuccess: () => setSelected(null),
      onSettled: () => setBusy(null),
    });
  }
  const providerOptions: Array<{ kind: DatasourceKind; label: string; description: string }> = [{ kind: "mongodb", label: "MongoDB", description: "Collection read-only từ MongoDB Atlas." }, { kind: "mysql", label: "MySQL", description: "Bảng hoặc query SELECT read-only." }, { kind: "duckdb", label: "DuckDB", description: "File DuckDB trên backend." }];
  return <><PageHeader eyebrow="Integration center" title="Connectors" description="Quản lý datasource, storage và các tích hợp workspace trong một nơi." action={<LoadingButton className="button primary" type="button" onClick={() => { setAdding(true); setAddingKind(null); }}>+ Thêm connector</LoadingButton>} />{connectorsQuery.isError && <ErrorNotice error={connectorsQuery.error} retry={() => void connectorsQuery.refetch()} />}<section className="grid three connector-summary" aria-label="Tổng quan connectors"><div className="panel"><small className="muted">Đã kết nối</small><strong className="metric-value">{counts.connected}</strong></div><div className="panel"><small className="muted">Cần xử lý</small><strong className="metric-value">{counts.attention}</strong></div><div className="panel"><small className="muted">Provider khả dụng</small><strong className="metric-value">{counts.available}</strong></div></section><section className="workspace-section"><div className="workspace-section-heading"><div><p className="eyebrow">CONNECTED</p><h2>Kết nối trong workspace</h2></div><LoadingButton className="button secondary" type="button" busy={connectorsQuery.isFetching} onClick={() => void connectorsQuery.refetch()}>Làm mới</LoadingButton></div><div className="inline-actions" role="tablist" aria-label="Lọc connector">{(["all", "data", "storage", "productivity"] as Filter[]).map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={`button ${filter === item ? "primary" : "secondary"}`} onClick={() => setFilter(item)}>{item === "all" ? "Tất cả" : item === "data" ? "Data" : item === "storage" ? "Storage" : "Productivity"}</button>)}</div>{connectorsQuery.isLoading ? <div className="grid three" aria-busy="true"><div className="panel skeleton-block" /><div className="panel skeleton-block" /><div className="panel skeleton-block" /></div> : visible.length ? <div className="grid three">{visible.map((connector) => <ConnectorCard key={connector.id} connector={connector} instanceCount={connectors.filter((item) => item.provider === connector.provider).length} onOpen={setSelected} />)}</div> : <Notice tone="info">Chưa có connector phù hợp với bộ lọc này.</Notice>}</section>{adding && <section className="workspace-section connector-wizard-section"><div className="workspace-section-heading"><div><p className="eyebrow">ADD CONNECTOR</p><h2>Thêm datasource</h2></div><button className="button secondary" type="button" onClick={() => { setAdding(false); setAddingKind(null); }}>Đóng</button></div>{addingKind ? <><button className="button secondary connector-back-picker" type="button" onClick={() => setAddingKind(null)}>← Chọn provider khác</button><ConnectionWizard kind={addingKind} onClose={() => { setAddingKind(null); setAdding(false); }} onSaved={() => { setAdding(false); setAddingKind(null); invalidate(); }} /></> : <div className="provider-picker" role="list" aria-label="Chọn provider">{providerOptions.map((provider) => <button key={provider.kind} type="button" className="panel provider-option" onClick={() => setAddingKind(provider.kind)}><strong>{provider.label}</strong><small>{provider.description}</small><span>Thiết lập →</span></button>)}</div>}</section>}<ConnectorDetailDialog connector={selected} onClose={() => setSelected(null)} onTest={handleTest} onDisconnect={handleDisconnect} busy={busy} /><Link className="connector-datasets-link" href="/datasets/new">Dùng connector cho dataset mới →</Link></>;
}
