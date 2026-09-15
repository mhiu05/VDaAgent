"use client";

import Link from "next/link";
import React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ConnectorDetailDialog } from "@/components/connector-detail-dialog";
import {
  ErrorNotice,
  LoadingButton,
  Notice,
  PageHeader,
  useDialog,
  useToast,
} from "@/components/ui";
import {
  deleteConnector,
  deleteGoogleDriveConnection,
  listConnectors,
  type Connector,
  type ConnectorListResponse,
} from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";

type Filter = "all" | "data" | "storage" | "productivity";

const providerLabel: Record<string, string> = {
  mysql: "MySQL",
  mongodb: "MongoDB",
  duckdb: "DuckDB",
  google_drive: "Google Drive",
};

function statusLabel(status: Connector["status"]) {
  if (status === "disabled") return "Đã tắt";
  if (status === "attention_required") return "Cần xử lý";
  if (status === "expired") return "Đã hết hạn";
  if (status === "disconnected") return "Chưa kết nối";
  return "Đã kết nối";
}

function targetLabel(connector: Connector) {
  if (connector.unavailable || connector.status === "disabled") {
    return "Nguồn database đã tắt trong pilot";
  }
  if (connector.provider === "google_drive") {
    return connector.safe_target.configured ? "Storage workspace" : "Chưa cấu hình OAuth";
  }
  return "Connector không khả dụng";
}

function ConnectorCard({
  connector,
  onOpen,
  instanceCount,
}: {
  connector: Connector;
  onOpen: (connector: Connector) => void;
  instanceCount: number;
}) {
  return (
    <article className="panel connector-card connector-tile">
      <button
        type="button"
        className="connector-card-trigger"
        onClick={() => onOpen(connector)}
        aria-label={`Mở chi tiết ${connector.name}`}
      >
        <span className="connector-icon" aria-hidden="true">
          {connector.provider === "google_drive" ? "▣" : "◉"}
        </span>
        <span className="connector-card-heading">
          <span className="eyebrow">{connector.category}</span>
          <strong>{providerLabel[connector.provider] || connector.provider}</strong>
        </span>
        <span className={`badge connector-status connector-status-${connector.status}`}>
          {statusLabel(connector.status)}
        </span>
        <span className="connector-card-name">{connector.name}</span>
        <small className="muted">{targetLabel(connector)}</small>
        <span className="connector-card-meta">
          <small>
            {connector.category === "data"
              ? `${connector.dataset_count} dataset sử dụng`
              : "Kết nối theo workspace"}
          </small>
          <small>
            {connector.unavailable
              ? "Chỉ có thể xóa kết nối cũ"
              : connector.last_success_at
                ? `Xác nhận ${new Date(connector.last_success_at).toLocaleDateString("vi-VN")}`
                : "Chưa kiểm tra"}
          </small>
        </span>
        <span className="connector-primary-action">Xem chi tiết →</span>
      </button>
    </article>
  );
}

