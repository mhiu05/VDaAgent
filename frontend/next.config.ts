import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function readRootEnv(): Record<string, string> {
  const envPath = [
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(__dirname, "..", ".env"),
    path.resolve(process.cwd(), ".env"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!envPath) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const rootEnv = readRootEnv();
const publicEnv = {
  // The frontend may use the backend variable names from the root .env. Only
  // these low-privilege/public values are forwarded into the browser bundle.
  NEXT_PUBLIC_SUPABASE_URL: rootEnv.NEXT_PUBLIC_SUPABASE_URL || rootEnv.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: rootEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || rootEnv.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  NEXT_PUBLIC_SITE_URL: rootEnv.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  NEXT_PUBLIC_AUTH_ALLOW_SIGNUP: rootEnv.NEXT_PUBLIC_AUTH_ALLOW_SIGNUP || rootEnv.AUTH_ALLOW_SIGNUP || process.env.NEXT_PUBLIC_AUTH_ALLOW_SIGNUP || "false",
  NEXT_PUBLIC_AUTH_ALLOW_GUEST: rootEnv.NEXT_PUBLIC_AUTH_ALLOW_GUEST || rootEnv.AUTH_ALLOW_GUEST || process.env.NEXT_PUBLIC_AUTH_ALLOW_GUEST || "false",
  NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED: process.env.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED || rootEnv.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED || rootEnv.UX_COMMAND_CENTER_ENABLED || "false",
  NEXT_PUBLIC_API_URL: rootEnv.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
};

const isDevelopment = process.env.NODE_ENV !== "production";

const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])].join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      `default-src 'self'; connect-src 'self' http://localhost:8000 http://127.0.0.1:8000 http://localhost:8001 http://127.0.0.1:8001 https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; font-src 'self' data:; frame-ancestors 'none'`,
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  env: publicEnv,
  // Keep dev and production chunks isolated so concurrent commands cannot corrupt `.next`.
  distDir: isDevelopment ? ".next-dev" : ".next",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
