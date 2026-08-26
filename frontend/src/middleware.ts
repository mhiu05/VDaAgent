import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = new Set([
  "/",
  "/health",
  "/about",
  "/guide",
  "/docs",
  "/contact",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/forgot-password",
  "/auth/callback",
  "/auth/confirm",
  "/account/update-password",
]);
const guestAllowed = process.env.NEXT_PUBLIC_AUTH_ALLOW_GUEST === "true";
const appPaths = ["/workspaces", "/reports", "/chat", "/datasets", "/profiles", "/compare"];

function isStaticAsset(pathname: string): boolean {
  return pathname.startsWith("/img/") || pathname === "/favicon.ico" || pathname === "/robots.txt";
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  // The backend remains the authorization boundary. Keeping app routes
  // reachable here lets the browser establish either a Supabase session or
  // an isolated guest session instead of redirecting trial users to /login.
  const isAppPath = appPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
  if (publicPaths.has(url.pathname) || isStaticAsset(url.pathname) || isAppPath || guestAllowed || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    const login = new URL("/login", request.url);
    const next = `${url.pathname}${url.search}`;
    if (next.startsWith("/") && !next.startsWith("//")) login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"] };
