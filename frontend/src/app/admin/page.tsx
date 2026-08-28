"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  listAdminUsers,
  createAdminUser,
  updateAdminUserStatus,
  updateAdminUserRole,
  deleteAdminUser,
  type AdminUser,
  type AdminUserStats,
} from "@/lib/api";
import { PageHeader, LoadingBlock, Notice } from "@/components/ui";

function userInitials(nameOrEmail: string | null) {
  const value = (nameOrEmail || "US").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return value.slice(0, 2).toUpperCase() || "US";
}

function formatFullDateTime(dateStr?: string | null): string {
  if (!dateStr) return "Chưa có";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Chưa có";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0 || diffMs < 60_000) return "Vừa xong";
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) return `${diffMins} phút trước`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Hôm qua";
    if (diffDays < 30) return `${diffDays} ngày trước`;
    return d.toLocaleDateString("vi-VN");
  } catch {
    return "Chưa có";
  }
}

export default function AdminUsersPage() {
  const { me, loading: authLoading } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminUserStats>({
    total_users: 0,
    active_users: 0,
    locked_users: 0,
    admin_users: 0,
    analyst_users: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modal States
  const [statusModalUser, setStatusModalUser] = useState<AdminUser | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);

  const [deleteModalUser, setDeleteModalUser] = useState<AdminUser | null>(null);
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const currentUserId = me?.user.id;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAdminUsers({
        search: searchQuery,
        role: roleFilter,
        status: statusFilter,
      });
      setUsers(data.users);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách tài khoản.");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter]);

  useEffect(() => {
    if (!authLoading) {
      void loadData();
    }
  }, [authLoading, loadData]);

  // Toast auto-hide
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    try {
      const created = await createAdminUser({ email: newEmail, ...(newPassword ? { password: newPassword, send_invite: false } : { send_invite: true }) });
      setSuccessMessage(
        created.invited
          ? `Đã gửi email mời cho Analyst "${created.email || created.user_id}".`
          : `Đã tạo tài khoản Analyst "${created.email || created.user_id}".`,
      );
      setNewEmail("");
      setNewPassword("");
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo tài khoản Analyst.");
    } finally {
      setIsCreating(false);
    }
  };

  // Open Status Modal
  const openStatusModal = (user: AdminUser) => {
    setStatusModalUser(user);
    setLockReason(user.status === "active" ? "Tạm khóa do vi phạm chính sách bảo mật hệ thống" : "");
  };

  // Handle Status Update (Lock / Unlock)
  const handleConfirmStatus = async () => {
    if (!statusModalUser) return;
    setIsSubmittingStatus(true);
    const targetStatus = statusModalUser.status === "active" ? "locked" : "active";
    try {
      const updated = await updateAdminUserStatus(statusModalUser.user_id, {
        status: targetStatus,
        reason: targetStatus === "locked" ? lockReason : undefined,
      });
      setSuccessMessage(
        targetStatus === "locked"
          ? `Đã khóa tài khoản "${updated.email || updated.user_id}" thành công.`
          : `Đã mở khóa tài khoản "${updated.email || updated.user_id}" thành công.`
      );
      setStatusModalUser(null);
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Thao tác thay đổi trạng thái thất bại.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Handle User Deletion
  const handleConfirmDelete = async () => {
    if (!deleteModalUser) return;
    setIsSubmittingDelete(true);
    try {
      await deleteAdminUser(deleteModalUser.user_id);
      setSuccessMessage(
        `Đã xóa vĩnh viễn tài khoản "${deleteModalUser.email || deleteModalUser.user_id}".`
      );
      setDeleteModalUser(null);
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Thao tác xóa tài khoản thất bại.");
    } finally {
      setIsSubmittingDelete(false);
    }
  };

  const handleToggleRole = async (user: AdminUser) => {
    if (user.user_id === currentUserId) return;
    setUpdatingRoleId(user.user_id);
    try {
      await updateAdminUserRole(user.user_id, { role: user.role === "admin" ? "analyst" : "admin" });
      setSuccessMessage("Đã cập nhật vai trò tài khoản.");
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cập nhật vai trò tài khoản.");
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const emailMatch = u.email?.toLowerCase().includes(q);
        const nameMatch = u.display_name?.toLowerCase().includes(q);
        const idMatch = u.user_id.toLowerCase().includes(q);
        if (!emailMatch && !nameMatch && !idMatch) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  return (
    <main className="page admin-page" style={{ maxWidth: "1360px", margin: "0 auto", padding: "1.5rem 2rem" }}>
      <PageHeader
        title="Quản trị hệ thống & Tài khoản"
        description="Xem toàn bộ danh sách tài khoản trong hệ thống, theo dõi thời gian đăng ký và hoạt động, thực hiện khóa / mở khóa hoặc xóa tài khoản người dùng."
      />

      <form onSubmit={handleCreateUser} className="panel" style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap", marginTop: "1rem", padding: "1rem" }}>
        <label style={{ flex: "1 1 260px" }}>Email Analyst<input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="analyst@company.com" /></label>
        <label style={{ flex: "1 1 220px" }}>Mật khẩu (tuỳ chọn)<input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Để trống để gửi lời mời" /></label>
        <button className="button primary" type="submit" disabled={isCreating}>{isCreating ? "Đang tạo…" : "Tạo Analyst"}</button>
      </form>

      {/* SUCCESS TOAST */}
      {successMessage && (
        <div style={{ marginTop: "1rem" }}>
          <Notice tone="success">
            <b>Thành công!</b> {successMessage}
          </Notice>
        </div>
      )}

      {/* ERROR MESSAGE */}
      {error && (
        <div style={{ marginTop: "1rem" }}>
          <Notice tone="warning">
            <b>Lỗi:</b> {error}
          </Notice>
        </div>
      )}

      {/* STATS OVERVIEW CARDS */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1.2rem",
          marginTop: "1.5rem",
        }}
      >
        {/* Total Users Card */}
        <div
          style={{
            padding: "1.35rem 1.5rem",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "16px",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.03)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--muted)" }}>
              Tổng số tài khoản
            </span>
            <span style={{ fontSize: "1.35rem", padding: "6px 8px", background: "rgba(49, 86, 217, 0.08)", borderRadius: "10px" }}>👥</span>
          </div>
          <b style={{ fontSize: "2.2rem", color: "var(--ink)", fontWeight: 800, lineHeight: 1.1 }}>
            {stats.total_users}
          </b>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Tất cả tài khoản thành viên
          </span>
        </div>

        {/* Active Users Card */}
        <div
          style={{
            padding: "1.35rem 1.5rem",
            background: "var(--panel)",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: "16px",
            boxShadow: "0 4px 14px rgba(16, 185, 129, 0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--muted)" }}>
              Đang kích hoạt (Active)
            </span>
            <span style={{ fontSize: "1.35rem", padding: "6px 8px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "10px" }}>🟢</span>
          </div>
          <b style={{ fontSize: "2.2rem", color: "#10b981", fontWeight: 800, lineHeight: 1.1 }}>
            {stats.active_users}
          </b>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Tài khoản hợp lệ, chưa bị khóa
          </span>
        </div>

        {/* Locked Users Card */}
        <div
          style={{
            padding: "1.35rem 1.5rem",
            background: "var(--panel)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            borderRadius: "16px",
            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--muted)" }}>
              Đã bị khóa
            </span>
            <span style={{ fontSize: "1.35rem", padding: "6px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "10px" }}>🔒</span>
          </div>
          <b style={{ fontSize: "2.2rem", color: "#ef4444", fontWeight: 800, lineHeight: 1.1 }}>
            {stats.locked_users}
          </b>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Bị đình chỉ quyền truy cập hệ thống
          </span>
        </div>

        {/* Admin Count Card */}
        <div
          style={{
            padding: "1.35rem 1.5rem",
            background: "var(--panel)",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            borderRadius: "16px",
            boxShadow: "0 4px 14px rgba(168, 85, 247, 0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--muted)" }}>
              Quản trị viên (Admin)
            </span>
            <span style={{ fontSize: "1.35rem", padding: "6px 8px", background: "rgba(168, 85, 247, 0.1)", borderRadius: "10px" }}>🛡️</span>
          </div>
          <b style={{ fontSize: "2.2rem", color: "#a855f7", fontWeight: 800, lineHeight: 1.1 }}>
            {stats.admin_users}
          </b>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Nắm giữ toàn quyền quản trị
          </span>
        </div>
      </section>

      {/* FILTER & SEARCH TOOLBAR */}
      <section
        style={{
          marginTop: "1.5rem",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "1.1rem 1.35rem",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", flex: 1 }}>
          {/* Search Box Form with explicit button */}
          <form
            onSubmit={handleSearchSubmit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              minWidth: "320px",
              flex: "1 1 340px",
            }}
          >
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type="text"
                placeholder="Nhập Email, họ tên hoặc User ID…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 34px 9px 14px",
                  borderRadius: "9px",
                  border: "1px solid var(--line)",
                  background: "var(--canvas)",
                  color: "var(--ink)",
                  fontSize: "0.88rem",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  title="Xóa tìm kiếm"
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--muted)",
                    fontSize: "0.9rem",
                    cursor: "pointer",
                    padding: "2px",
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "9px 16px",
                borderRadius: "9px",
                border: "none",
                background: "var(--brand, #2563eb)",
                color: "#ffffff",
                fontSize: "0.86rem",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)",
              }}
            >
              🔍 Tìm kiếm
            </button>
          </form>

          {/* Role Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.84rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              Vai trò:
            </span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "9px",
                border: "1px solid var(--line)",
                background: "var(--canvas)",
                color: "var(--ink)",
                fontSize: "0.85rem",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">Tất cả vai trò</option>
              <option value="admin">Quản trị viên (Admin)</option>
              <option value="analyst">Chuyên viên (Analyst)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.84rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              Tình trạng:
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "9px",
                border: "1px solid var(--line)",
                background: "var(--canvas)",
                color: "var(--ink)",
                fontSize: "0.85rem",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">Tất cả tình trạng</option>
              <option value="active">Đang kích hoạt</option>
              <option value="locked">Đã bị khóa</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "9px",
            border: "1px solid var(--line)",
            background: "var(--canvas)",
            color: "var(--ink)",
            fontSize: "0.84rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🔄 {loading ? "Đang tải…" : "Làm mới"}
        </button>
      </section>

      {/* USER ACCOUNTS TABLE */}
      <section
        style={{
          marginTop: "1.25rem",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1.1rem 1.5rem",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "var(--panel)",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.08rem", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
              Danh sách tài khoản hệ thống ({filteredUsers.length})
            </h2>
            <p style={{ fontSize: "0.82rem", margin: "3px 0 0", color: "var(--muted)" }}>
              Quản trị tài khoản thành viên, giám sát thời gian đăng ký và khóa / xóa tài khoản
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "3rem" }}>
            <LoadingBlock label="Đang nạp danh sách tài khoản hệ thống…" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ padding: "3.5rem", textAlign: "center" }}>
            <span style={{ fontSize: "2.2rem", display: "block", marginBottom: "10px" }}>🔍</span>
            <b style={{ fontSize: "1rem", color: "var(--ink)" }}>Không tìm thấy tài khoản nào</b>
            <p style={{ fontSize: "0.85rem", marginTop: "4px", color: "var(--muted)" }}>
              Hãy thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái.
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                style={{
                  marginTop: "10px",
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: "var(--canvas)",
                  color: "var(--ink)",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                }}
              >
                Xóa tìm kiếm
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "0.88rem",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--canvas)",
                    borderBottom: "1px solid var(--line)",
                    color: "var(--muted)",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <th style={{ padding: "13px 20px" }}>Người dùng</th>
                  <th style={{ padding: "13px 20px" }}>Vai trò</th>
                  <th style={{ padding: "13px 20px" }}>Tình trạng tài khoản</th>
                  <th style={{ padding: "13px 20px" }}>Thời gian đăng ký</th>
                  <th style={{ padding: "13px 20px" }}>Hoạt động gần nhất</th>
                  <th style={{ padding: "13px 20px", textAlign: "right" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelf = u.user_id === currentUserId;
                  const isLocked = u.status === "locked";
                  const isDeleted = u.status === "deleted";
                  const isAdmin = u.role === "admin";
                  const name = u.display_name || (u.email ? u.email.split("@")[0] : "Người dùng");
                  const registeredTime = u.created_at;
                  const lastActiveTime = u.updated_at || u.created_at;

                  return (
                    <tr
                      key={u.user_id}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        background: isDeleted ? "rgba(100, 116, 139, 0.05)" : isLocked ? "rgba(239, 68, 68, 0.03)" : "transparent",
                        transition: "background 0.15s ease",
                      }}
                    >
                      {/* Cột 1: Thông tin người dùng */}
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "42px",
                              height: "42px",
                              borderRadius: "11px",
                              background: isAdmin
                                ? "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
                                : isLocked
                                ? "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)"
                                : "linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: "0.95rem",
                              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
                              flexShrink: 0,
                            }}
                          >
                            {userInitials(u.email || name)}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <b style={{ fontSize: "0.94rem", color: "var(--ink)" }}>
                                {name}
                              </b>
                              {isSelf && (
                                <span
                                  style={{
                                    fontSize: "0.68rem",
                                    padding: "2px 7px",
                                    borderRadius: "5px",
                                    background: "rgba(49, 86, 217, 0.12)",
                                    color: "var(--brand)",
                                    fontWeight: 700,
                                  }}
                                >
                                  Bạn
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                              {u.email || "Chưa có email"}
                            </span>
                            <code
                              style={{
                                fontSize: "0.72rem",
                                color: "var(--muted)",
                                opacity: 0.85,
                              }}
                            >
                              ID: {u.user_id}
                            </code>
                          </div>
                        </div>
                      </td>

                      {/* Cột 2: Vai trò */}
                      <td style={{ padding: "14px 20px" }}>
                        {isAdmin ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "4px 10px",
                              borderRadius: "7px",
                              background: "rgba(168, 85, 247, 0.12)",
                              border: "1px solid rgba(168, 85, 247, 0.3)",
                              color: "#9333ea",
                              fontSize: "0.82rem",
                              fontWeight: 700,
                            }}
                          >
                            🛡️ Admin
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "4px 10px",
                              borderRadius: "7px",
                              background: "rgba(49, 86, 217, 0.1)",
                              border: "1px solid rgba(49, 86, 217, 0.25)",
                              color: "#2563eb",
                              fontSize: "0.82rem",
                              fontWeight: 600,
                            }}
                          >
                            📊 Analyst
                          </span>
                        )}
                      </td>

                      {/* Cột 3: Tình trạng tài khoản */}
                      <td style={{ padding: "14px 20px" }}>
                        {isDeleted ? (
                          <span
                            title="Tài khoản đã xóa không còn quyền truy cập hệ thống."
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "4px 9px",
                              borderRadius: "7px",
                              background: "rgba(100, 116, 139, 0.12)",
                              border: "1px solid rgba(100, 116, 139, 0.28)",
                              color: "#475569",
                              fontSize: "0.82rem",
                              fontWeight: 700,
                              width: "fit-content",
                            }}
                          >
                            Đã xóa
                          </span>
                        ) : isLocked ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 9px",
                                borderRadius: "7px",
                                background: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.28)",
                                color: "#dc2626",
                                fontSize: "0.82rem",
                                fontWeight: 700,
                                width: "fit-content",
                              }}
                            >
                              <span
                                style={{
                                  width: "7px",
                                  height: "7px",
                                  borderRadius: "50%",
                                  background: "#ef4444",
                                }}
                              />
                              Đã bị khóa
                            </span>
                            {u.locked_reason && (
                              <span
                                style={{
                                  fontSize: "0.76rem",
                                  color: "var(--muted)",
                                  maxWidth: "240px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={u.locked_reason}
                              >
                                Lý do: {u.locked_reason}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span
                            title="Tài khoản hợp lệ, chưa bị khóa"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "4px 9px",
                              borderRadius: "7px",
                              background: "rgba(16, 185, 129, 0.12)",
                              border: "1px solid rgba(16, 185, 129, 0.28)",
                              color: "#059669",
                              fontSize: "0.82rem",
                              fontWeight: 600,
                              width: "fit-content",
                            }}
                          >
                            <span
                              style={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                background: "#10b981",
                              }}
                            />
                            Đang kích hoạt
                          </span>
                        )}
                      </td>

                      {/* Cột 4: Thời gian đăng ký */}
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span
                            style={{
                              fontSize: "0.84rem",
                              color: "var(--ink)",
                              fontWeight: 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                            }}
                          >
                            <span style={{ opacity: 0.65 }}>📅</span>
                            {formatFullDateTime(registeredTime)}
                          </span>
                          <span style={{ fontSize: "0.74rem", color: "var(--muted)" }}>
                            ({formatRelativeTime(registeredTime)})
                          </span>
                        </div>
                      </td>

                      {/* Cột 5: Hoạt động gần nhất */}
                      <td style={{ padding: "14px 20px" }}>
                        <span
                          title={lastActiveTime ? new Date(lastActiveTime).toLocaleString("vi-VN") : "Chưa có thông tin"}
                          style={{
                            fontSize: "0.82rem",
                            color: "var(--ink)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span style={{ opacity: 0.6 }}>🕒</span>
                          {formatRelativeTime(lastActiveTime)}
                        </span>
                      </td>

                      {/* Cột 6: Thao tác */}
                      <td style={{ padding: "14px 20px", textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            justifyContent: "flex-end",
                          }}
                        >
                          {/* Nút Khóa / Mở Khóa */}
                          <button type="button" onClick={() => void handleToggleRole(u)} disabled={isSelf || isDeleted || updatingRoleId === u.user_id} title={isSelf ? "Không thể tự hạ quyền" : isDeleted ? "Tài khoản đã xóa" : "Thay đổi vai trò hệ thống"}>
                            {updatingRoleId === u.user_id ? "Đang cập nhật…" : isAdmin ? "Hạ quyền Analyst" : "Nâng quyền Admin"}
                          </button>
                          {isDeleted ? null : isLocked ? (
                            <button
                              type="button"
                              onClick={() => openStatusModal(u)}
                              style={{
                                background: "rgba(16, 185, 129, 0.14)",
                                color: "#059669",
                                border: "1px solid rgba(16, 185, 129, 0.35)",
                                fontSize: "0.82rem",
                                padding: "6px 14px",
                                borderRadius: "8px",
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              🔓 Mở khóa
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openStatusModal(u)}
                              disabled={isSelf || isDeleted}
                              title={
                                isSelf
                                  ? "Không thể tự khóa tài khoản của chính mình"
                                  : "Khóa tài khoản người dùng này"
                              }
                              style={{
                                fontSize: "0.82rem",
                                padding: "6px 14px",
                                borderRadius: "8px",
                                background: "rgba(239, 68, 68, 0.12)",
                                color: "#dc2626",
                                border: "1px solid rgba(239, 68, 68, 0.3)",
                                fontWeight: 700,
                                opacity: isSelf || isDeleted ? 0.45 : 1,
                                cursor: isSelf || isDeleted ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              🔒 Khóa
                            </button>
                          )}

                          {/* Nút Xóa Tài Khoản */}
                          <button
                            type="button"
                            onClick={() => setDeleteModalUser(u)}
                            disabled={isSelf || isDeleted}
                            title={
                              isSelf
                                ? "Không thể tự xóa tài khoản của chính mình"
                                : "Xóa vĩnh viễn tài khoản người dùng này"
                            }
                            style={{
                              fontSize: "0.82rem",
                              padding: "6px 12px",
                              borderRadius: "8px",
                              background: "rgba(239, 68, 68, 0.08)",
                              color: "#dc2626",
                              border: "1px solid rgba(239, 68, 68, 0.22)",
                              fontWeight: 600,
                              opacity: isSelf || isDeleted ? 0.45 : 1,
                              cursor: isSelf || isDeleted ? "not-allowed" : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            🗑️ Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL KHÓA / MỞ KHÓA TÀI KHOẢN */}
      {statusModalUser && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "1.5rem",
          }}
          onClick={() => setStatusModalUser(null)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "18px",
              padding: "1.85rem",
              maxWidth: "500px",
              width: "100%",
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.22)",
              display: "flex",
              flexDirection: "column",
              gap: "1.35rem",
              color: "var(--ink)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "14px",
                  background:
                    statusModalUser.status === "active"
                      ? "rgba(239, 68, 68, 0.12)"
                      : "rgba(16, 185, 129, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.6rem",
                  flexShrink: 0,
                }}
              >
                {statusModalUser.status === "active" ? "🔒" : "🔓"}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "var(--ink)" }}>
                  {statusModalUser.status === "active"
                    ? "Xác nhận khóa tài khoản"
                    : "Xác nhận mở khóa tài khoản"}
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                  Người dùng: <b style={{ color: "var(--ink)" }}>{statusModalUser.email || statusModalUser.user_id}</b>
                </p>
              </div>
            </div>

            {statusModalUser.status === "active" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <p style={{ fontSize: "0.9rem", color: "var(--ink)", lineHeight: 1.5, margin: 0 }}>
                  Khi bị khóa, người dùng này sẽ <b>lập tức bị ngắt kết nối</b> và không thể đăng nhập hoặc thực hiện bất kỳ thao tác nào trên hệ thống.
                </p>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      color: "var(--ink)",
                      marginBottom: "6px",
                    }}
                  >
                    Lý do khóa tài khoản:
                  </label>
                  <textarea
                    rows={3}
                    value={lockReason}
                    onChange={(e) => setLockReason(e.target.value)}
                    placeholder="Nhập lý do khóa tài khoản..."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--line)",
                      background: "var(--canvas)",
                      color: "var(--ink)",
                      fontSize: "0.88rem",
                      resize: "vertical",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "0.9rem", color: "var(--ink)", lineHeight: 1.5, margin: 0 }}>
                Bạn có chắc chắn muốn <b>mở khóa</b> cho tài khoản này? Người dùng sẽ có thể đăng nhập và truy cập workspace bình thường.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => setStatusModalUser(null)}
                disabled={isSubmittingStatus}
                style={{
                  padding: "9px 16px",
                  borderRadius: "9px",
                  border: "1px solid var(--line)",
                  background: "var(--canvas)",
                  color: "var(--ink)",
                  fontWeight: 600,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmStatus()}
                disabled={isSubmittingStatus}
                style={{
                  padding: "9px 18px",
                  borderRadius: "9px",
                  border: "none",
                  background: statusModalUser.status === "active" ? "#dc2626" : "#059669",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  boxShadow: statusModalUser.status === "active" ? "0 4px 12px rgba(220, 38, 38, 0.28)" : "0 4px 12px rgba(5, 150, 105, 0.28)",
                }}
              >
                {isSubmittingStatus
                  ? "Đang xử lý…"
                  : statusModalUser.status === "active"
                  ? "Khóa tài khoản"
                  : "Mở khóa ngay"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL XÓA TÀI KHOẢN */}
      {deleteModalUser && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "1.5rem",
          }}
          onClick={() => setDeleteModalUser(null)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "18px",
              padding: "1.85rem",
              maxWidth: "480px",
              width: "100%",
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.22)",
              display: "flex",
              flexDirection: "column",
              gap: "1.35rem",
              color: "var(--ink)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "14px",
                  background: "rgba(239, 68, 68, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.6rem",
                  flexShrink: 0,
                }}
              >
                🗑️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#dc2626" }}>
                  Xác nhận xóa vĩnh viễn
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                  Tài khoản: <b style={{ color: "var(--ink)" }}>{deleteModalUser.email || deleteModalUser.user_id}</b>
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "var(--ink)", lineHeight: 1.5, margin: 0 }}>
                Hành động này sẽ <b>xóa hoàn toàn</b> tài khoản này khỏi hệ thống cơ sở dữ liệu và xác thực.
              </p>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  fontSize: "0.84rem",
                  color: "#dc2626",
                }}
              >
                ⚠️ <b>Cảnh báo:</b> Dữ liệu và quyền truy cập của người dùng này sẽ bị hủy bỏ vĩnh viễn và không thể hoàn tác.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => setDeleteModalUser(null)}
                disabled={isSubmittingDelete}
                style={{
                  padding: "9px 16px",
                  borderRadius: "9px",
                  border: "1px solid var(--line)",
                  background: "var(--canvas)",
                  color: "var(--ink)",
                  fontWeight: 600,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isSubmittingDelete}
                style={{
                  padding: "9px 18px",
                  borderRadius: "9px",
                  border: "none",
                  background: "#dc2626",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(220, 38, 38, 0.28)",
                }}
              >
                {isSubmittingDelete ? "Đang xóa…" : "Xóa vĩnh viễn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
