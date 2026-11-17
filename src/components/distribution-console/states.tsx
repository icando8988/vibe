import Link from "next/link";
import type { ReactNode } from "react";
import { StatusNotice } from "../status-notice";
import { CAPABILITY_FEATURES, CAPABILITY_LABEL, CHANNELS, CHANNEL_INFO, currentCapabilities, modeAvailability } from "./readiness";
import type { Channel, JobStatus } from "@/lib/distribution/types";

/**
 * 콘솔 공통 상태 표시 (AUTOPOST-CONSOLE-UI, 설계 7절 공통 상태).
 * - 데이터 경로가 없다는 사실을 '0건'이나 '조회 결과 없음'으로 바꾸지 않는다.
 * - 버튼은 실제 동작이 없으므로 항상 disabled + 옆에 사유를 둔다(wait 커서 금지).
 * - 어떤 컴포넌트도 저장·승인·게시 성공을 표시하지 않는다.
 */

/** 운영 데이터 조회 경로 미연결. 실제 조회 0건과 구별되는 문구를 쓴다. */
export function NotConnected({ what, next }: { what: string; next?: ReactNode }) {
  return (
    <div className="ds-empty-state dc-empty">
      <span className="ds-tag">운영 데이터 미연결</span>
      <p>
        {what} 조회 경로가 아직 연결되지 않아 표시할 항목이 없습니다. 실제로 항목이 없다는 뜻이 아닙니다.
      </p>
      {next ? <div>{next}</div> : null}
    </div>
  );
}

/** 비활성 행위 버튼 + 사유(스크린리더에도 연결). 클릭 동작·폼 제출이 없다. */
export function DisabledAction({ id, label, reason }: { id: string; label: string; reason: string }) {
  const reasonId = `${id}-reason`;
  return (
    <div className="dc-disabled-action">
      <button type="button" className="ds-button ds-button--secondary" disabled aria-describedby={reasonId}>
        {label}
      </button>
      <p id={reasonId} className="ds-muted dc-reason">
        사용할 수 없음: {reason}
      </p>
    </div>
  );
}

/** 잘못된 경로 값. notFound()는 Next 16.4.6에서 빈 셸이 되므로 셸 안에서 안내한다. */
export function InvalidParam({ what, back }: { what: string; back: { href: string; label: string } }) {
  return (
    <>
      <StatusNotice tone="error" title={`올바르지 않은 ${what}입니다`}>
        <p>주소의 {what} 형식을 확인할 수 없습니다. 목록에서 다시 선택해 주세요.</p>
      </StatusNotice>
      <p>
        <Link className="ds-text-link" href={back.href}>
          {back.label}
        </Link>
      </p>
    </>
  );
}

/** 긴 ID는 줄바꿈해서 표시한다. 존재 여부는 판단하지 않는다. */
export function IdLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="dc-id">
      {label}: <code>{value}</code> <span className="ds-muted">(조회 경로 미연결 · 존재 여부 미확인)</span>
    </p>
  );
}

