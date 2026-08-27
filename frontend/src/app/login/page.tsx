"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { LoadingButton } from "@/components/ui";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/workspaces";
}

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryingBootstrap, setRetryingBootstrap] = useState(false);
  const [phase, setPhase] = useState<"idle" | "submitting" | "authenticated" | "redirecting">("idle");

  async function retryBootstrap() {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase Auth chưa được cấu hình cho frontend.");
      return;
    }
    setRetryingBootstrap(true);
    setError(null);
    try {
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError || !data.session) {
        setError("Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.");
        return;
      }
      router.replace(safeNext(params.get("next")));
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Không thể thử mở workspace lại.");
    } finally {
      setRetryingBootstrap(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) { setError("Supabase Auth chưa được cấu hình cho frontend."); return; }
    setBusy(true);
    setPhase("submitting");
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: String(formData.get("email")).trim(),
        password: String(formData.get("password")),
      });
      if (signInError) { setError(signInError.message); setPhase("idle"); return; }
      if (!data.session) {
        setError("Đăng nhập chưa tạo được phiên làm việc. Hãy thử lại.");
        return;
      }
      try {
        window.sessionStorage.setItem("p170-login-notification-v1", JSON.stringify({ ts: new Date().toISOString() }));
      } catch {
        // A blocked sessionStorage must not prevent a successful login.
      }
      // signInWithPassword has persisted the session before resolving. Keep
      // the provider mounted while navigating so the workspace bootstrap can
      // consume that session without a second click or a blank full reload.
      setPhase("authenticated");
      setPhase("redirecting");
      router.replace(safeNext(params.get("next")));
    } catch (signInException) {
      setError(signInException instanceof Error ? signInException.message : "Không thể kết nối dịch vụ xác thực. Hãy thử lại.");
      setPhase("idle");
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
        {params.get("reason") === "bootstrap_failed" && <div className="notice warning" role="status"><b>Đã đăng nhập nhưng chưa mở được workspace</b><p>Phiên vẫn hợp lệ. Hãy thử lại; lỗi này không phải do mật khẩu.</p><button className="button secondary" type="button" onClick={() => void retryBootstrap()} disabled={retryingBootstrap}>{retryingBootstrap ? "Đang thử lại…" : "Thử mở workspace lại"}</button></div>}
        <div className="auth-card-heading"><p className="eyebrow">Tài khoản VDaAgent</p><h2 id="login-title">Đăng nhập</h2><p>Đăng nhập bằng email và mật khẩu của bạn.</p></div>
        {params.get("reason") === "session_expired" && <div className="notice warning" role="status"><b>Phiên đăng nhập đã hết hạn</b><p>Hãy đăng nhập lại để tiếp tục làm việc với workspace.</p></div>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label htmlFor="login-password">Mật khẩu<input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Nhập mật khẩu" required /></label>
          <div className="auth-form-meta" style={{ justifyContent: 'flex-end' }}><Link href="/forgot-password">Quên mật khẩu?</Link></div>
          {error && <div className="notice error" role="alert"><b>Đăng nhập không thành công</b><p>{error}</p></div>}
          <LoadingButton className="button primary auth-submit" type="submit" busy={busy} style={{ width: "100%", marginTop: "1rem" }}>
            {busy ? (phase === "redirecting" ? "Đang chuyển hướng…" : "Đang đăng nhập…") : "Đăng nhập"}
          </LoadingButton>
          <p className="auth-role-note">Vai trò được xác định tự động sau khi đăng nhập. Tài khoản quản trị hệ thống sẽ được chuyển đến khu vực quản trị; chuyên viên phân tích sẽ vào không gian làm việc của mình.</p>
          {busy && <p role="status" aria-live="polite" className="auth-progress">{phase === "redirecting" ? "Đang chuyển hướng…" : "Đang xác thực tài khoản…"}</p>}
        </form>
        <p className="auth-switch">Chưa có tài khoản? <Link href="/signup">Đăng ký</Link></p>
      </section>
    </main>
  </div>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="page auth-page"><p>Đang mở màn hình đăng nhập…</p></main>}><LoginForm /></Suspense>;
}
