"use client";

import { useEffect, useState, useRef, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { PageHeader, LoadingBlock, StatusBadge, Notice } from "@/components/ui";

function accountInitials(nameOrEmail: string | null) {
  const value = (nameOrEmail || "AN").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return value.slice(0, 2).toUpperCase() || "AN";
}

interface UserProfileData {
  fullName: string;
  age: string;
  gender: "nam" | "nu" | "khac" | "";
  occupation: string;
  phone: string;
  bio: string;
  avatarUrl: string;
}

export default function AccountPage() {
  const { me, authenticated, isGuest, loading, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const user = me?.user;
  const storageKey = `p170_user_profile_${user?.id || "guest"}`;

  // Form State
  const [profile, setProfile] = useState<UserProfileData>({
    fullName: "",
    age: "",
    gender: "",
    occupation: "",
    phone: "",
    bio: "",
    avatarUrl: "",
  });

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load saved profile on mount
  useEffect(() => {
    if (!user && !isGuest) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setProfile(JSON.parse(stored));
      } else {
        // Defaults
        const emailName = (user?.email || "").split("@")[0] || "";
        setProfile((prev) => ({
          ...prev,
          fullName: emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1) : "Chuyên viên phân tích",
        }));
      }
    } catch {
      // ignore
    }
  }, [storageKey, user, isGuest]);

  // Handle avatar upload
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("Kích thước hình ảnh tối đa là 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfile((prev) => ({ ...prev, avatarUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    setProfile((prev) => {
      const next = { ...prev, avatarUrl: "" };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        window.dispatchEvent(new Event("p170-profile-updated"));
      } catch {
        // ignore
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Handle submit
  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify(profile));
      window.dispatchEvent(new Event("p170-profile-updated"));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch {
      alert("Không thể lưu thông tin vào bộ nhớ trình duyệt.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Đang tải thông tin hồ sơ…" />;

  const displayAvatar = profile.avatarUrl;
  const displayName = profile.fullName || user?.email || (isGuest ? "Khách dùng thử" : "Analyst");

  return (
    <main className="page account-page">
      <PageHeader
        title="Hồ sơ tài khoản"
        description="Quản lý và cập nhật thông tin cá nhân, tuổi, ngành nghề, giới tính, hình đại diện và phân quyền workspace."
      />

      {savedSuccess && (
        <div style={{ marginTop: "1rem" }}>
          <Notice tone="success">
            <b>Đã lưu thông tin hồ sơ thành công!</b> Thông tin cá nhân của bạn đã được cập nhật.
          </Notice>
        </div>
      )}

      <div className="grid two" style={{ marginTop: "1.2rem", gap: "1.5rem", alignItems: "start" }}>
        {/* FORM CẬP NHẬT THÔNG TIN CÁ NHÂN */}
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="panel-title">
            <h2>Chỉnh sửa hồ sơ</h2>
            <StatusBadge status={authenticated ? "completed" : "pending"} />
          </div>

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* AVATAR SECTION */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "18px",
                padding: "12px 16px",
                background: "rgba(56, 189, 248, 0.05)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                borderRadius: "12px",
              }}
            >
              <div style={{ position: "relative" }}>
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt="Ảnh đại diện"
                    style={{
                      width: "72px",
                      height: "72px",
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "2px solid #0ea5e9",
                      boxShadow: "0 4px 12px rgba(14, 165, 233, 0.3)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "72px",
                      height: "72px",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      boxShadow: "0 4px 12px rgba(14, 165, 233, 0.3)",
                    }}
                  >
                    {accountInitials(displayName)}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <b style={{ fontSize: "0.95rem" }}>Hình ảnh đại diện</b>
                <span className="muted" style={{ fontSize: "0.76rem" }}>
                  Hỗ trợ định dạng JPG, PNG, GIF (Tối đa 2MB)
                </span>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📷 Thay đổi ảnh
                  </button>
                  {displayAvatar && (
                    <button
                      type="button"
                      className="button danger small"
                      onClick={handleRemoveAvatar}
                    >
                      Xóa ảnh
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    style={{ display: "none" }}
                  />
                </div>
              </div>
            </div>

            {/* FIELDS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                  Họ và tên
                </label>
                <input
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                  placeholder="Ví dụ: Phạm Thế Đăng"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                    Tuổi
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={profile.age}
                    onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                    placeholder="Ví dụ: 25"
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                    Giới tính
                  </label>
                  <select
                    value={profile.gender}
                    onChange={(e) => setProfile({ ...profile, gender: e.target.value as UserProfileData["gender"] })}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <option value="">-- Chọn giới tính --</option>
                    <option value="nam">Nam</option>
                    <option value="nu">Nữ</option>
                    <option value="khac">Khác / Không tiết lộ</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                  Ngành nghề / Vị trí chuyên môn
                </label>
                <input
                  type="text"
                  value={profile.occupation}
                  onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
                  placeholder="Ví dụ: Data Scientist / Data Analyst / Kỹ sư AI"
                  list="occupation-suggestions"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.9rem",
                  }}
                />
                <datalist id="occupation-suggestions">
                  <option value="Data Analyst / Chuyên viên phân tích dữ liệu" />
                  <option value="Data Scientist / Nhà khoa học dữ liệu" />
                  <option value="Data Engineer / Kỹ sư dữ liệu" />
                  <option value="Business Analyst (BA) / Phân tích nghiệp vụ" />
                  <option value="Kỹ sư phần mềm / Lập trình viên" />
                  <option value="Quản trị cơ sở dữ liệu (DBA)" />
                  <option value="Tài chính / Kế toán / Ngân hàng" />
                  <option value="Sinh viên / Nhà nghiên cứu" />
                </datalist>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                  Số điện thoại liên hệ
                </label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  placeholder="Ví dụ: 0987654321"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                  Giới thiệu ngắn (Bio)
                </label>
                <textarea
                  rows={3}
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  placeholder="Mô tả mục tiêu phân tích dữ liệu hoặc chuyên môn của bạn..."
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.9rem",
                    resize: "vertical",
                  }}
                />
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "0.5rem" }}>
              <button
                type="submit"
                disabled={isSaving}
                className="button primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 22px",
                  fontSize: "0.92rem",
                  fontWeight: 700,
                }}
              >
                💾 {isSaving ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        </section>

        {/* THÔNG TIN TÀI KHOẢN & WORKSPACE */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* TỔNG QUAN TÀI KHOẢN */}
          <section className="panel">
            <div className="panel-title">
              <h2>Thông tin đăng nhập</h2>
              <span className="chip" style={{ fontSize: "0.75rem" }}>Bảo mật</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span className="muted">Email đăng nhập:</span>
                <b>{user?.email || "Chưa thiết lập"}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span className="muted">Mã tài khoản ID:</span>
                <code style={{ fontSize: "0.78rem" }}>{user?.id || "guest-session"}</code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span className="muted">Vai trò hệ thống:</span>
                <b>
                  {me?.workspace.role === "admin"
                    ? "🛡️ Quản trị viên (Admin)"
                    : "📊 Chuyên viên (Analyst)"}
                </b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span className="muted">Trạng thái:</span>
                <span style={{ color: "#10b981", fontWeight: 600 }}>● Đang hoạt động</span>
              </div>
            </div>

            <div style={{ marginTop: "1.5rem", display: "flex", gap: "10px" }}>
              <Link href="/account/update-password" className="button secondary">
                🔑 Đổi mật khẩu
              </Link>
              <button
                type="button"
                className="button danger"
                onClick={() => void signOut()}
              >
                Đăng xuất
              </button>
            </div>
          </section>

          {/* WORKSPACE THAM GIA */}
          <section className="panel">
            <div className="panel-title">
              <h2>Workspace tham gia</h2>
              <Link href="/workspaces" className="button secondary small">
                Quản lý →
              </Link>
            </div>

            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Danh sách các workspace bạn có quyền truy cập và phân tích dữ liệu:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "1rem" }}>
              {me?.workspaces && me.workspaces.length > 0 ? (
                me.workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--card-bg, rgba(255, 255, 255, 0.03))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <b style={{ fontSize: "0.95rem", display: "block" }}>🏢 {ws.name}</b>
                      <small className="muted">ID: {ws.id}</small>
                    </div>
                    <span className="chip" style={{ fontSize: "0.75rem" }}>
                      {ws.role || "Member"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted">Không có danh sách workspace bổ sung.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
