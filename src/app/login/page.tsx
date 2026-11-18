import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusNotice } from "../../components/status-notice";
import { PASSWORD_MIN, parseLoginMode, parseLoginNotice, type LoginMode, type LoginNotice } from "@/lib/auth/email-login";
import { getViewer } from "@/lib/auth/viewer";
import { safeReturnTo } from "@/lib/domain/input";
import { PageMain } from "../_components/page-main";
import { requestPasswordReset, signInWithPassword, signUpWithPassword } from "./actions";
import { PasswordField } from "./password-field";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Tone = "info" | "error" | "warning";
const NOTICE: Record<LoginNotice, { tone: Tone; title: string; body: string }> = {
  invalid_email: { tone: "error", title: "이메일 주소를 확인해 주세요", body: "예: name@example.com" },
  invalid_password: { tone: "error", title: "비밀번호를 확인해 주세요", body: `${PASSWORD_MIN}자 이상으로 정해 주세요. 너무 쉬운 비밀번호는 쓸 수 없습니다.` },
  password_mismatch: { tone: "error", title: "비밀번호 확인이 일치하지 않습니다", body: "같은 비밀번호를 두 번 입력해 주세요." },
  invalid_login: { tone: "error", title: "이메일 또는 비밀번호가 맞지 않습니다", body: "다시 확인해 주세요. 비밀번호가 기억나지 않으면 '비밀번호 찾기'를 이용해 주세요." },
  email_not_confirmed: { tone: "warning", title: "메일 인증이 필요합니다", body: "가입할 때 받은 인증 메일의 링크를 먼저 열어 주세요." },
  signup_sent: {
    tone: "info",
    title: "이메일을 확인해 주세요",
    body: "새로 가입한 주소라면 인증 메일의 링크를 열어 주세요. 이미 가입했다면 로그인하고, 비밀번호가 기억나지 않으면 비밀번호 찾기를 이용해 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.",
  },
  reset_sent: {
    tone: "info",
    title: "비밀번호 재설정 요청을 접수했습니다",
    body: "가입된 주소라면 비밀번호 재설정 메일이 도착합니다. 메일의 링크를 이 브라우저에서 열어 새 비밀번호를 정해 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.",
  },
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
    <Link className="ds-auth-tab" href={modeHref(m, returnTo)} aria-current={mode === m ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="ds-auth-tabs" aria-label="로그인 또는 회원가입">
      {tab("login", "로그인")}
      {tab("signup", "회원가입")}
    </nav>
  );
}

/*
 * DESIGN-LOGIN-PHOTO-SPLIT(주인님 선택 C안): 왼쪽 실사 사진(분위기 연출용) + 오른쪽 폼.
 * DESIGN-LOGIN-A11Y-107: DOM은 폼 패널 → 사진 순서(읽기·초점 순서). 데스크톱 좌우 배치는 CSS grid로 지정.
 * 서버 action·입력 name·검증 속성·안내 문구 체계는 그대로 두고 표현만 바꾼다.
 */
