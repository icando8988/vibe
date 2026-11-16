import type { Metadata, Viewport } from "next";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import "./globals.css";
import "../styles/design.css";

export const metadata: Metadata = {
  title: {
    default: "세계일주·출판 프로젝트 (가칭)",
    template: "%s | 세계일주·출판 프로젝트 (가칭)",
  },
  description: "자전거 세계일주 도전과 출판 여정을 기록하는 프로젝트 사이트 — 비공개 개발 단계",
  // 비공개 개발 단계: 검색 노출 금지. 공개 승인(RELEASE-001) 시 해제.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// 각 라우트가 main#main-content를 하나만 제공한다(홈·책 목록은 UI 컴포넌트가 직접 포함).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
