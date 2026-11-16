import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { decideAccess, getViewer } from "@/lib/auth/viewer";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "내 참여", robots: { index: false, follow: false } };
// 개인 데이터 경로: 정적 생성·공유 캐시 금지
export const dynamic = "force-dynamic";

export default async function MyPage() {
  const viewer = await getViewer();
  const access = decideAccess(viewer, "approved_member");

  if (!access.allowed) {
    const title =
      access.reason === "auth_not_configured"
        ? "로그인 기능이 아직 연결되지 않았습니다"
        : access.reason === "pending_approval"
          ? "회원 승인 대기 중입니다"
          : "로그인이 필요합니다";
    return (
      <PageMain title="내 참여">
        <StatusNotice tone="warning" title={title}>
          <p>내 참여 내역은 본인 확인 후에만 볼 수 있습니다.</p>
        </StatusNotice>
        <div className="ds-actions">
          <Link className="ds-button ds-button--secondary" href="/login?returnTo=%2Fme">
            회원 이용 안내로 이동
          </Link>
        </div>
      </PageMain>
    );
  }

  // DEV-004/006: 본인 참여 내역 조회(RLS 본인 행만) 연결 예정.
  return (
    <PageMain title="내 참여">
      <p>참여 내역이 없습니다.</p>
    </PageMain>
  );
}
