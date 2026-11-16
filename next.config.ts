import type { NextConfig } from "next";

// 개인/운영 데이터가 생길 경로는 공유 캐시에 저장되지 않도록 명시한다.
const privateNoStore = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/me/:path*", headers: privateNoStore },
      { source: "/me", headers: privateNoStore },
      { source: "/admin/:path*", headers: privateNoStore },
      { source: "/admin", headers: privateNoStore },
      { source: "/login", headers: privateNoStore },
      { source: "/auth/:path*", headers: privateNoStore },
      { source: "/api/:path*", headers: privateNoStore },
    ];
  },
};

export default nextConfig;
