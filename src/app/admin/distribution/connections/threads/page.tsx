import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { StatusNotice } from "@/components/status-notice";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { listConnections } from "@/server/distribution/connections/service";
import { THREADS_CALLBACK_PATH } from "@/server/distribution/threads/oauth/endpoints";
import { parseOAuthResult, type OAuthResult } from "@/server/distribution/threads/oauth/flow";
import { OAUTH_ENV, threadsOAuthReadiness } from "@/server/distribution/threads/oauth/session";
import { revokeThreadsConnectionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Threads 계정 연결" };

const START = "/api/distribution/oauth/threads/start";
const kst = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST";
const STATUS: Record<string, string> = { connected: "연결됨", reauth_required: "재인증 필요", revoked: "연결 해제됨" };

const RESULT_TEXT: Record<OAuthResult, { tone: "info" | "warning" | "error"; title: string; body: string }> = {
  connected: { tone: "info", title: "Threads 계정을 연결했습니다", body: "토큰은 서버에서 암호화해 저장했습니다. 연결됨은 게시 가능이 아닙니다(권한 확인·실행기·live gate 미완료)." },
  reconnected: { tone: "info", title: "같은 계정으로 다시 연결했습니다", body: "연결(대상)은 그대로이고 토큰만 바뀌었습니다." },
  cancelled: { tone: "info", title: "연결을 취소했습니다", body: "Threads 화면에서 허용하지 않아 아무것도 저장하지 않았습니다." },
  provider_error: { tone: "warning", title: "Threads가 연결 요청을 거절했습니다", body: "저장하지 않았습니다. 앱 설정을 확인한 뒤 다시 시작하세요." },
  denied: { tone: "error", title: "권한이 없습니다", body: "승인된 관리자만 연결할 수 있습니다." },
  not_ready: { tone: "warning", title: "연결 준비 전", body: "서버 설정이 갖춰지지 않아 시작하지 않았습니다." },
  invalid_request: { tone: "error", title: "잘못된 요청입니다", body: "이 화면에서 다시 시작하세요." },
  state_invalid: { tone: "error", title: "연결 요청을 확인하지 못했습니다", body: "이 브라우저에서 시작한 요청이 아니거나 형식이 다릅니다. 저장하지 않았습니다. 이 화면에서 다시 시작하세요." },
  state_used: { tone: "warning", title: "이미 처리된 연결 요청입니다", body: "같은 요청은 한 번만 처리합니다. 아래 목록에서 결과를 확인하세요." },
  state_expired: { tone: "warning", title: "연결 요청 시간이 지났습니다", body: "10분 안에 마쳐야 합니다. 다시 시작하세요." },
  state_limit: { tone: "warning", title: "진행 중인 연결 요청이 많습니다", body: "잠시 뒤(최대 10분) 다시 시작하세요." },
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
      {result ? (
        <StatusNotice tone={RESULT_TEXT[result].tone} title={RESULT_TEXT[result].title} announce>
          <p>{RESULT_TEXT[result].body}</p>
        </StatusNotice>
      ) : null}
      <WriteNoticeView notice={sp.notice} />

      <section aria-labelledby="th-ready" className="dc-panel">
        <h2 id="th-ready">준비 상태</h2>
        {ready.ready ? (
          <p>서버 설정이 준비됐습니다. Meta 앱의 유효한 OAuth redirect URI에는 아래 주소 하나만 등록합니다.</p>
        ) : (
          <p className="ds-muted">
            연결 준비 전: 서버 설정 {[...ready.missing, ...(ready.serviceReady ? [] : ["SUPABASE_SECRET_KEY"])].join(", ")}이(가) 없거나 형식이 맞지 않습니다(값은 표시하지 않음).
          </p>
        )}
        <p className="ds-muted">
          필요한 서버 설정 이름: {OAUTH_ENV.join(", ")}, SUPABASE_SECRET_KEY · 등록할 redirect: {ready.redirectUri ?? `<NEXT_PUBLIC_SITE_URL>${THREADS_CALLBACK_PATH}`}
        </p>
        <form method="post" action={START}>
          <button type="submit" className="ds-button ds-button--primary" disabled={!ready.ready}>
            새 Threads 계정 연결
          </button>
        </form>
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
          <ul className="dc-cards">
            {rows.map((c) => (
              <li key={c.id} className="dc-card">
                <dl className="dc-facts">
                  <dt>계정 ID</dt>
                  <dd>{c.providerAccountId}</dd>
                  <dt>상태</dt>
                  <dd>
                    {STATUS[c.status] ?? c.status}
                    {c.status !== "revoked" && c.expired ? " · 만료됨(재연결 필요)" : ""}
                    {c.reauthReason ? ` · ${c.reauthReason}` : ""}
                  </dd>
                  <dt>요청 권한</dt>
                  <dd>{c.scopes.join(", ")}</dd>
                  <dt>만료</dt>
                  <dd>{kst(c.expiresAt)}</dd>
                </dl>
                {c.status !== "revoked" ? (
                  <>
                    <form method="post" action={START}>
                      <input type="hidden" name="connectionId" value={c.id} />
                      <input type="hidden" name="expectedVersion" value={String(c.rowVersion)} />
                      <button type="submit" className="ds-button ds-button--secondary" disabled={!ready.ready}>
                        같은 계정 재연결
                      </button>
                    </form>
                    <ActionForm action={revokeThreadsConnectionAction} className="" fieldLabels={{ confirmRevoke: "해제 확인", reason: "사유", expectedVersion: "버전" }}>
                      <input type="hidden" name="connectionId" value={c.id} />
                      <input type="hidden" name="expectedVersion" value={String(c.rowVersion)} />
                      <label>
                        <input type="checkbox" name="confirmRevoke" /> 이 연결을 해제합니다. 저장된 토큰을 지우며 되돌릴 수 없습니다. Meta 쪽 앱 권한 회수는 Threads 설정에서 따로 합니다.
                      </label>
                      <label htmlFor={`rv-${c.id}`}>사유(선택)</label>
                      <input id={`rv-${c.id}`} name="reason" type="text" maxLength={500} />
                      <button type="submit" className="ds-button ds-button--secondary">
                        연결 해제
                      </button>
                    </ActionForm>
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
