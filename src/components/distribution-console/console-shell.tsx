import Link from "next/link";
import type { ReactNode } from "react";
import { PageMain } from "@/app/_components/page-main";
import { StatusNotice } from "../status-notice";
import type { DistributionDenyReason } from "./access";
import { CONSOLE_NAV, type ConsoleSection } from "./nav";

export type { ConsoleSection };

/**
 * 거부 화면. 콘솔 메뉴·건수·운영 데이터 구조를 노출하지 않는다.
 */
export function DistributionDenied({ reason }: { reason: DistributionDenyReason }) {
  const message: Record<DistributionDenyReason, string> = {
    auth_not_configured: "관리자 인증이 아직 연결되지 않았습니다. 이 화면은 관리자 확인 후에만 열립니다.",
    unauthenticated: "로그인한 관리자만 이용할 수 있습니다.",
    forbidden: "관리자 권한이 필요합니다.",
    not_approved: "콘텐츠 배포는 승인된 관리자만 이용할 수 있습니다. 계정 승인 상태를 확인해 주세요.",
  };
  return (
    <PageMain title="관리자 전용">
      <StatusNotice tone="warning" title="관리자 확인이 필요합니다">
        <p>{message[reason]}</p>
        {reason === "unauthenticated" ? <p><Link className="ds-text-link" href="/login">회원 이용 안내로 이동</Link></p> : null}
      </StatusNotice>
    </PageMain>
  );
}

function NavGroups({ section, isRoot }: { section: ConsoleSection; isRoot: boolean }) {
  return (
    <>
      {CONSOLE_NAV.map((group) => (
        <div key={group.label} className="dc-nav-group">
          <p className="dc-nav-label">{group.label}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} aria-current={item.key === section ? (isRoot ? "page" : "true") : undefined}>
                  <span className="dc-nav-mark" aria-hidden="true">
                    {item.mark}
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * 승인된 관리자에게만 렌더하는 콘솔 셸(디자인 A — 콘텐츠 중심, AUTOPOST-DESIGN-A-013).
 * 페이지마다 접근 판정(D1) 후 호출한다. 단일 main 랜드마크(#main-content).
 * 구조: 경로·상태 줄 → (모바일) 접이식 메뉴 → [왼쪽 메뉴 | 페이지 머리(eyebrow·h1·설명·대표 행동) → gate 안내 → 본문]
 * 모든 콘솔 스타일은 `.dc-console` 아래에 두어 공통 design.css(.ds-main h1 등)보다 의도적으로 우선한다(DQ-01).
 */
export function ConsoleShell({
  section,
  isRoot = false,
  title,
  eyebrow,
  description,
  actions,
  crumbs = [],
  gateNotice,
  children,
}: {
  section: ConsoleSection;
  isRoot?: boolean;
  title: string;
  /** 제목 위 작은 분류 문구(A안 eyebrow) */
  eyebrow?: string;
  /** 제목 아래 한 줄 설명 */
  description?: ReactNode;
  /** 페이지 머리 오른쪽 대표 행동(링크·비활성 버튼). 실제 동작이 없으면 넣지 않는다. */
  actions?: ReactNode;
  crumbs?: ReadonlyArray<{ href?: string; label: string }>;
  /**
   * 기본 "준비 전·실제 게시 gate 닫힘" 안내 대신 쓸 화면별 안내(R010-06).
   * 실제로 동작하는 관리 기능(예: 토큰 관리)이 있는 화면이 그 결과를 샘플로 부정하지 않도록 한다. live gate 안내는 유지해야 한다.
   */
  gateNotice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main dc-console">
      <div className="dc-frame">
        <div className="dc-topline">
          <nav aria-label="현재 위치" className="dc-bread">
            <Link href="/admin">관리</Link>
            <span aria-hidden="true">/</span>
            <Link href="/admin/distribution">콘텐츠 배포</Link>
            {crumbs.map((c) => (
              <span key={c.label} className="dc-bread-item">
                <span aria-hidden="true">/</span>
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
          <span className="dc-status-chip">
            <span className="dc-status-dot" aria-hidden="true" />
            실제 게시 gate 닫힘
          </span>
        </div>
        <details className="dc-mobile-nav">
          <summary>콘텐츠 배포 메뉴 · 현재: {title}</summary>
          <nav aria-label="콘텐츠 배포 메뉴(모바일)">
            <NavGroups section={section} isRoot={isRoot} />
          </nav>
        </details>
        <div className="dc-shell">
          <aside className="dc-sidebar">
            <p className="dc-brand">
              콘텐츠 배포
              <small>원문 하나에서 세 채널로</small>
            </p>
            <nav aria-label="콘텐츠 배포 메뉴">
              <NavGroups section={section} isRoot={isRoot} />
            </nav>
            <p className="dc-aside-note">공통 원문을 채널마다 따로 검토합니다. 계정·실적·성공 데이터는 표시하지 않습니다.</p>
          </aside>
          <div className="dc-content">
            <header className="dc-pagehead">
              <div>
                {eyebrow ? <p className="dc-eyebrow">{eyebrow}</p> : null}
                <h1>{title}</h1>
                {description ? <p className="dc-lead">{description}</p> : null}
              </div>
              {actions ? <div className="dc-pagehead-actions">{actions}</div> : null}
            </header>
            {gateNotice ?? (
              <StatusNotice tone="warning" title="준비 전 · 실제 게시 gate 닫힘">
                <p>원문·초안 저장과 작업 실행은 아직 연결되지 않았습니다. 이 화면의 입력·버튼은 동작하지 않으며, 표시되는 상태는 실제 작업 결과가 아닙니다.</p>
              </StatusNotice>
            )}
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
