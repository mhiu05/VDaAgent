"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import type { SelfSignupRole } from "@/lib/api";

const signupRoles: Array<{ value: SelfSignupRole; label: string; description: string }> = [
  { value: "viewer", label: "Viewer", description: "Xem các báo cáo đã được công bố." },
  { value: "analyst", label: "Analyst", description: "Phân tích dữ liệu và tạo báo cáo nháp." },
  { value: "admin", label: "Admin", description: "Quản lý dữ liệu, thành viên và quy trình." },
];

export default function SignupPage() {
  const [role, setRole] = useState<SelfSignupRole>("analyst");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [registeredRole, setRegisteredRole] = useState<SelfSignupRole | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const signupAllowed = process.env.NEXT_PUBLIC_AUTH_ALLOW_SIGNUP === "true";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!signupAllowed) {
      setError("Đăng ký tài khoản đang tắt. Hãy liên hệ workspace admin để nhận lời mời.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase Auth chưa được cấu hình cho frontend.");
      return;
    }
    const form = new FormData(formElement);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const confirmPassword = String(form.get("confirm-password"));
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const redirect = `${window.location.origin}/auth/callback?requested_role=${encodeURIComponent(role)}`;
    const { data, error: signupError } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirect, data: { requested_role: role } },
    });
    setBusy(false);
    if (signupError) {
      setError(signupError.message);
      return;
    }
    if (data.session) {
      window.location.assign(`/auth/callback?requested_role=${encodeURIComponent(role)}`);
      return;
    }
    setMessage(`Tài khoản đã được tạo với role ${role}. Hãy kiểm tra email để xác nhận; sau đó hệ thống sẽ tự tạo personal workspace và đăng nhập cho bạn.`);
    setRegisteredEmail(email);
    setRegisteredRole(role);
    setResendCooldown(120);
    formElement.reset();
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
    const { error: resendError } = await client.auth.resend({
      type: "signup",
      email: registeredEmail,
      options: { emailRedirectTo: redirect },
    });
    setResendBusy(false);
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
  }

  return <div className="public-page auth-screen">
    <PublicNavbar />
    <main className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Create your workspace identity</p>
        <h1>Bắt đầu với một workspace rõ ràng.</h1>
        <p>Chọn role ngay khi đăng ký. Sau khi xác nhận email, VDaAgent tự tạo một personal workspace riêng và kích hoạt membership cho tài khoản của bạn.</p>
        <div className="auth-trust-list"><span><b>Confirm your email</b><small>Liên kết xác nhận dùng callback an toàn</small></span><span><b>Choose your role</b><small>Role được áp dụng ngay cho workspace riêng</small></span><span><b>Keep data scoped</b><small>Dữ liệu luôn thuộc workspace phù hợp</small></span></div>
      </section>
      <section className="auth-card panel" aria-labelledby="signup-title">
        <div className="auth-card-heading"><p className="eyebrow">VDaAgent account</p><h2 id="signup-title">Đăng ký</h2><p>Tạo tài khoản và chọn role khởi đầu của bạn.</p></div>
        {!signupAllowed && <div className="notice info" role="status"><b>Đăng ký công khai đang tắt</b><p>Workspace hiện nhận thành viên qua invitation. Admin có thể bật <code>AUTH_ALLOW_SIGNUP=true</code> để mở signup.</p></div>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="signup-email">Email<input id="signup-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label htmlFor="signup-password">Mật khẩu<input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={8} placeholder="Tối thiểu 8 ký tự" required /></label>
          <label htmlFor="signup-confirm-password">Xác nhận mật khẩu<input id="signup-confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={8} placeholder="Nhập lại mật khẩu" required /></label>
          <fieldset className="signup-role-field">
            <legend>Role đăng ký</legend>
            <p>Role này chỉ áp dụng cho personal workspace mới của bạn.</p>
            <div className="signup-role-options">
              {signupRoles.map((item) => <label className={`signup-role-option${role === item.value ? " selected" : ""}`} key={item.value}>
                <input type="radio" name="role" value={item.value} checked={role === item.value} onChange={() => setRole(item.value)} />
                <span><b>{item.label}</b><small>{item.description}</small></span>
              </label>)}
            </div>
          </fieldset>
          <p className="auth-password-hint">Dùng mật khẩu dài, riêng biệt và không chia sẻ cho người khác.</p>
          {error && <div className="notice error" role="alert"><b>Không thể tạo tài khoản</b><p>{error}</p></div>}
          {message && <div className="notice success" role="status"><b>Kiểm tra email</b><p>{message}</p>{registeredEmail && <div className="signup-resend"><button className="button secondary" type="button" onClick={() => void resendConfirmation()} disabled={resendBusy || resendCooldown > 0}>{resendBusy ? "Đang gửi lại…" : resendCooldown > 0 ? `Gửi lại sau ${Math.floor(resendCooldown / 60)}:${String(resendCooldown % 60).padStart(2, "0")}` : "Gửi lại email xác nhận"}</button><small>Gmail có thể gộp email mới vào thread cũ; hãy mở rộng thread để xem thư mới nhất.</small></div>}</div>}
          <button className="button primary auth-submit" type="submit" disabled={busy || !signupAllowed}>{busy ? "Đang tạo tài khoản…" : "Đăng ký"}</button>
        </form>
        <p className="auth-switch">Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
      </section>
    </main>
  </div>;
}
