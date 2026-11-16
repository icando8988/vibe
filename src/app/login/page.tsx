import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { PASSWORD_MIN, parseLoginMode, parseLoginNotice, type LoginMode, type LoginNotice } from "@/lib/auth/email-login";
import { getViewer } from "@/lib/auth/viewer";
import { safeReturnTo } from "@/lib/domain/input";
import { PageMain } from "../_components/page-main";
import { requestPasswordReset, signInWithPassword, signUpWithPassword } from "./actions";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Tone = "info" | "error" | "warning";
const NOTICE: Record<LoginNotice, { tone: Tone; title: string; body: string }> = {
  invalid_email: { tone: "error", title: "이메일 주소를 확인해 주세요", body: "예: name@example.com" },
  invalid_password: { tone: "error", title: "비밀번호를 확인해 주세요", body: `${PASSWORD_MIN}자 이상으로 정해 주세요. 너무 쉬운 비밀번호는 쓸 수 없습니다.` },
  password_mismatch: { tone: "error", title: "비밀번호 확인이 일치하지 않습니다", body: "같은 비밀번호를 두 번 입력해 주세요." },
  invalid_login: { tone: "error", title: "이메일 또는 비밀번호가 맞지 않습니다", body: "다시 확인해 주세요. 비밀번호가 기억나지 않으면 '비밀번호 찾기'를 이용해 주세요." },
  email_not_confirmed: { tone: "warning", title: "메일 인증이 필요합니다", body: "가입할 때 받은 인증 메일의 링크를 먼저 열어 주세요." },
  signup_sent: { tone: "info", title: "인증 메일을 보냈습니다", body: "메일의 링크를 이 브라우저에서 열면 가입이 끝납니다. 이미 가입한 주소라면 로그인해 주세요." },
  reset_sent: { tone: "info", title: "비밀번호 재설정 메일을 보냈습니다", body: "가입된 주소라면 메일이 도착합니다. 링크를 이 브라우저에서 열어 새 비밀번호를 정해 주세요." },
  password_updated: { tone: "info", title: "비밀번호를 바꿨습니다", body: "" },
  rate_limited: { tone: "error", title: "요청이 너무 많습니다", body: "잠시 후 다시 시도해 주세요." },
  unavailable: { tone: "error", title: "지금은 처리할 수 없습니다", body: "잠시 후 다시 시도해 주세요." },
  callback_failed: { tone: "error", title: "메일 링크를 확인하지 못했습니다", body: "링크가 만료됐거나 다른 브라우저에서 열렸을 수 있습니다. 다시 요청해 주세요." },
  signed_out: { tone: "info", title: "로그아웃했습니다", body: "" },
};

function modeHref(mode: LoginMode, returnTo: string): string {
  const q = new URLSearchParams();
  if (mode !== "login") q.set("mode", mode);
  if (returnTo !== "/me") q.set("returnTo", returnTo);
  const s = q.toString();
  return s ? `/login?${s}` : "/login";
}

function ModeTabs({ mode, returnTo }: { mode: LoginMode; returnTo: string }) {
  const tab = (m: LoginMode, label: string) => (
    <Link
      className={`ds-button ${mode === m ? "ds-button--primary" : "ds-button--secondary"}`}
      href={modeHref(m, returnTo)}
      aria-current={mode === m ? "page" : undefined}
    >
      {label}
    </Link>
  );
  return (
    <nav className="ds-actions" aria-label="로그인 또는 회원가입">
      {tab("login", "로그인")}
      {tab("signup", "회원가입")}
    </nav>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReturn = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnTo(rawReturn, "/me");
  const mode = parseLoginMode(params.mode);
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
  const noticeBox = n ? (
    <StatusNotice tone={n.tone} title={n.title} announce>
      {n.body ? <p>{n.body}</p> : null}
    </StatusNotice>
  ) : null;

  if (mode === "reset") {
    return (
      <PageMain eyebrow="회원" title="비밀번호 찾기">
        {noticeBox}
        <p>가입한 이메일 주소를 입력하면 비밀번호를 다시 정할 수 있는 링크를 보내 드립니다.</p>
        <form action={requestPasswordReset} className="ds-editor-fields">
          <label htmlFor="reset-email">이메일 주소</label>
          <input id="reset-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
          <div className="ds-actions">
            <button className="ds-button ds-button--primary" type="submit">
              재설정 메일 받기
            </button>
          </div>
        </form>
        <p>
          <Link className="ds-text-link" href={modeHref("login", returnTo)}>
            로그인으로 돌아가기
          </Link>
        </p>
      </PageMain>
    );
  }

  const signup = mode === "signup";
  return (
    <PageMain eyebrow="회원" title={signup ? "회원가입" : "로그인"}>
      <ModeTabs mode={mode} returnTo={returnTo} />
      {noticeBox}
      {signup ? (
        <form action={signUpWithPassword} className="ds-editor-fields">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="signup-email">이메일 주소</label>
          <input id="signup-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
          <label htmlFor="signup-password">비밀번호</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            maxLength={72}
            aria-describedby="signup-password-help"
          />
          <p id="signup-password-help" className="ds-muted">
            {PASSWORD_MIN}자 이상
          </p>
          <label htmlFor="signup-password-confirm">비밀번호 확인</label>
          <input
            id="signup-password-confirm"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            maxLength={72}
          />
          <div className="ds-actions">
            <button className="ds-button ds-button--primary" type="submit">
              회원가입
            </button>
          </div>
          <p className="ds-muted">가입하면 인증 메일이 갑니다. 인증 후 운영자 승인을 받으면 참여할 수 있습니다.</p>
        </form>
      ) : (
        <form action={signInWithPassword} className="ds-editor-fields">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="login-email">이메일 주소</label>
          <input id="login-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
          <p>
            <Link className="ds-text-link" href={modeHref("reset", returnTo)}>
              비밀번호 찾기
            </Link>
          </p>
          <div className="ds-actions">
            <button className="ds-button ds-button--primary" type="submit">
              로그인
            </button>
          </div>
        </form>
      )}
    </PageMain>
  );
}
