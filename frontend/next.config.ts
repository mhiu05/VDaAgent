import type { NextConfig } from "next";

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
  // Keep dev and production chunks isolated so concurrent commands cannot corrupt `.next`.
  distDir: isDevelopment ? ".next-dev" : ".next",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
