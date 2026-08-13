"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { PublicNavbar } from "@/components/public-navbar";
import { getSupabaseBrowserClient } from "@/lib/auth/client";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) { setError("Supabase Auth chưa được cấu hình cho frontend."); return; }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const { error: signInError } = await client.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (signInError) { setError(signInError.message); return; }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return <div className="public-page auth-screen">
    <PublicNavbar />
    <main className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Welcome back</p>
        <h1>Đăng nhập để tiếp tục phân tích.</h1>
        <p>Truy cập workspace, dataset, profile và các phân tích đã được lưu theo membership của bạn.</p>
        <div className="auth-trust-list"><span><b>Evidence-first</b><small>Con số đến từ compute engine</small></span><span><b>Workspace-aware</b><small>Quyền được kiểm tra ở backend</small></span><span><b>Privacy by design</b><small>Không export raw rows</small></span></div>
      </section>
      <section className="auth-card panel" aria-labelledby="login-title">
        <div className="auth-card-heading"><p className="eyebrow">P-170 account</p><h2 id="login-title">Đăng nhập</h2><p>Đăng nhập bằng email và mật khẩu Supabase của bạn.</p></div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label htmlFor="login-password">Mật khẩu<input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Nhập mật khẩu" required /></label>
          <div className="auth-form-meta"><span>Secure sign-in with Supabase</span><Link href="/forgot-password">Quên mật khẩu?</Link></div>
          {error && <div className="notice error" role="alert"><b>Không thể đăng nhập</b><p>{error}</p></div>}
          <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? "Đang xác thực…" : "Đăng nhập"}</button>
        </form>
        <p className="auth-switch">Chưa có tài khoản? <Link href="/signup">Đăng ký</Link></p>
  </section>
  </main>
  </div>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="page auth-page"><p>Đang mở màn hình đăng nhập…</p></main>}><LoginForm /></Suspense>;
}
