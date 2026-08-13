"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/auth/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const client = getSupabaseBrowserClient(); if (!client) { setError("Chưa cấu hình Supabase Auth."); return; } const password = String(new FormData(event.currentTarget).get("password")); const { error: updateError } = await client.auth.updateUser({ password }); if (updateError) { setError(updateError.message); return; } router.replace("/dashboard"); }
  return <section className="page auth-page"><h1>Đặt mật khẩu mới</h1><form className="panel" onSubmit={submit}><label>Mật khẩu mới<input name="password" type="password" minLength={8} required /></label>{error && <p role="alert">{error}</p>}<button className="button primary">Lưu mật khẩu</button></form></section>;
}
