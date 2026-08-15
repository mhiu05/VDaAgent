"use client";

import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/auth/client";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const client = getSupabaseBrowserClient(); if (!client) { setMessage("Chưa cấu hình Supabase Auth."); return; } const email = String(new FormData(event.currentTarget).get("email")); await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account/update-password` }); setMessage("Nếu email hợp lệ, liên kết đặt lại mật khẩu đã được gửi."); }
  return <section className="page auth-page"><h1>Đặt lại mật khẩu</h1><form className="panel" onSubmit={submit}><label>Email<input name="email" type="email" required /></label><button className="button primary">Gửi liên kết</button></form>{message && <p>{message}</p>}</section>;
}
