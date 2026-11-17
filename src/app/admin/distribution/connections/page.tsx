import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CHANNEL_INFO, CHANNELS } from "@/components/distribution-console/readiness";
import { CapabilityTable, Dependencies, DisabledAction, ModeTable } from "@/components/distribution-console/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "연결·준비도" };

/** W5 연결·기능 준비도. 연결됨 ≠ 게시 가능. 비밀값 입력란은 두지 않는다. */
export default async function ConnectionsPage() {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;

  return (
    <ConsoleShell section="connections" title="연결·준비도" crumbs={[{ label: "연결·준비도" }]}>
      <p>연결 상태와 기능 준비도는 따로 봅니다. 계정이 연결돼도 기능이 검증되기 전에는 게시할 수 없습니다.</p>
      {CHANNELS.map((c) => (
        <section key={c} aria-labelledby={`cn-${c}`} className="dc-block dc-card">
          <h2 id={`cn-${c}`}>{CHANNEL_INFO[c].label}</h2>
          <dl className="dc-facts">
            <dt>연결 상태</dt>
            <dd>{c === "blog" ? "연결 대상 아님 (수동 게시)" : c === "threads" ? "Threads 계정 연결 화면에서 확인" : "연결 없음"}</dd>
            <dt>계정</dt>
            <dd>{c === "threads" ? "Threads 계정 연결 화면에서 확인" : "없음"}</dd>
            <dt>마지막 확인</dt>
            <dd>{c === "threads" ? "Threads 계정 연결 화면에서 확인" : "미확인"}</dd>
          </dl>
          <ModeTable channel={c} />
          <CapabilityTable channel={c} />
          {c === "blog" ? (
            <p>
              Blog 수동 게시에는 계정 연결이 없습니다. 네이버 블로그 입력기(크롬 확장)의 사이트 인증 토큰은 따로 관리합니다:{" "}
              <Link className="ds-text-link" href="/admin/distribution/connections/blog-extension">
                Blog 확장 인증 토큰 관리
              </Link>
            </p>
          ) : c === "threads" ? (
            <p>
              공식 Threads 로그인으로 계정을 연결합니다(연결됨 ≠ 게시 가능, live gate 닫힘):{" "}
              <Link className="ds-text-link" href="/admin/distribution/connections/threads">
                Threads 계정 연결
              </Link>
            </p>
          ) : (
            <>
              <DisabledAction id={`cn-connect-${c}`} label={`${CHANNEL_INFO[c].label} 계정 연결`} reason="Instagram 외부 인증(OAuth) 연결이 아직 구현되지 않았습니다(Threads 연결과 별개)." />
              <p>
                지금은 캡션 초안·검토(원문 화면의 채널 초안)와 게시에 쓸 이미지의 권리 관리를 할 수 있습니다:{" "}
                <Link className="ds-text-link" href="/admin/distribution/media">
                  미디어·권리
                </Link>
              </p>
            </>
          )}
        </section>
      ))}
      <Dependencies
        items={[
          "M3 연결·자격정보 저장(서버 전용, 브라우저에 비밀 노출 없음)",
          "같은 계정 재인증 확인, 기능별 검증 근거·시각 기록",
          "재인증 뒤에도 예약을 자동 재개하지 않는 정책",
        ]}
      />
    </ConsoleShell>
  );
}
