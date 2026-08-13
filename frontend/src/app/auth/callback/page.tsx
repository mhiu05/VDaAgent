"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { provisionSelfSignup, type SelfSignupRole } from "@/lib/api";

const validRoles: SelfSignupRole[] = ["viewer", "analyst", "admin"];

function AuthCallbackContent() {
  const params = useSearchParams();
  const [message, setMessage] = useState("Đang hoàn tất phiên đăng nhập…");

  useEffect(() => {
    let cancelled = false;
    async function finish() {
      const client = getSupabaseBrowserClient();
      const requestedRole = params.get("requested_role");
      const role = validRoles.includes(requestedRole as SelfSignupRole) ? requestedRole as SelfSignupRole : null;
      if (!client) {
        setMessage("Supabase Auth chưa được cấu hình cho frontend.");
        return;
      }
      const code = params.get("code");
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
          setMessage(error.message);
          return;
        }
      }
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const session = sessionData.session;
      if (sessionError || !session) {
        setMessage(sessionError?.message ?? "Liên kết xác thực không hợp lệ hoặc phiên đã hết hạn.");
        return;
      }
      if (!role) {
        window.location.assign("/dashboard");
        return;
      }
      try {
        await provisionSelfSignup(role, session.access_token);
        if (!cancelled) window.location.assign("/dashboard");
      } catch (provisionError) {
        if (!cancelled) setMessage(provisionError instanceof Error ? provisionError.message : "Không thể tạo workspace cho tài khoản.");
      }
    }
    void finish();
    return () => { cancelled = true; };
  }, [params]);

  return <main className="page auth-page"><p>{message}</p></main>;
}

export default function AuthCallbackPage() {
  return <Suspense fallback={<main className="page auth-page"><p>Đang hoàn tất phiên đăng nhập…</p></main>}><AuthCallbackContent /></Suspense>;
}
