"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { clearSupabaseLocalSession, getSupabaseBrowserClient } from "@/lib/auth/client";
import { LoadingButton } from "@/components/ui";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/workspaces";
}

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A rejected/expired local session must not survive on the login screen
    // and get picked up by the global auth provider during Fast Refresh.
    clearSupabaseLocalSession();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) { setError("Supabase Auth chưa được cấu hình cho frontend."); return; }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: String(formData.get("email")).trim(),
        password: String(formData.get("password")),
      });
      if (signInError) { setError(signInError.message); return; }
      if (!data.session) {
        setError("Đăng nhập chưa tạo được phiên làm việc. Hãy thử lại.");
        return;
      }
      // A full navigation lets the app bootstrap using the session Supabase
      // has just written to browser storage. Calling router.refresh() right
      // after router.replace() could refresh the current /login route instead.
      window.location.assign(safeNext(params.get("next")));
    } catch (signInException) {
      setError(signInException instanceof Error ? signInException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="public-page auth-screen">
    <PublicNavbar />
    <main className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Chào mừng bạn</p>
        <h1>Đăng nhập để tiếp tục phân tích.</h1>
        <p>Truy cập workspace, dataset, profile và các phân tích đã được lưu theo membership của bạn.</p>
        <div className="auth-trust-list"><span><b>Tính minh bạch cao</b><small>Mọi con số đều có dẫn chứng cụ thể</small></span><span><b>Không gian cá nhân hóa</b><small>Khả năng tùy chỉnh workspace theo từng lĩnh vực</small></span><span><b>Bảo mật dữ liệu gốc</b><small>Dữ liệu thô luôn được bảo vệ an toàn</small></span></div>
      </section>
      <section className="auth-card panel" aria-labelledby="login-title">
        <div className="auth-card-heading"><p className="eyebrow">Tài khoản VDaAgent</p><h2 id="login-title">Đăng nhập</h2><p>Đăng nhập bằng email và mật khẩu của bạn.</p></div>
        {params.get("reason") === "session_expired" && <div className="notice warning" role="status"><b>Phiên đăng nhập đã hết hạn</b><p>Hãy đăng nhập lại để tiếp tục làm việc với workspace.</p></div>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label htmlFor="login-password">Mật khẩu<input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Nhập mật khẩu" required /></label>
          <div className="auth-form-meta" style={{ justifyContent: 'flex-end' }}><Link href="/forgot-password">Quên mật khẩu?</Link></div>
          {error && <div className="notice error" role="alert"><b>Sai email hoặc mật khẩu</b><p>{error}</p></div>}
          <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "1rem" }}>
              <LoadingButton className="button primary auth-submit" type="submit" busy={busy} style={{ flex: 1, margin: 0 }}>
                {busy ? "Đang xác thực…" : "Đăng nhập"}
              </LoadingButton>
            <Link 
              href="/admin" 
              className="button secondary" 
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", margin: 0 }}
            >
              Vào nhanh /admin
            </Link>
          </div>
        </form>
        <p className="auth-switch">Chưa có tài khoản? <Link href="/signup">Đăng ký</Link></p>
      </section>
    </main>
  </div>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="page auth-page"><p>Đang mở màn hình đăng nhập…</p></main>}><LoginForm /></Suspense>;
}
