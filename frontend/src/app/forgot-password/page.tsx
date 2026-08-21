"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { PublicNavbar } from "@/components/public-navbar";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Chưa cấu hình Supabase Auth.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account/update-password`,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setMessage("Nếu email hợp lệ, liên kết đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư của bạn.");
    } catch (resetException) {
      setError(resetException instanceof Error ? resetException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-page auth-screen">
      <PublicNavbar />
      <main className="auth-layout">
        <section className="auth-intro">
          <p className="eyebrow">Khôi phục tài khoản</p>
          <h1>Quên mật khẩu?</h1>
          <p>Đừng lo lắng. Hãy nhập email của bạn và chúng tôi sẽ gửi liên kết bảo mật để đặt lại mật khẩu, giúp bạn truy cập lại workspace nhanh chóng.</p>
          <div className="auth-trust-list">
            <span><b>Liên kết an toàn</b><small>Liên kết chỉ gửi trực tiếp đến email đăng ký của bạn</small></span>
            <span><b>Mật khẩu bảo mật</b><small>VDaAgent không lưu trữ mật khẩu chưa mã hóa</small></span>
          </div>
        </section>
        <section className="auth-card panel" aria-labelledby="forgot-title">
          <div className="auth-card-heading">
            <p className="eyebrow">VDaAgent Account</p>
            <h2 id="forgot-title">Đặt lại mật khẩu</h2>
            <p>Nhập email liên kết với tài khoản của bạn.</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="reset-email">Email
              <input id="reset-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
            </label>
            {error && <div className="notice error" role="alert"><b>Lỗi gửi liên kết</b><p>{error}</p></div>}
            {message && <div className="notice success" role="status"><b>Kiểm tra email</b><p>{message}</p></div>}
            <button className="button primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Đang xử lý…" : "Gửi liên kết khôi phục"}
            </button>
          </form>
          <p className="auth-switch">Nhớ mật khẩu? <Link href="/login">Quay lại đăng nhập</Link></p>
        </section>
      </main>
    </div>
  );
}
