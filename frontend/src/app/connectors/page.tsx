"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatasourceConnector } from "@/components/datasource-connector";
import { ErrorNotice, LoadingButton, Notice, PageHeader } from "@/components/ui";
import { disconnectConnector, disconnectGoogleDrive, listConnectors, testSavedConnector, type Connector } from "@/lib/api";
import type { DatasourceKind } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";

type Filter = "all" | "data" | "storage" | "productivity";
const providerLabel: Record<string, string> = { mysql: "MySQL", mongodb: "MongoDB", duckdb: "DuckDB", google_drive: "Google Drive", google_calendar: "Google Calendar" };

function statusLabel(connector: Connector) {
  if (connector.status === "attention_required") return "Cần xử lý";
  if (connector.status === "expired") return "Đã hết hạn";
  if (connector.status === "disconnected") return "Chưa kết nối";
  return "Đã kết nối";
}

function targetLabel(connector: Connector) {
  const target = connector.safe_target;
  if (connector.provider === "google_calendar") return String(target.account_label || "Google Calendar cá nhân");
  if (connector.provider === "google_drive") return target.configured ? "Storage workspace" : "Chưa cấu hình OAuth";
  if (connector.provider === "mysql" || connector.provider === "mongodb") return [target.host, target.database].filter(Boolean).join(" · ") || "Datasource đã lưu";
  return String(target.file || "DuckDB trên backend");
}

function ConnectorCard({ connector, onTest, onDisconnect, busy }: { connector: Connector; onTest: (id: string) => void; onDisconnect: (id: string) => void; busy: string | null }) {
  const isData = connector.category === "data";
  return <article className="panel connector-card">
    <div className="panel-title"><div><p className="eyebrow">{connector.category}</p><h2>{providerLabel[connector.provider] || connector.provider}</h2></div><span className={`badge connector-status connector-status-${connector.status}`}>{statusLabel(connector)}</span></div>
    <p>{connector.name}</p><small className="muted">{targetLabel(connector)}</small>
    {connector.last_error_code && <Notice tone="warning"><small>{connector.last_error_code}. Hãy kiểm tra hoặc kết nối lại.</small></Notice>}
    <div className="connector-card-meta"><small>{isData ? `${connector.dataset_count} dataset sử dụng` : connector.owner_scope === "workspace_user" ? "Kết nối theo người dùng" : "Kết nối theo workspace"}</small><small>{connector.last_success_at ? `Xác nhận ${new Date(connector.last_success_at).toLocaleString("vi-VN")}` : "Chưa kiểm tra"}</small></div>
    <div className="form-actions">
      {isData && <LoadingButton className="button secondary" type="button" busy={busy === `test:${connector.id}`} disabled={busy !== null} onClick={() => onTest(connector.id)}>Kiểm tra</LoadingButton>}
      {connector.provider === "google_calendar" && <Link className="button secondary" href="/calendar">Mở Calendar</Link>}
      {connector.provider === "google_drive" && <><Link className="button secondary" href="/datasets/new">Dùng cho upload</Link>{connector.can_disconnect && <LoadingButton className="button danger" type="button" busy={busy === `delete:${connector.id}`} disabled={busy !== null} onClick={() => onDisconnect(connector.id)}>Ngắt kết nối</LoadingButton>}</>}
      {isData && connector.can_disconnect && <LoadingButton className="button danger" type="button" busy={busy === `delete:${connector.id}`} disabled={busy !== null} onClick={() => onDisconnect(connector.id)}>Ngắt kết nối</LoadingButton>}
    </div>
  </article>;
}