/** 세 채널 방식·차단 사유 카드. 연결·건수·실적 숫자는 넣지 않는다. */
export function ChannelCards({ hrefFor }: { hrefFor?: (channel: Channel) => string }) {
  return (
    <ul className="dc-cards">
      {CHANNELS.map((channel) => {
        const info = CHANNEL_INFO[channel];
        return (
          <li key={channel} className="dc-card">
            <div className="dc-channel-row">
              <div>
                <ChannelMark channel={channel} />
                <h3>{hrefFor ? <Link href={hrefFor(channel)}>{info.label}</Link> : info.label}</h3>
              </div>
              <span className="dc-tag">{info.methodTag}</span>
            </div>
            <p>{info.summary}</p>
            <p className="ds-muted">
              <strong>현재 막힌 이유:</strong> {info.blocked}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** 채널별 모드 허용·실행 가능 상태 표. */
export function ModeTable({ channel }: { channel: Channel }) {
  const rows = modeAvailability(channel);
  return (
    <div className="dc-table-wrap">
      <table className="dc-table">
        <caption>{CHANNEL_INFO[channel].label} 실행 방식</caption>
        <thead>
          <tr>
            <th scope="col">방식</th>
            <th scope="col">이 채널 제공</th>
            <th scope="col">현재 상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mode}>
              <th scope="row">{r.label}</th>
              <td>{r.allowed ? "제공" : "제공 안 함"}</td>
              <td>{r.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 채널별 기능 준비도 표(현재 전부 미검증). */
export function CapabilityTable({ channel }: { channel: Channel }) {
  const caps = currentCapabilities(channel);
  return (
    <div className="dc-table-wrap">
      <table className="dc-table">
        <caption>{CHANNEL_INFO[channel].label} 기능 준비도</caption>
        <thead>
          <tr>
            <th scope="col">기능</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          {CAPABILITY_FEATURES.map(([key, label]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{CAPABILITY_LABEL[caps[key]]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ds-muted">
        연결 상태: {caps.connected ? "연결됨" : "연결 안 됨"}. 문서 검토나 모의 실행만으로 &lsquo;지원 확인&rsquo;으로 바꾸지 않습니다.
      </p>
    </div>
  );
}

/** 작업 상태 설명(설계 6절). 실제 사건이 아니라 상태 사전이다. */
export const JOB_STATUS_TEXT: { readonly [S in JobStatus]: { label: string; meaning: string; action: string } } = {
  scheduled: { label: "예약됨", meaning: "예약 또는 즉시 실행 대기", action: "준비된 서버에서만 변경·취소. 지금은 예약 준비 전" },
  dispatching: { label: "실행 중", meaning: "외부 요청 진행 중. 확인된 단계만 표시", action: "상세 조회. 오래 걸려도 바로 실패·재시도로 보지 않음" },
  published: { label: "게시 확인됨", meaning: "게시 근거(증거)가 확인됨", action: "증거 보기. 수정은 정정 이력으로" },
  dry_run_succeeded: { label: "모의 실행 완료", meaning: "외부 게시 없음", action: "미리보기 검토. 실제 게시 집계에서 제외" },
  failed: { label: "실패", meaning: "확정 실패 + 오류 요약 + 재실행 정책", action: "auto는 서버 정책, operator_only는 별도 승인 검토, never는 재실행 안 함" },
  unknown: { label: "결과 불명", meaning: "게시 여부를 모름", action: "대사만. 재게시·자동 재시도·복제 없음" },
  cancelled: { label: "취소됨", meaning: "취소 확정", action: "이력만. 외부 게시 삭제를 뜻하지 않음" },
  manual_ready: { label: "수동 게시 준비", meaning: "승인본을 사람이 외부에서 게시할 차례", action: "승인본 복사·수동 게시 안내(서버 준비 후)" },
  awaiting_evidence: { label: "게시 증거 대기", meaning: "운영자가 게시했다고 표시함. 아직 게시 확인 아님", action: "게시 URL 또는 외부 ID와 확인 근거 입력(후속 구현)" },
  abandoned: { label: "수동 작업 중단", meaning: "외부에 글이 남았을 수 있음. 같은 키를 계속 점유", action: "이력 검토. 새 버전으로 우회하지 않음" },
};

export function StatusDictionary() {
  return (
    <div className="dc-table-wrap">
      <table className="dc-table">
        <caption>작업 상태 설명 (상태 사전 · 실제 작업 아님)</caption>
        <thead>
          <tr>
            <th scope="col">상태</th>
            <th scope="col">뜻</th>
            <th scope="col">할 수 있는 일</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(JOB_STATUS_TEXT) as JobStatus[]).map((s) => (
            <tr key={s}>
              <th scope="row">
                {JOB_STATUS_TEXT[s].label} <code className="dc-code">{s}</code>
              </th>
              <td>{JOB_STATUS_TEXT[s].meaning}</td>
              <td>{JOB_STATUS_TEXT[s].action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="dc-table">
        <caption>보조 상태 축 (작업 상태와 따로 읽음 · 상태 사전 · 실제 작업 아님)</caption>
        <thead>
          <tr>
            <th scope="col">축</th>
            <th scope="col">뜻</th>
            <th scope="col">읽는 방법</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">게시 확인 + 구성 경고</th>
            <td>상위 상태는 &lsquo;게시 확인됨&rsquo;이고 증거와 함께 구성 경고(issues)가 따로 기록됨</td>
            <td>실패가 아니며 재게시 대상이 아님. 증거와 경고를 함께 검토</td>
          </tr>
          <tr>
            <th scope="row">검토·최신성</th>
            <td>원문이나 초안이 바뀌면 이전 승인은 &lsquo;재승인 필요&rsquo;</td>
            <td>작업 상태와 별개. 최신 버전으로 다시 검토·승인해야 실행 준비</td>
          </tr>
          <tr>
            <th scope="row">연결·기능 준비</th>
            <td>계정 재인증 필요, 기능 미검증</td>
            <td>재인증이 끝나도 기존 작업이 성공한 것이 아니며 예약이 자동 재개되지 않음</td>
          </tr>
          <tr>
            <th scope="row">보류</th>
            <td>운영 중지·권리 확인·승인 철회 등으로 실행 보류</td>
            <td>보류 이유가 풀릴 때까지 실행하지 않음</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 개발 연결 상태(운영 진단). DQ-06: 사용자 기본 본문에서 분리해 접어 둔다.
 * 기본 화면은 "지금 가능한 일/불가능한 이유"를 각 화면 문장으로 설명하고, 여기의 기술 항목은 진단용이다.
 * 사용자가 DB·RPC를 직접 설정해야 한다는 뜻이 아니다.
 */
export function Dependencies({ items }: { items: string[] }) {
  return (
    <details className="dc-diagnostics">
      <summary>운영 진단: 이 화면을 실제로 쓰기 위해 개발 쪽에서 연결할 것</summary>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </details>
  );
}

/** 채널 표식(A안 channel-mark). 장식이며 채널 이름은 옆 텍스트로 읽는다. */
export function ChannelMark({ channel }: { channel: Channel }) {
  const letter = { blog: "B", threads: "T", instagram: "I" }[channel];
  return (
    <span className="dc-channel-mark" aria-hidden="true">
      {letter}
    </span>
  );
}
