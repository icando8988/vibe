import Link from "next/link";
import { StatusNotice } from "@/components/status-notice";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { DisabledAction } from "@/components/distribution-console/states";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { listExtensionTokens, type TokenSummary } from "@/server/distribution/blog/token-service";
import { DISPLAY_TZ_LABEL, formatKst, formatLastUsed } from "./format";
import { RevokeTokenButton } from "./revoke-button";
import { TokenIssuePanel } from "./token-issue-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog 확장 연결" };

/**
 * Blog 확장(네이버 블로그 입력기) 연결 토큰 관리(AUTOPOST-BLOG-TOKEN-005, UX-FIX-008).
 * 서버 키·DB가 준비되지 않으면 준비 전 상태만 보인다(가짜 목록·발급 성공 없음).
 * 토큰 유효 ≠ 확장 연결 성공 ≠ 인계 준비 완료(BC-06). 단계별로 현재 근거만 표시한다.
 */
const NOTICE: Record<string, { tone: "info" | "error" | "warning"; title: string; text: string }> = {
  revoked: {
    tone: "info",
    title: "토큰을 철회했습니다",
    text: "이 토큰을 쓰는 확장의 다음 인증부터 거부됩니다. 이미 입력·게시된 내용은 그대로입니다.",
  },
  already_revoked: { tone: "warning", title: "이미 철회된 토큰입니다", text: "목록에서 상태를 확인하세요." },
  not_found: { tone: "error", title: "토큰을 찾지 못했습니다", text: "목록을 다시 확인하세요." },
  denied: { tone: "error", title: "권한이 없습니다", text: "승인된 관리자만 철회할 수 있습니다. 로그인 상태를 확인하세요." },
  not_ready: { tone: "warning", title: "연결 준비 전", text: "서버 연결 준비 전이라 처리하지 않았습니다." },
  invalid: { tone: "error", title: "요청 값이 올바르지 않습니다", text: "목록에서 다시 시도하세요." },
  uncertain: {
    tone: "warning",
    title: "철회 결과를 확인해야 합니다",
    text: "요청은 전달됐을 수 있지만 결과를 받지 못했습니다. 아래 목록에서 해당 토큰의 상태를 확인하세요.",
  },
  failed: { tone: "error", title: "처리하지 못했습니다", text: "서버가 요청을 거절했습니다. 목록을 확인하세요." },
};

const STATE_LABEL: Record<TokenSummary["state"], string> = { active: "유효", expired: "만료", revoked: "철회됨" };