const BIKE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5.5" cy="16.5" r="3.5" />
    <circle cx="18.5" cy="16.5" r="3.5" />
    <path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5h-6.5M15 9l-1.5-3H11" />
  </svg>
);
const MAIL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);
const ARROW_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main ds-auth">
      <div className="ds-container ds-auth-wrap">
        <div className="ds-auth-split">
          <div className="ds-auth-panel">
            <div className="ds-auth-head">
              <span className="ds-auth-badge" aria-hidden="true">{BIKE_ICON}</span>
              <h1>{title}</h1>
              <p>{lead}</p>
            </div>
            {children}
          </div>
          <div className="ds-auth-photo">
            <picture>
              <source srcSet="/images/home/home-hero-gravel-road.webp" type="image/webp" />
              <img src="/images/home/home-hero-gravel-road.jpg" alt="" width={1080} height={1080} decoding="async" />
            </picture>
            <p className="ds-auth-quote">
              길 위의 기록을 <span>함께 지켜봐 주세요.</span>
            </p>
            <p className="ds-auth-photo-sub">가입 후 운영자 승인을 받으면 프로젝트에 참여할 수 있습니다.</p>
            <p className="ds-auth-credit">
              분위기 연출용 사진이며 실제 여정·인물이 아닙니다 · 사진{" "}
              <a href="https://commons.wikimedia.org/wiki/File:Cycling_tourist_with_racks_and_panniers_riding_on_a_gravel_road.jpg" target="_blank" rel="noopener noreferrer">
                Dennis Kleine<span className="ds-visually-hidden"> (Wikimedia Commons, 새 창에서 열림)</span>
              </a>
              {" · "}
              <a href="https://creativecommons.org/licenses/by-sa/2.0/" target="_blank" rel="noopener noreferrer">
                CC BY-SA 2.0<span className="ds-visually-hidden"> 라이선스 (새 창에서 열림)</span>
              </a>
              {" · 크기 조정"}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function EmailField({ id }: { id: string }) {
  return (
    <div className="ds-auth-field">
      <label htmlFor={id}>이메일 주소</label>
      <div className="ds-auth-box">
        {MAIL_ICON}
        <input id={id} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} placeholder="name@example.com" />
      </div>
    </div>
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
      <AuthShell title="비밀번호 찾기" lead="가입한 이메일 주소를 입력하면 비밀번호를 다시 정할 수 있는 링크를 보내 드립니다.">
        {noticeBox}
        <form action={requestPasswordReset} className="ds-auth-form">
          <EmailField id="reset-email" />
          <button className="ds-auth-submit" type="submit">
            재설정 메일 받기 {ARROW_ICON}
          </button>
        </form>
        <p className="ds-auth-foot">
          <Link className="ds-text-link" href={modeHref("login", returnTo)}>
            로그인으로 돌아가기
          </Link>
        </p>
      </AuthShell>
    );
  }

  const signup = mode === "signup";
  return (
    <AuthShell
      title={signup ? "회원가입" : "로그인"}
      lead={signup ? "이메일로 가입하세요. 인증 메일을 확인한 뒤 운영자 승인을 거칩니다." : "이메일과 비밀번호로 로그인하세요."}
    >
      <ModeTabs mode={mode} returnTo={returnTo} />
      {noticeBox}
      {signup ? (
        <form action={signUpWithPassword} className="ds-auth-form">
          <input type="hidden" name="returnTo" value={returnTo} />
          <EmailField id="signup-email" />
          <PasswordField
            id="signup-password"
            label="비밀번호"
            name="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            maxLength={72}
            placeholder={`${PASSWORD_MIN}자 이상`}
            help={`${PASSWORD_MIN}자 이상으로 정해 주세요. 너무 쉬운 비밀번호는 쓸 수 없습니다.`}
          />
          <div className="ds-auth-sep" aria-hidden="true" />
          <PasswordField
            id="signup-password-confirm"
            label="비밀번호 확인"
            name="passwordConfirm"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            maxLength={72}
            placeholder="비밀번호를 한 번 더 입력하세요"
          />
          <button className="ds-auth-submit" type="submit">
            회원가입 {ARROW_ICON}
          </button>
          <p className="ds-auth-foot">가입하면 인증 메일이 갑니다. 인증 후 운영자 승인을 받으면 참여할 수 있습니다.</p>
        </form>
      ) : (
        <form action={signInWithPassword} className="ds-auth-form">
          <input type="hidden" name="returnTo" value={returnTo} />
          <EmailField id="login-email" />
          <PasswordField id="login-password" label="비밀번호" name="password" autoComplete="current-password" required maxLength={1024} placeholder="비밀번호" />
          <p className="ds-auth-row">
            <Link className="ds-text-link" href={modeHref("reset", returnTo)}>
              비밀번호 찾기
            </Link>
          </p>
          <button className="ds-auth-submit" type="submit">
            로그인 {ARROW_ICON}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