export default function ConnectorsPage() {
  const { authenticated, workspaceId, me } = useAuth();
  const queryClient = useQueryClient();
  const dialog = useDialog();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Connector | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canManageConnectors = can(
    me?.effective_permissions,
    PERMISSIONS.workspaceStorageConnect,
  );
  const connectorsQueryKey = ["connectors", workspaceId] as const;
  const connectorsQuery = useQuery({
    queryKey: connectorsQueryKey,
    queryFn: listConnectors,
    enabled: authenticated && Boolean(workspaceId),
    staleTime: 30_000,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: connectorsQueryKey });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = id.startsWith("google-drive:")
        ? await deleteGoogleDriveConnection()
        : await deleteConnector(id);
      if (!result.deleted) throw new Error("Kết nối không còn tồn tại hoặc đã được xóa.");
      return result;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: connectorsQueryKey });
      const previous = queryClient.getQueryData<ConnectorListResponse>(connectorsQueryKey);
      queryClient.setQueryData<ConnectorListResponse>(connectorsQueryKey, (current) =>
        current
          ? { ...current, connectors: current.connectors.filter((connector) => connector.id !== id) }
          : current,
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(connectorsQueryKey, context.previous);
      }
      toast.error(error instanceof Error ? error.message : "Không thể xóa kết nối.");
    },
    onSuccess: () => {
      setSelected(null);
      toast.success("Đã xóa kết nối khỏi workspace.");
    },
    onSettled: () => {
      setBusy(null);
      invalidate();
    },
  });
  const connectors = connectorsQuery.data?.connectors || [];
  const visible = useMemo(
    () => connectors.filter((item) => filter === "all" || item.category === filter),
    [connectors, filter],
  );
  const counts = {
    connected: connectors.filter((item) => item.status === "connected").length,
    attention: connectors.filter(
      (item) => item.status === "attention_required" || item.status === "expired",
    ).length,
    available: connectorsQuery.data?.available.length || 0,
  };

  async function handleDisconnect(id: string) {
    if (!canManageConnectors) return;
    const confirmed = await dialog.confirm({
      title: "Xác nhận xóa kết nối",
      message:
        "Xóa kết nối này khỏi workspace? Dataset hiện có vẫn được giữ nguyên; nguồn database cũ không thể dùng để tạo hoặc làm mới dataset.",
      confirmLabel: "Xóa kết nối",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(`delete:${id}`);
    deleteMutation.mutate(id);
  }

  return (
    <>
      <PageHeader
        eyebrow="Integration center"
        title="Connectors"
        description="Quản lý Google Drive và dọn các kết nối database legacy trong workspace."
      />
      {!canManageConnectors && (
        <Notice tone="info">
          Chỉ Owner có thể xóa connector. Bạn vẫn có thể xem metadata đã được làm sạch.
        </Notice>
      )}
      {connectorsQuery.isError && (
        <ErrorNotice error={connectorsQuery.error} retry={() => void connectorsQuery.refetch()} />
      )}
      <section className="grid three connector-summary" aria-label="Tổng quan connectors">
        <div className="panel"><small className="muted">Đã kết nối</small><strong className="metric-value">{counts.connected}</strong></div>
        <div className="panel"><small className="muted">Cần xử lý</small><strong className="metric-value">{counts.attention}</strong></div>
        <div className="panel"><small className="muted">Provider khả dụng</small><strong className="metric-value">{counts.available}</strong></div>
      </section>
      <section className="workspace-section">
        <div className="workspace-section-heading">
          <div><p className="eyebrow">CONNECTED</p><h2>Kết nối trong workspace</h2></div>
          <LoadingButton className="button secondary" type="button" busy={connectorsQuery.isFetching} onClick={() => void connectorsQuery.refetch()}>Làm mới</LoadingButton>
        </div>
        <div className="inline-actions" role="tablist" aria-label="Lọc connector">
          {(["all", "data", "storage", "productivity"] as Filter[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={filter === item} className={`button ${filter === item ? "primary" : "secondary"}`} onClick={() => setFilter(item)}>
              {item === "all" ? "Tất cả" : item === "data" ? "Data" : item === "storage" ? "Storage" : "Productivity"}
            </button>
          ))}
        </div>
        {connectorsQuery.isLoading ? (
          <div className="grid three" aria-busy="true"><div className="panel skeleton-block" /><div className="panel skeleton-block" /><div className="panel skeleton-block" /></div>
        ) : visible.length ? (
          <div className="grid three">
            {visible.map((connector) => (
              <ConnectorCard key={connector.id} connector={connector} instanceCount={connectors.filter((item) => item.provider === connector.provider).length} onOpen={setSelected} />
            ))}
          </div>
        ) : <Notice tone="info">Chưa có connector phù hợp với bộ lọc này.</Notice>}
      </section>
      <ConnectorDetailDialog connector={selected} onClose={() => setSelected(null)} onDisconnect={handleDisconnect} busy={busy} canManage={canManageConnectors} />
      <Link className="connector-datasets-link" href="/datasets/new">Tải file hoặc nhập dữ liệu từ Google Drive →</Link>
    </>
  );
}