export default async function BlogExtensionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const params = await searchParams;
  const noticeKey = typeof params.notice === "string" ? params.notice : "";
  const notice = NOTICE[noticeKey];

  const listed = await listExtensionTokens({ resolveActor: requireDistributionActor, getClient: getServiceRpcClient });
  const tokens = listed.status === "ok" ? listed.tokens : [];
  // R010-06: 목록 조회가 성공했을 때만 인증 기록 유무를 판단한다. 실패·준비 전은 "확인 불가"(기록 없음으로 확정하지 않음).
  const authRecord =
    listed.status !== "ok"
      ? "확인 불가(목록을 불러오지 못함·준비 전)"
      : tokens.some((t) => t.lastUsedAt !== null)
        ? "인증 기록 있음(토큰 최근 사용 시각 기준, 현재 연결 상태는 아님)"
        : "인증 기록 없음";

  return (
    <ConsoleShell
      section="extension"
      title="Blog 확장 연결"
      crumbs={[{ href: "/admin/distribution/connections", label: "연결·준비도" }, { label: "Blog 확장 연결" }]}
      gateNotice={
        <StatusNotice tone="warning" title="실제 게시 gate 닫힘 · 토큰 관리는 서버 준비 시 실제 동작">
          <p>
            이 화면의 토큰 발급·목록·철회는 서버 키와 DB가 준비되면 실제 결과입니다(샘플 아님). 게시·예약·외부 계정 연결은 이 화면에서 실행하지
            않으며, 확장 인계도 배포 확장이 연결 준비 전 설정이라 아직 동작하지 않습니다.
          </p>
        </StatusNotice>
      }
    >
      <p>
        네이버 블로그 입력기(크롬 확장)가 이 사이트에 인증할 때 쓰는 토큰을 관리합니다. 확장이 배포·설정되면 승인된 Blog 글을 발행 직전까지만
        입력하고, 마지막 발행은 사람이 누릅니다. 이 화면의 토큰 관리는 서버가 준비되면 실제로 동작하며, 게시·인계 실행은 아래 준비 단계를 따릅니다.
      </p>
      {notice ? (
        <StatusNotice tone={notice.tone} title={notice.title} announce>
          <p>{notice.text}</p>
        </StatusNotice>
      ) : null}

      <section aria-labelledby="tok-ready" className="dc-block">
        <h2 id="tok-ready">준비 단계</h2>
        <div className="dc-table-wrap">
          <table className="dc-table">
            <caption>Blog 확장 연결 준비도(현재 근거만 표시)</caption>
            <thead>
              <tr>
                <th scope="col">단계</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">① 토큰 발급</th>
                <td>
                  {listed.status === "ok"
                    ? "준비됨(목록 조회 성공 기준 — 실제 발급 성공은 발급 결과로만 확인)"
                    : listed.status === "not_ready"
                      ? "준비 전(서버 키·DB)"
                      : "확인 불가"}
                </td>
              </tr>
              <tr>
                <th scope="row">② 확장 서버 인증</th>
                <td>{authRecord}</td>
              </tr>
              <tr>
                <th scope="row">③ 대상 블로그·설치 버전 확인</th>
                <td>미구현 — 서버는 확장의 블로그 ID·버전을 확인하지 않습니다</td>
              </tr>
              <tr>
                <th scope="row">④ 인계·진행 보고 API</th>
                <td>서버 구현됨(실DB·브라우저 미검증) · 배포 확장은 연결 준비 전 설정(API_READY=false)</td>
              </tr>
              <tr>
                <th scope="row">⑤ 입력 실행·게시 증거</th>
                <td>미실측 — 게시 표시·증거는 작업 화면의 수동 흐름으로만 기록합니다</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {listed.status === "not_ready" ? (
        <>
          <StatusNotice tone="warning" title="연결 준비 전">
            <p>서버 전용 키와 토큰 DB가 준비되지 않아 토큰을 발급하거나 볼 수 없습니다.</p>
          </StatusNotice>
          <DisabledAction id="token-issue" label="연결 토큰 발급" reason="서버 연결 준비 전" />
        </>
      ) : listed.status === "ok" ? (
        <>
          <section aria-labelledby="tok-issue" className="dc-block">
            <h2 id="tok-issue">새 토큰</h2>
            <TokenIssuePanel />
          </section>
          <section aria-labelledby="tok-list" className="dc-block">
            <h2 id="tok-list">내 토큰</h2>
            {tokens.length === 0 ? (
              <p className="ds-muted">발급한 토큰이 없습니다.</p>
            ) : (
              <div className="dc-table-wrap">
                <table className="dc-table">
                  <caption>내가 발급한 확장 연결 토큰(시각 기준 {DISPLAY_TZ_LABEL}, 토큰 값은 저장하지 않아 다시 볼 수 없습니다)</caption>
                  <thead>
                    <tr>
                      <th scope="col">이름</th>
                      <th scope="col">상태</th>
                      <th scope="col">발급</th>
                      <th scope="col">만료</th>
                      <th scope="col">최근 사용</th>
                      <th scope="col">철회</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const expiresText = formatKst(t.expiresAt) ?? "—";
                      const lastUsedText = formatLastUsed(t.lastUsedAt);
                      return (
                        <tr key={t.id}>
                          <th scope="row">{t.label}</th>
                          <td>{STATE_LABEL[t.state]}</td>
                          <td>{formatKst(t.createdAt) ?? "—"}</td>
                          <td>{expiresText}</td>
                          <td>{lastUsedText}</td>
                          <td>
                            {t.state === "revoked" ? (
                              `철회됨 ${formatKst(t.revokedAt) ?? ""}`
                            ) : t.state === "expired" ? (
                              "만료됨(인증 불가)"
                            ) : (
                              <RevokeTokenButton tokenId={t.id} label={t.label} expiresText={expiresText} lastUsedText={lastUsedText} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <StatusNotice tone="error" title="토큰 목록을 불러오지 못했습니다">
          <p>
            {listed.status === "denied"
              ? "승인된 관리자만 볼 수 있습니다."
              : "토큰 DB가 아직 적용되지 않았거나 일시적으로 응답하지 않습니다. 발급은 목록을 확인할 수 있을 때만 가능합니다."}
          </p>
        </StatusNotice>
      )}

      <section aria-labelledby="tok-install" className="dc-block">
        <h2 id="tok-install">확장 설치·설정</h2>
        <p>관리자용 설치 안내와 확장 배포본은 아직 준비 전입니다. 확장은 현재 &lsquo;연결 준비 전&rsquo; 설정이라 이 사이트로 요청을 보내지 않습니다.</p>
      </section>
      <p>
        <Link className="ds-text-link" href="/admin/distribution/connections">
          연결·준비도로 돌아가기
        </Link>
      </p>
    </ConsoleShell>
  );
}
