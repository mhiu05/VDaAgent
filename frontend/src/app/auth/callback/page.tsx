"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { provisionSelfSignup, type SelfSignupRole } from "@/lib/api";

const validRoles: SelfSignupRole[] = ["analyst"];

function AuthCallbackContent() {
  const params = useSearchParams();
  const [message, setMessage] = useState("Đang hoàn tất phiên đăng nhập…");

  useEffect(() => {
    let cancelled = false;
    async function finish() {
      const client = getSupabaseBrowserClient();
      const requestedRole = params.get("requested_role");
      const requestedRoleFromUrl = validRoles.includes(requestedRole as SelfSignupRole) ? requestedRole as SelfSignupRole : null;
      if (!client) {
        setMessage("Supabase Auth chưa được cấu hình cho frontend.");
        return;
      }
      // createBrowserClient enables detectSessionInUrl, so Supabase exchanges
      // the PKCE code during client initialization. Calling
      // exchangeCodeForSession here as well would consume the verifier twice
      // and surface "PKCE code verifier not found in storage".
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const session = sessionData.session;
      if (sessionError || !session) {
        setMessage(sessionError?.message ?? "Liên kết xác thực không hợp lệ hoặc phiên đã hết hạn.");
        return;
      }
      const metadataRole = session.user.user_metadata?.requested_role;
      const role = requestedRoleFromUrl
        ?? (validRoles.includes(metadataRole as SelfSignupRole) ? metadataRole as SelfSignupRole : null)
        // Older confirmation links did not carry requested_role. Provision a
        // safe default so those accounts do not land in a workspace-less state.
        ?? "analyst";
      try {
        await provisionSelfSignup(role, session.access_token);
        if (!cancelled) window.location.assign("/workspaces");
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
