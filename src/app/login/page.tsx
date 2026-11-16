import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { parseLoginNotice } from "@/lib/auth/email-login";
import { getViewer } from "@/lib/auth/viewer";
import { safeReturnTo } from "@/lib/domain/input";
import { PageMain } from "../_components/page-main";
import { sendLoginLink } from "./actions";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NOTICE = {
  sent: { tone: "info", title: "로그인 메일을 보냈습니다", body: "입력한 주소로 받은 메일의 링크를 이 브라우저에서 열어 주세요. 메일이 오지 않으면 잠시 후 다시 시도해 주세요." },
  invalid_email: { tone: "error", title: "이메일 주소를 확인해 주세요", body: "예: name@example.com" },
  unavailable: { tone: "error", title: "지금은 메일을 보낼 수 없습니다", body: "잠시 후 다시 시도해 주세요." },
  callback_failed: { tone: "error", title: "로그인 링크를 확인하지 못했습니다", body: "링크가 만료됐거나 다른 브라우저에서 열렸을 수 있습니다. 메일을 다시 받아 주세요." },
  signed_out: { tone: "info", title: "로그아웃했습니다", body: "" },
} as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReturn = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnTo(rawReturn, "/me");
  const notice = parseLoginNotice(params.notice);
  const viewer = await getViewer();

  if (viewer.kind === "anonymous" && viewer.reason === "auth_not_configured") {
    return (
      <PageMain eyebrow="회원" title="로그인">
        <StatusNotice tone="warning" title="로그인은 아직 연결되지 않았습니다">
          <p>로그인이 연결되기 전에는 회원 가입과 로그인을 받을 수 없습니다.</p>
        </StatusNotice>
      </PageMain>
    );
  }

  if (viewer.kind === "member") {
    return (
      <PageMain eyebrow="회원" title="로그인됨">
        <p>이미 로그인되어 있습니다.</p>
        <div className="ds-actions">
          <Link className="ds-button ds-button--primary" href={returnTo}>
            계속하기
          </Link>
          <form action="/auth/signout" method="post">
            <button className="ds-button ds-button--secondary" type="submit">
              로그아웃
            </button>
          </form>
        </div>
      </PageMain>
    );
  }

  const n = notice ? NOTICE[notice] : null;
  return (
    <PageMain eyebrow="회원" title="로그인 · 가입">
      {n ? (
        <StatusNotice tone={n.tone} title={n.title} announce>
          {n.body ? <p>{n.body}</p> : null}
        </StatusNotice>
      ) : null}
      <p>이메일로 로그인 링크를 보내 드립니다. 처음이면 같은 방법으로 가입되며, 운영자 승인 후 참여할 수 있습니다.</p>
      <form action={sendLoginLink} className="ds-editor-fields">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label htmlFor="login-email">이메일</label>
        <input id="login-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
        <div className="ds-actions">
          <button className="ds-button ds-button--primary" type="submit">
            로그인 링크 받기
          </button>
        </div>
      </form>
      <p className="ds-muted">카카오 로그인은 준비 중입니다.</p>
    </PageMain>
  );
}
