"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import type { SelfSignupRole } from "@/lib/api";
import { LoadingButton } from "@/components/ui";

export default function SignupPage() {
  const role: SelfSignupRole = "analyst";
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [registeredRole, setRegisteredRole] = useState<SelfSignupRole | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const signupAllowed = process.env.NEXT_PUBLIC_AUTH_ALLOW_SIGNUP === "true";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signupAllowed) {
      setError("Đăng ký tài khoản đang tắt. Hãy liên hệ workspace để nhận lời mời.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase Auth chưa được cấu hình cho frontend.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const confirmPassword = String(formData.get("confirm-password"));
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const redirect = `${window.location.origin}/auth/callback?requested_role=${encodeURIComponent(role)}`;
    try {
      const { data, error: signupError } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirect, data: { requested_role: role } },
      });
      if (signupError) {
        setError(signupError.message);
        return;
      }
      if (data.session) {
        window.location.assign(`/auth/callback?requested_role=${encodeURIComponent(role)}`);
        return;
      }
      setMessage("Hãy kiểm tra email để xác nhận; sau đó hệ thống sẽ tự tạo personal workspace và đăng nhập cho bạn.");
      setRegisteredEmail(email);
      setRegisteredRole(role);
      setResendCooldown(120);
      formRef.current?.reset();
    } catch (signupException) {
      setError(signupException instanceof Error ? signupException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!registeredEmail || !registeredRole || resendBusy || resendCooldown > 0) return;
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase Auth chưa được cấu hình cho frontend.");
      return;
    }
    setResendBusy(true);
    setError(null);
    const redirect = `${window.location.origin}/auth/callback?requested_role=${encodeURIComponent(registeredRole)}`;
    try {
      const { error: resendError } = await client.auth.resend({
        type: "signup",
        email: registeredEmail,
        options: { emailRedirectTo: redirect },
      });
      if (resendError) {
        const status = "status" in resendError ? resendError.status : undefined;
        const rawMessage = resendError.message.toLowerCase();
        if (status === 429 || rawMessage.includes("rate limit") || rawMessage.includes("too many")) {
          setError("Supabase đang giới hạn số email xác thực. Với SMTP mặc định, project có thể chỉ gửi khoảng 2 email mỗi giờ; hãy chờ thêm hoặc cấu hình SMTP riêng.");
        } else {
          setError(resendError.message);
        }
        return;
      }
      const sentAt = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      setMessage(`Supabase đã nhận yêu cầu gửi lại email tới ${registeredEmail} lúc ${sentAt}. Hãy kiểm tra Inbox, Spam và Promotions.`);
      setResendCooldown(120);
    } catch (resendException) {
      setError(resendException instanceof Error ? resendException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
    } finally {
      setResendBusy(false);
    }
  }

  return <div className="public-page auth-screen">
    <PublicNavbar />
    <main className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Tham gia VDaAgent</p>
        <h1>Tạo không gian làm việc của bạn.</h1>
        <p>Đăng ký tài khoản để bắt đầu phân tích. Sau khi xác nhận email, VDaAgent sẽ cấp phát ngay một workspace cá nhân dành riêng cho bạn.</p>
        <div className="auth-trust-list"><span><b>Xác thực an toàn</b><small>Liên kết xác nhận an toàn qua email</small></span><span><b>Không gian cá nhân</b><small>Không gian làm việc riêng biệt và bảo mật</small></span><span><b>Sẵn sàng phân tích</b><small>Đầy đủ công cụ upload, profile và xuất báo cáo</small></span></div>
      </section>
      <section className="auth-card panel" aria-labelledby="signup-title">
        <div className="auth-card-heading"><p className="eyebrow">TÀI KHOẢN VDaAgent</p><h2 id="signup-title">Đăng ký</h2><p>Tạo tài khoản để bắt đầu phân tích trong không gian làm việc.</p></div>
        {!signupAllowed && <div className="notice info" role="status"><b>Đăng ký công khai đang tắt</b><p>Workspace hiện nhận thành viên qua invitation. Có thể bật <code>AUTH_ALLOW_SIGNUP=true</code> để mở signup.</p></div>}
        <form ref={formRef} className="auth-form" onSubmit={submit}>
          <label htmlFor="signup-email">Email<input id="signup-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label htmlFor="signup-password">Mật khẩu<input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={8} placeholder="Tối thiểu 8 ký tự" required /></label>
          <label htmlFor="signup-confirm-password">Xác nhận mật khẩu<input id="signup-confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={8} placeholder="Nhập lại mật khẩu" required /></label>
          <p className="auth-password-hint">Dùng mật khẩu dài, riêng biệt và không chia sẻ cho người khác.</p>
          {error && <div className="notice error" role="alert"><b>Không thể tạo tài khoản</b><p>{error}</p></div>}
          {message && <div className="notice success" role="status"><b>Kiểm tra email</b><p>{message}</p>{registeredEmail && <div className="signup-resend"><button className="button secondary" type="button" onClick={() => void resendConfirmation()} disabled={resendBusy || resendCooldown > 0}>{resendBusy ? "Đang gửi lại…" : resendCooldown > 0 ? `Gửi lại sau ${Math.floor(resendCooldown / 60)}:${String(resendCooldown % 60).padStart(2, "0")}` : "Gửi lại email xác nhận"}</button><small>Kiểm tra thư rác hoặc spam nếu chưa nhận được.</small></div>}</div>}
          <LoadingButton className="button primary auth-submit" type="submit" busy={busy} disabled={!signupAllowed}>{busy ? "Đang tạo tài khoản…" : "Đăng ký"}</LoadingButton>
        </form>
        <p className="auth-switch">Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
      </section>
    </main>
  </div>;
}
