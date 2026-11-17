import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { OAuthStartForm } from "@/components/distribution-console/oauth-start-form";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { StatusNotice } from "@/components/status-notice";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { listConnections } from "@/server/distribution/connections/service";
import { THREADS_CALLBACK_PATH } from "@/server/distribution/threads/oauth/endpoints";
import { parseOAuthResult, type OAuthResult } from "@/server/distribution/threads/oauth/flow";
import { OAUTH_ENV, threadsOAuthReadiness } from "@/server/distribution/threads/oauth/session";
import type { WriteNoticeOverrides } from "@/components/distribution-console/write-notice-view";
import { connectionStatusLabel, reauthReasonLabel } from "../reauth-labels";
import { ResultFocus } from "../result-focus";
import { revokeThreadsConnectionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Threads 계정 연결" };

const START = "/api/distribution/oauth/threads/start";
const kst = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST";

/** 해제 실패 안내(C057-04): 공용 문구의 원문·승인·반려 문맥 대신 연결 해제 문맥으로 바꾼다. 해제 성공(saved)은 페이지 수준 안내가 맡는다. */
const REVOKE_NOTICES: WriteNoticeOverrides = {
  invalid: { title: "해제를 확인해 주세요", body: "'이 연결을 해제합니다'에 체크해야 해제할 수 있습니다. 체크했는데도 이 안내가 나오면 화면을 새로 불러온 뒤 목록에서 다시 시도하세요." },
  conflict_version: { title: "연결 정보가 먼저 바뀌었습니다", body: "해제하지 않았습니다. 화면을 새로 불러온 뒤 다시 확인하세요." },
  denied: { title: "권한이 없습니다", body: "연결을 관리할 수 있는 관리자만 해제할 수 있습니다. 로그인 상태를 확인하세요." },
  not_ready: { title: "해제 준비 전", body: "서버 저장 연결이 준비되지 않아 해제하지 않았습니다." },
  uncertain: { title: "해제 여부를 확인해야 합니다", body: "요청은 서버에 닿았을 수 있지만 결과를 확인하지 못했습니다. 화면을 새로 불러와 목록에서 상태를 확인한 뒤 필요할 때만 다시 시도하세요. 자동으로 다시 보내지 않았습니다." },
  not_found: { title: "연결을 찾지 못했습니다", body: "해제하지 않았습니다. 화면을 새로 불러와 목록에서 다시 선택하세요." },
  already_revoked: { title: "이미 해제된 연결입니다", body: "화면을 새로 불러와 현재 상태를 확인하세요." },
  invalid_transition: { title: "지금 상태에서는 해제할 수 없습니다", body: "연결 상태가 이미 바뀌었을 수 있습니다. 화면을 새로 불러와 확인하세요." },
};
const SAVED_NOTICE: WriteNoticeOverrides = {
  saved: {
    title: "연결을 해제했습니다",
    body: "이 서비스에서 연결을 해제하고 저장된 연결 자격 증명(토큰)을 지웠습니다. Threads(Meta) 쪽 앱 권한은 이 해제로 회수되지 않으니 Threads 설정에서 따로 해제하세요.",
  },
};

const RESULT_TEXT: Record<OAuthResult, { tone: "info" | "warning" | "error"; title: string; body: string }> = {
  connected: { tone: "info", title: "Threads 계정을 연결했습니다", body: "토큰은 서버에서 암호화해 저장했습니다. 연결됨은 게시 가능이 아닙니다(권한 확인·실행기·live gate 미완료)." },
  reconnected: { tone: "info", title: "같은 계정으로 다시 연결했습니다", body: "연결(대상)은 그대로이고 토큰만 바뀌었습니다." },
  cancelled: { tone: "info", title: "연결이 취소됐습니다", body: "Threads에서 취소(허용 안 함) 또는 이 브라우저의 연결 요청과 맞춰 볼 수 없는 오류 응답이 돌아와 아무것도 저장하지 않았습니다. 다시 연결하려면 이 화면에서 새로 시작하세요." },
  provider_error: { tone: "warning", title: "Threads가 연결 요청을 거절했습니다", body: "저장하지 않았습니다. 앱 설정을 확인한 뒤 다시 시작하세요." },
  denied: { tone: "error", title: "권한이 없습니다", body: "승인된 관리자만 연결할 수 있습니다." },
  not_ready: { tone: "warning", title: "연결 준비 전", body: "서버 설정이 갖춰지지 않아 시작하지 않았습니다." },
  invalid_request: { tone: "error", title: "잘못된 요청입니다", body: "이 화면에서 다시 시작하세요." },
  state_invalid: { tone: "error", title: "연결 요청을 확인하지 못했습니다", body: "이 브라우저에서 시작한 요청이 아니거나 형식이 다릅니다. 저장하지 않았습니다. 이 화면에서 다시 시작하세요." },
  state_used: { tone: "warning", title: "이미 처리된 연결 요청입니다", body: "같은 요청은 한 번만 처리합니다. 아래 목록에서 결과를 확인하세요." },
  state_expired: { tone: "warning", title: "연결 요청 시간이 지났습니다", body: "10분 안에 마쳐야 합니다. 다시 시작하세요." },
  state_limit: { tone: "warning", title: "진행 중인 연결 요청이 많습니다", body: "관리자 한 명당 마치지 않은 연결 요청은 Threads·Instagram을 합쳐 5개까지입니다(다른 채널 연결 시도 포함, 시작만 하고 마치지 않은 요청도 10분 동안 셈). 잠시 뒤(최대 10분) 다시 시작하세요." },
  version_conflict: { tone: "warning", title: "연결 정보가 먼저 바뀌었습니다", body: "화면을 새로 불러온 뒤 다시 시작하세요." },
  connection_revoked: { tone: "warning", title: "해제된 연결입니다", body: "해제된 연결은 다시 쓸 수 없습니다. '새 계정 연결'로 시작하세요(초안 대상은 다시 저장·승인해야 합니다)." },
  connection_not_found: { tone: "error", title: "연결을 찾지 못했습니다", body: "목록에서 다시 선택하세요." },
  exchange_failed: { tone: "error", title: "Threads 인증 교환이 거절됐습니다", body: "저장하지 않았습니다. 인증 코드는 한 번만 쓸 수 있으니 다시 시작하세요." },
  exchange_unknown: { tone: "warning", title: "Threads 응답을 확인하지 못했습니다", body: "저장하지 않았고 자동으로 다시 요청하지 않았습니다. 다시 시작하세요." },
  account_mismatch: { tone: "warning", title: "다른 Threads 계정으로 로그인했습니다", body: "재연결은 같은 계정만 가능합니다. 저장하지 않았습니다. 다른 계정은 '새 계정 연결'로 추가하세요(기존 연결·승인 대상은 바뀌지 않음)." },
  already_connected: { tone: "info", title: "이미 연결된 계정입니다", body: "저장하지 않았습니다. 토큰을 새로 받으려면 그 연결의 '같은 계정 재연결'을 쓰세요." },
  save_failed: { tone: "error", title: "연결을 저장하지 못했습니다", body: "다시 시작하세요." },
  save_unknown: { tone: "warning", title: "저장 여부를 확인해야 합니다", body: "토큰 교환 뒤 저장 응답을 받지 못했습니다. 아래 목록을 새로 불러와 확인하세요. 자동으로 다시 시도하지 않았습니다." },
  start_unknown: { tone: "warning", title: "연결 시작 여부를 확인하지 못했습니다", body: "잠시 뒤 다시 시작하세요." },
  unexpected: { tone: "error", title: "처리 중 문제가 생겼습니다", body: "저장 여부를 아래 목록에서 확인한 뒤 필요하면 다시 시작하세요." },
};

/**
 * Threads 계정 연결(AUTOPOST-THREADS-OAUTH-019). 화면에는 계정 ID·요청 권한·만료·상태 메타만 보인다(토큰·암호문 없음).
 * 연결됨 ≠ 게시 가능: 부여 권한 확인·capability 검증·실행기는 미구현이고 live gate는 닫혀 있다.
 */
export default async function ThreadsConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const sp = await searchParams;
  const result = parseOAuthResult(sp.result);
  const ready = threadsOAuthReadiness();
  const listed = await listConnections({ resolveActor: requireDistributionActor, getClient: getServiceRpcClient });
  const rows = listed.status === "ok" ? listed.connections.filter((c) => c.channel === "threads") : [];
  // 누락 설정 이름 계산·빈 목록 fallback을 Instagram 화면과 같게(C057-10).
  const missing = [...ready.missing, ...(ready.serviceReady || ready.missing.includes("SUPABASE_SECRET_KEY") ? [] : ["SUPABASE_SECRET_KEY"])];
  const crumbs = [{ href: "/admin/distribution/connections", label: "연결·준비도" }, { label: "Threads 계정 연결" }];

  return (
    <ConsoleShell
      section="connections"
      eyebrow="계정 연결"
      title="Threads 계정 연결"
      description="공식 Threads 로그인으로 계정을 연결합니다. 연결됨은 게시 가능이 아닙니다."
      crumbs={crumbs}
      gateNotice={
        <StatusNotice tone="warning" title="연결만 가능 · 실제 게시는 닫힘">
          <p>연결 토큰은 서버에서 암호화해 보관합니다. 부여 권한 확인·기능 검증·게시 실행기가 아직 없고 live gate가 닫혀 있어 이 연결로 게시되지 않습니다.</p>
        </StatusNotice>
      }
    >
      {/* 결과 초점 이동(C057-06)은 허용 목록으로 검증된 result 또는 notice=saved일 때만. 둘 다 있으면 OAuth 결과가 먼저. */}
      {result ? (
        <ResultFocus>
          <StatusNotice tone={RESULT_TEXT[result].tone} title={RESULT_TEXT[result].title} announce>
            <p>{RESULT_TEXT[result].body}</p>
          </StatusNotice>
        </ResultFocus>
      ) : null}
      {/* 이 화면에 실제로 redirect되는 쓰기 결과는 해제 성공(saved)뿐 — 다른 코드는 URL 조작만으로 보이지 않게 막는다(FE-065). */}
      {sp.notice === "saved" ? (
        result ? (
          <WriteNoticeView notice="saved" overrides={SAVED_NOTICE} />
        ) : (
          <ResultFocus>
            <WriteNoticeView notice="saved" overrides={SAVED_NOTICE} />
          </ResultFocus>
        )
      ) : null}

      <section aria-labelledby="th-ready" className="dc-panel">
        <h2 id="th-ready">준비 상태</h2>
        {ready.ready ? (
          <p>서버 설정이 준비됐습니다. Meta 앱의 유효한 OAuth redirect URI에는 아래 주소 하나만 등록합니다.</p>
        ) : (
          <p className="ds-muted">
            연결 준비 전: 서버 설정 {missing.join(", ") || "(확인 불가)"}이(가) 없거나 형식이 맞지 않습니다(값은 표시하지 않음).
          </p>
        )}
        <p className="ds-muted">
          필요한 서버 설정 이름: {OAUTH_ENV.join(", ")}, SUPABASE_SECRET_KEY · 등록할 redirect: {ready.redirectUri ?? `<NEXT_PUBLIC_SITE_URL>${THREADS_CALLBACK_PATH}`}
        </p>
        <OAuthStartForm action={START}>
          {ready.ready ? (
            <button type="submit" className="ds-button ds-button--primary">
              새 Threads 계정 연결
            </button>
          ) : (
            // 비활성 이유를 시작 버튼과 연결(C057-08, FE-073).
            <div className="dc-disabled-action">
              <button type="submit" className="ds-button ds-button--primary" disabled aria-describedby="th-start-why">
                새 Threads 계정 연결
              </button>
              <p id="th-start-why" className="ds-muted dc-reason">
                사용할 수 없음: 서버 설정 준비 전(위 준비 상태 참고)
              </p>
            </div>
          )}
        </OAuthStartForm>
        <p className="ds-muted dc-reason">요청 권한: threads_basic, threads_content_publish(요청값이며 실제 부여 여부는 아직 확인하지 않습니다). 10분 안에 마쳐야 합니다.</p>
      </section>

      <section aria-labelledby="th-list" className="dc-panel dc-block">
        <h2 id="th-list">연결된 계정</h2>
        {listed.status === "not_ready" ? (
          <p className="ds-muted">조회 준비 전: 서버 저장 연결이 설정되지 않았습니다.</p>
        ) : listed.status !== "ok" ? (
          <p className="ds-muted">연결 목록을 불러오지 못했습니다(데이터가 없다는 뜻이 아님).</p>
        ) : rows.length === 0 ? (
          <p className="ds-muted">연결된 Threads 계정이 없습니다(조회 성공 · 0건).</p>
        ) : (
          <ul className="dc-cards dc-cards--stack">
            {rows.map((c) => (
              <li key={c.id} className="dc-card">
                <dl className="dc-facts">
                  <dt>계정 ID</dt>
                  <dd>{c.providerAccountId}</dd>
                  <dt>상태</dt>
                  <dd>
                    {connectionStatusLabel(c.status)}
                    {c.status !== "revoked" && c.expired ? " · 만료됨(재연결 필요)" : ""}
                    {c.reauthReason ? ` · ${reauthReasonLabel(c.reauthReason, "threads")}` : ""}
                  </dd>
                  <dt>요청 권한</dt>
                  <dd>{c.scopes.join(", ")}</dd>
                  <dt>만료</dt>
                  <dd>{kst(c.expiresAt)}</dd>
                </dl>
                {c.status !== "revoked" ? (
                  <>
                    <OAuthStartForm action={START}>
                      <input type="hidden" name="connectionId" value={c.id} />
                      <input type="hidden" name="expectedVersion" value={String(c.rowVersion)} />
                      {ready.ready ? (
                        <button type="submit" className="ds-button ds-button--secondary">
                          같은 계정 재연결
                        </button>
                      ) : (
                        // 비활성 이유를 카드 안에서 버튼과 연결(C057-08). 이유 id는 카드(연결 id)마다 고유하다.
                        <div className="dc-disabled-action">
                          <button type="submit" aria-describedby={`rc-why-${c.id}`} className="ds-button ds-button--secondary" disabled>
                            같은 계정 재연결
                          </button>
                          <p id={`rc-why-${c.id}`} className="ds-muted dc-reason">
                            사용할 수 없음: 서버 설정 준비 전(위 준비 상태 참고)
                          </p>
                        </div>
                      )}
                    </OAuthStartForm>
                    <div className="dc-danger-zone">
                      <ActionForm
                        action={revokeThreadsConnectionAction}
                        className=""
                        fieldLabels={{ confirmRevoke: "해제 확인", reason: "사유", expectedVersion: "버전", connectionId: "해제할 연결(목록을 새로 불러와 다시 선택)" }}
                        noticeOverrides={REVOKE_NOTICES}
                        markInvalidFields
                        errorSummaryId={`rv-err-${c.id}`}
                      >
                        <input type="hidden" name="connectionId" value={c.id} />
                        <input type="hidden" name="expectedVersion" value={String(c.rowVersion)} />
                        <label className="dc-check">
                          <input type="checkbox" name="confirmRevoke" /> 이 연결을 해제합니다. 저장된 토큰을 지우며 되돌릴 수 없습니다. Meta 쪽 앱 권한 회수는 Threads 설정에서 따로 합니다.
                        </label>
                        <label htmlFor={`rv-${c.id}`}>사유(선택)</label>
                        <input id={`rv-${c.id}`} name="reason" type="text" maxLength={500} />
                        <button type="submit" className="ds-button ds-button--danger">
                          연결 해제
                        </button>
                      </ActionForm>
                    </div>
                  </>
                ) : (
                  <p className="ds-muted">해제된 연결은 다시 쓸 수 없습니다. 필요하면 새 계정 연결을 하세요.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>
        <Link className="ds-text-link" href="/admin/distribution/connections">
          연결·준비도로 돌아가기
        </Link>
      </p>
    </ConsoleShell>
  );
}
