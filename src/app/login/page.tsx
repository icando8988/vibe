import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { safeReturnTo } from "@/lib/domain/input";
import { getIntegrationStatus } from "@/lib/env";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "회원 이용 안내" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReturn = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnTo(rawReturn);
  const status = getIntegrationStatus();

  return (
    <PageMain eyebrow="회원" title="회원 이용 안내">
      {!status.authConnected ? (
        <>
          <StatusNotice tone="warning" title="로그인은 아직 연결되지 않았습니다">
            <p>이메일·카카오 로그인이 연결되기 전에는 회원 가입과 로그인을 받을 수 없습니다.</p>
          </StatusNotice>
          {returnTo !== "/" ? (
            <p>
              로그인이 연결되면 보던 화면(<code>{returnTo}</code>)으로 돌아가도록 준비하고 있습니다.
            </p>
          ) : null}
          <p>가입 후에는 운영자 승인을 거쳐 참여할 수 있게 할 예정입니다.</p>
          <div className="ds-actions">
            <Link className="ds-text-link" href="/how-it-works">
              참여 흐름 자세히 보기 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </>
      ) : null}
    </PageMain>
  );
}
