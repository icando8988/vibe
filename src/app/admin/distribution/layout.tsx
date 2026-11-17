import type { Metadata } from "next";
import type { ReactNode } from "react";

// 하위 모든 콘솔 화면: 색인 금지. Cache-Control private/no-store는 next.config의 /admin/:path* 규칙이 적용된다.
// 접근 판정은 layout이 아니라 각 page에서 한다(하위 이동 시 layout이 다시 렌더되지 않을 수 있음).
export const metadata: Metadata = {
  title: { default: "콘텐츠 배포", template: "%s · 콘텐츠 배포" },
  robots: { index: false, follow: false },
};

export default function DistributionLayout({ children }: { children: ReactNode }) {
  return children;
}
