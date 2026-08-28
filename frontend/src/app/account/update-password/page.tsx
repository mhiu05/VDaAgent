"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { LoadingButton } from "@/components/ui";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password"));
    const confirmation = String(formData.get("confirmation"));
    if (password !== confirmation) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase Auth chưa được cấu hình cho frontend.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setMessage("Mật khẩu mới đã được lưu. Bạn sẽ được chuyển về workspace.");
      window.setTimeout(() => router.replace("/workspaces"), 600);
    } catch (updateException) {
      setError(updateException instanceof Error ? updateException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="public-page auth-screen">
    <PublicNavbar />
    <main className="auth-layout">
      <section className="auth-intro"><p className="eyebrow">Bảo mật tài khoản</p><h1>Đặt mật khẩu mới.</h1><p>Chọn mật khẩu mới có ít nhất 8 ký tự. Liên kết trong email chỉ dùng được trong thời gian giới hạn.</p></section>
      <section className="auth-card panel" aria-labelledby="update-password-title">
        <div className="auth-card-heading"><p className="eyebrow">VDaAgent Account</p><h2 id="update-password-title">Đặt lại mật khẩu</h2><p>Nhập và xác nhận mật khẩu mới cho tài khoản của bạn.</p></div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="new-password">Mật khẩu mới<input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} placeholder="Tối thiểu 8 ký tự" required /></label>
          <label htmlFor="confirm-new-password">Xác nhận mật khẩu<input id="confirm-new-password" name="confirmation" type="password" autoComplete="new-password" minLength={8} placeholder="Nhập lại mật khẩu" required /></label>
          {error && <div className="notice error" role="alert"><b>Chưa thể đổi mật khẩu</b><p>{error}</p></div>}
          {message && <div className="notice success" role="status"><b>Đã cập nhật mật khẩu</b><p>{message}</p></div>}
          <LoadingButton className="button primary auth-submit" type="submit" busy={busy}>{busy ? "Đang lưu…" : "Lưu mật khẩu mới"}</LoadingButton>
        </form>
        <p className="auth-switch">Đã nhớ mật khẩu? <Link href="/login">Quay lại đăng nhập</Link></p>
      </section>
    </main>
  </div>;
}
