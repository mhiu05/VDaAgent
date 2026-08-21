import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  browserClient = url && key ? createBrowserClient(url, key) : null;
  return browserClient;
}

/** Remove only the browser-local Supabase auth artifacts.
 * This intentionally avoids `auth.signOut({ scope: "local" })`: some
 * supabase-js versions still call /auth/v1/logout for that option, which can
 * produce a misleading 403 when the access token has already expired.
 */
export function clearSupabaseLocalSession(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("sb-") && (key.includes("auth-token") || key.includes("code-verifier"))) {
      window.localStorage.removeItem(key);
    }
  }
}
