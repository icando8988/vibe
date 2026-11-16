import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../../components/status-notice";
import { PASSWORD_MIN, parseLoginNotice } from "@/lib/auth/email-login";
import { getViewer } from "@/lib/auth/viewer";
import { PageMain } from "../../_components/page-main";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "새 비밀번호", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NOTICE = {
  invalid_password: `${PASSWORD_MIN}자 이상, 이전과 다른 비밀번호로 정해 주세요.`,
  password_mismatch: "같은 비밀번호를 두 번 입력해 주세요.",
  unavailable: "지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
} as const;

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = parseLoginNotice(params.notice);
  const message = notice && notice in NOTICE ? NOTICE[notice as keyof typeof NOTICE] : null;
  const viewer = await getViewer();

  if (viewer.kind !== "member") {
    return (
      <PageMain eyebrow="회원" title="새 비밀번호">
        <StatusNotice tone="warning" title="재설정 링크로 들어와 주세요">
          <p>비밀번호 재설정 메일의 링크를 이 브라우저에서 열면 새 비밀번호를 정할 수 있습니다.</p>
        </StatusNotice>
        <p>
          <Link className="ds-text-link" href="/login?mode=reset">
            재설정 메일 다시 받기
          </Link>
        </p>
      </PageMain>
    );
  }

  return (
    <PageMain eyebrow="회원" title="새 비밀번호">
      {message ? (
        <StatusNotice tone="error" title="비밀번호를 바꾸지 못했습니다" announce>
          <p>{message}</p>
        </StatusNotice>
      ) : null}
      <form action={updatePassword} className="ds-editor-fields">
        <label htmlFor="new-password">새 비밀번호</label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={72}
          aria-describedby="new-password-help"
        />
        <p id="new-password-help" className="ds-muted">
          {PASSWORD_MIN}자 이상
        </p>
        <label htmlFor="new-password-confirm">새 비밀번호 확인</label>
        <input id="new-password-confirm" name="passwordConfirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={72} />
        <div className="ds-actions">
          <button className="ds-button ds-button--primary" type="submit">
            비밀번호 저장
          </button>
        </div>
      </form>
    </PageMain>
  );
}
