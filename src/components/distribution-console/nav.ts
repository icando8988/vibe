/**
 * 콘텐츠 배포 콘솔 메뉴 모델(디자인 A, AUTOPOST-DESIGN-A-013). 순수 데이터 — 테스트 대상.
 * A안: "작업 공간"(원문 중심 흐름)과 "연결과 운영" 두 묶음. 원문이 모든 채널의 시작점이다.
 * 글감·AI 생성, 캠페인 등 구현되지 않은 기능은 메뉴에 넣지 않는다(가짜 진입 금지).
 */
export type ConsoleSection = "overview" | "contents" | "jobs" | "media" | "connections" | "extension";

export type NavItem = { key: ConsoleSection; href: string; label: string; mark: string };
export type NavGroup = { label: string; items: readonly NavItem[] };

export const CONSOLE_NAV: readonly NavGroup[] = [
  {
    label: "작업 공간",
    items: [
      { key: "overview", href: "/admin/distribution", label: "통합 개요", mark: "▦" },
      { key: "contents", href: "/admin/distribution/contents", label: "콘텐츠 보관함", mark: "≡" },
      { key: "jobs", href: "/admin/distribution/jobs", label: "예약·작업", mark: "▤" },
      { key: "media", href: "/admin/distribution/media", label: "미디어·권리", mark: "□" },
    ],
  },
  {
    label: "연결과 운영",
    items: [
      { key: "connections", href: "/admin/distribution/connections", label: "연결·준비도", mark: "○" },
      { key: "extension", href: "/admin/distribution/connections/blog-extension", label: "Blog 확장 연결", mark: "↗" },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = CONSOLE_NAV.flatMap((g) => g.items);

/** A안 대표 흐름(통합 개요·원문 상세에 같은 단계로 표시). 실행 결과가 아니라 순서 안내다. */
export const CONTENT_FLOW: readonly string[] = ["원문 작성", "채널 초안", "채널별 검토·승인", "개별 실행 준비"];
