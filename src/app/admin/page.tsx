import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { decideDistributionAccess } from "@/components/distribution-console/access";
import { decideAccess, getViewer } from "@/lib/auth/viewer";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "관리", robots: { index: false, follow: false } };
// 운영 데이터 경로: 정적 생성·공유 캐시 금지
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewer();
  const access = decideAccess(viewer, "admin");

  if (!access.allowed) {
    // 운영 데이터·건수·관리 메뉴 구조를 노출하지 않는다.
    return (
      <PageMain title="관리자 전용">
        <StatusNotice tone="warning" title="관리자 확인이 필요합니다">
          <p>
            {access.reason === "auth_not_configured"
              ? "관리자 인증이 아직 연결되지 않았습니다. 이 화면은 관리자 확인 후에만 열립니다."
              : "관리자 권한이 필요합니다."}
          </p>
        </StatusNotice>
      </PageMain>
    );
  }

  // 콘텐츠 배포 진입 카드는 D1(admin + 승인됨)일 때만 보인다. 승인되지 않은 admin에게는 메뉴 존재도 숨긴다.
  const distribution = decideDistributionAccess(viewer);

  // DEV-007: 승인 대기·입금 대기·알림 실패 요약 (서버에서 역할 재확인 후 조회)
  return (
    <PageMain title="관리">
      <p>관리 기능은 DEV-007에서 연결합니다.</p>
      {distribution.allowed ? (
        <section aria-labelledby="admin-distribution" className="dc-admin-entry">
          <h2 id="admin-distribution">콘텐츠 배포</h2>
          <p>
            <span className="ds-tag">실제 게시 gate 닫힘</span>
          </p>
          <p>
            원문 하나로 Blog·Threads·Instagram 초안을 준비·검토하는 콘솔입니다. Blog는 수동 게시와 증거 기록, Threads는 계정 연결과 모의 실행 작업, Instagram은 초안·미디어 권리까지 쓸 수 있습니다. 자동 게시·예약은 열려 있지 않습니다.
          </p>
          <Link className="ds-text-link" href="/admin/distribution">
            콘텐츠 배포 콘솔 열기
          </Link>
        </section>
      ) : null}
    </PageMain>
  );
}
