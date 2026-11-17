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
      { source: "/login/:path*", headers: privateNoStore },
      { source: "/auth/:path*", headers: privateNoStore },
      { source: "/api/:path*", headers: privateNoStore },
      // OAuth 시작·callback: 인증 code·state가 쿼리에 실린 주소가 Referer로 새지 않게 한다.
      // 같은 키는 뒤 항목이 앞 항목을 덮으므로 전역 strict-origin-when-cross-origin보다 뒤에 둔다(DRYRUN-EXEC-020).
      { source: "/api/distribution/oauth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