export default function ConnectorsPage() {
  const { authenticated, workspaceId } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<DatasourceKind | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const connectorsQuery = useQuery({ queryKey: ["connectors", workspaceId], queryFn: listConnectors, enabled: authenticated && Boolean(workspaceId), staleTime: 30_000 });
  const testMutation = useMutation({ mutationFn: testSavedConnector, onSettled: () => queryClient.invalidateQueries({ queryKey: ["connectors", workspaceId] }) });
  const disconnectMutation = useMutation({ mutationFn: (id: string) => id.startsWith("google-drive:") ? disconnectGoogleDrive() : disconnectConnector(id), onSettled: () => queryClient.invalidateQueries({ queryKey: ["connectors", workspaceId] }) });
  const connectors = connectorsQuery.data?.connectors || [];
  const visible = useMemo(() => connectors.filter((item) => filter === "all" || item.category === filter), [connectors, filter]);
  const counts = { connected: connectors.filter((item) => item.status === "connected").length, attention: connectors.filter((item) => item.status === "attention_required" || item.status === "expired").length, available: connectorsQuery.data?.available.length || 0 };
  function handleTest(id: string) { setBusy(`test:${id}`); testMutation.mutate(id, { onSettled: () => setBusy(null) }); }
  function handleDisconnect(id: string) { if (!window.confirm("Ngắt kết nối connector này? Dataset hiện có sẽ được giữ nguyên.")) return; setBusy(`delete:${id}`); disconnectMutation.mutate(id, { onSettled: () => setBusy(null) }); }

  return <>
    <PageHeader eyebrow="Integration center" title="Connectors" description="Quản lý nguồn dữ liệu, storage và các tích hợp workspace trong một nơi." />
    {connectorsQuery.isError && <ErrorNotice error={connectorsQuery.error} retry={() => void connectorsQuery.refetch()} />}
    <section className="grid three connector-summary" aria-label="Tổng quan connectors"><div className="panel"><small className="muted">Đã kết nối</small><strong className="metric-value">{counts.connected}</strong></div><div className="panel"><small className="muted">Cần xử lý</small><strong className="metric-value">{counts.attention}</strong></div><div className="panel"><small className="muted">Provider khả dụng</small><strong className="metric-value">{counts.available}</strong></div></section>
    <section className="workspace-section"><div className="workspace-section-heading"><div><p className="eyebrow">CONNECTED</p><h2>Kết nối trong workspace</h2></div><LoadingButton className="button secondary" type="button" busy={connectorsQuery.isFetching} onClick={() => void connectorsQuery.refetch()}>Làm mới</LoadingButton></div><div className="inline-actions" role="tablist" aria-label="Lọc connector">{(["all", "data", "storage", "productivity"] as Filter[]).map((item) => <button key={item} type="button" className={`button ${filter === item ? "primary" : "secondary"}`} onClick={() => setFilter(item)}>{item === "all" ? "Tất cả" : item === "data" ? "Data" : item === "storage" ? "Storage" : "Productivity"}</button>)}</div>{connectorsQuery.isLoading ? <div className="grid three" aria-busy="true"><div className="panel skeleton-block" /><div className="panel skeleton-block" /><div className="panel skeleton-block" /></div> : visible.length ? <div className="grid three">{visible.map((connector) => <ConnectorCard key={connector.id} connector={connector} onTest={handleTest} onDisconnect={handleDisconnect} busy={busy} />)}</div> : <Notice tone="info">Chưa có connector phù hợp với bộ lọc này.</Notice>}</section>
    <section className="workspace-section"><div className="workspace-section-heading"><div><p className="eyebrow">ADD DATA SOURCE</p><h2>Lưu connector datasource</h2></div></div><p className="muted">Lưu một kết nối để dùng lại cho nhiều dataset. Bạn vẫn có thể tạo dataset trực tiếp trong trang Datasets.</p><div className="inline-actions">{(["mysql", "mongodb", "duckdb"] as DatasourceKind[]).map((item) => <button key={item} type="button" className={`button ${selected === item ? "primary" : "secondary"}`} onClick={() => setSelected(selected === item ? null : item)}>{providerLabel[item]}</button>)}</div>{selected && <DatasourceConnector initialKind={selected} saveOnly onBack={() => setSelected(null)} onSaved={() => { setSelected(null); void queryClient.invalidateQueries({ queryKey: ["connectors", workspaceId] }); }} />}</section>
  </>;
}
