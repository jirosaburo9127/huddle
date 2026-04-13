import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@supabase/supabase-js", "@supabase/ssr"],
  // 画像最適化: Supabase Storageのリモート画像を許可
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "emfngqketrieioxusuhg.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 本番では 'unsafe-eval' を外す（React本番ビルドは eval 不使用）。
              // dev では Turbopack の HMR が eval を使うため許可する。
              // 'unsafe-inline' を完全除去するにはnonceベース+全ページ動的化が必要で、
              // 静的生成のLPと相性が悪いため一旦据え置き（#todo 将来的に検討）。
              process.env.NODE_ENV === "development"
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              // jsdelivr は PDFエクスポートで Noto Sans JP OTF を初回取得するため許可
              "connect-src 'self' https://emfngqketrieioxusuhg.supabase.co wss://emfngqketrieioxusuhg.supabase.co https://cdn.jsdelivr.net",
              "img-src 'self' https://emfngqketrieioxusuhg.supabase.co data: blob:",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' https://fonts.gstatic.com",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
