/**
 * 콘텐츠 배포 콘솔 전용 접근 판정 (AUTOPOST-CONSOLE-UI-001, 통합 플랜 D1).
 * 배포 권한 = admin 역할 AND profiles.approval_status = approved.
 *
 * 기존 decideAccess(viewer, "admin")는 admin 역할만 본다. 그 의미는 바꾸지 않고
 * 이 콘솔에서만 승인 상태를 추가로 검사한다. 서버 컴포넌트에서만 호출한다
 * (getViewer가 Supabase 서버 검증과 RLS 하의 본인 행을 사용).
 *
 * 화면 판정은 1차 방어일 뿐이다. 후속 조회·저장 RPC와 RLS도 같은 조건을 다시 검사해야 한다.
 */
import { decideAccess, getViewer, type Viewer } from "@/lib/auth/viewer";

export type DistributionDenyReason = "auth_not_configured" | "unauthenticated" | "forbidden" | "not_approved";

export type DistributionAccess = { allowed: true } | { allowed: false; reason: DistributionDenyReason };

/** 순수 판정. 알 수 없는 경우는 거부한다. */
export function decideDistributionAccess(viewer: Viewer): DistributionAccess {
  const admin = decideAccess(viewer, "admin");
  if (!admin.allowed) {
    if (admin.reason === "auth_not_configured" || admin.reason === "unauthenticated") {
      return { allowed: false, reason: admin.reason };
    }
    return { allowed: false, reason: "forbidden" };
  }
  if (viewer.kind !== "member" || viewer.approval !== "approved") {
    return { allowed: false, reason: "not_approved" };
  }
  return { allowed: true };
}

/**
 * 회원 영역(/me)의 "관리" 진입 링크 노출 여부(DQ-04). 서버에서 같은 D1 판정으로만 보인다.
 * 일반 회원·비로그인·비승인 admin에게는 링크도, 운영 데이터도 보이지 않는다. 링크가 있어도 /admin·콘솔은 각자 다시 판정한다.
 */
export function showAdminEntry(viewer: Viewer): boolean {
  return decideDistributionAccess(viewer).allowed;
}

/** 요청마다 viewer를 서버에서 다시 읽어 판정한다. */
export async function getDistributionAccess(): Promise<DistributionAccess> {
  return decideDistributionAccess(await getViewer());
}
