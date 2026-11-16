import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { decideAccess, getViewer } from "@/lib/auth/viewer";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "내 참여", robots: { index: false, follow: false } };
// 개인 데이터 경로: 정적 생성·공유 캐시 금지
export const dynamic = "force-dynamic";

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className="ds-button ds-button--secondary" type="submit">
        로그아웃
      </button>
    </form>
  );
}

export default async function MyPage() {
  const viewer = await getViewer();
  const access = decideAccess(viewer, "approved_member");

  if (!access.allowed) {
    if (access.reason === "pending_approval" || access.reason === "forbidden") {
      const pending = access.reason === "pending_approval";
      return (
        <PageMain title="내 참여">
          <StatusNotice tone={pending ? "info" : "warning"} title={pending ? "회원 승인 대기 중입니다" : "참여할 수 없는 계정 상태입니다"}>
            <p>
              {pending
                ? "가입이 접수되었습니다. 운영자가 승인하면 참여 내역을 볼 수 있습니다."
                : "계정 상태 때문에 참여 기능을 쓸 수 없습니다. 문의가 필요하면 운영자에게 연락해 주세요."}
            </p>
          </StatusNotice>
          <div className="ds-actions">
            <SignOut />
          </div>
        </PageMain>
      );
    }
    const title = access.reason === "auth_not_configured" ? "로그인 기능이 아직 연결되지 않았습니다" : "로그인이 필요합니다";
    return (
      <PageMain title="내 참여">
        <StatusNotice tone="warning" title={title}>
          <p>내 참여 내역은 본인 확인 후에만 볼 수 있습니다.</p>
        </StatusNotice>
        <div className="ds-actions">
          <Link className="ds-button ds-button--secondary" href="/login?returnTo=%2Fme">
            로그인하기
          </Link>
        </div>
      </PageMain>
    );
  }

  // DEV-006: 본인 참여 내역 조회(RLS 본인 행만) 연결 예정.
  return (
    <PageMain title="내 참여">
      <p>참여 내역이 없습니다.</p>
      <div className="ds-actions">
        <SignOut />
      </div>
    </PageMain>
  );
}
