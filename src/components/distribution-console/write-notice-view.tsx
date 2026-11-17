import type { ReactNode } from "react";
import { StatusNotice } from "../status-notice";
import { parseWriteNotice, type WriteNotice } from "@/server/distribution/write-notice";

/**
 * 쓰기 결과 안내(AUTOPOST-CONTENT-CONNECT-014). 쿼리의 notice는 허용 목록 코드만 받는다(임의 문자열 렌더 없음).
 * 성공 안내는 서버 액션이 RPC 응답을 확인한 뒤 redirect한 경우에만 나온다.
 */
const TEXT: Record<WriteNotice, { tone: "info" | "warning" | "error"; title: string; body: string }> = {
  saved: { tone: "info", title: "저장했습니다", body: "서버가 저장을 확인했습니다. 아래는 다시 불러온 최신 내용입니다." },
  denied: { tone: "error", title: "권한이 없습니다", body: "승인된 관리자만 저장할 수 있습니다. 로그인·승인 상태를 확인하세요." },
  invalid: { tone: "error", title: "입력값을 확인해 주세요", body: "필수 항목·길이·형식을 확인하세요. 승인은 모든 확인 항목이, 반려·철회는 사유가 필요합니다." },
  not_ready: { tone: "warning", title: "저장 준비 전", body: "서버 저장 연결(서버 키)이 준비되지 않아 저장하지 않았습니다." },
  uncertain: {
    tone: "warning",
    title: "저장 여부를 확인해야 합니다",
    body: "요청은 서버에 닿았을 수 있지만 결과를 확인하지 못했습니다. 화면을 새로 불러와 최신 상태를 확인한 뒤 필요할 때만 다시 시도하세요. 자동으로 다시 보내지 않았습니다.",
  },
  conflict_version: { tone: "warning", title: "다른 곳에서 먼저 바뀌었습니다", body: "원문이 이미 새 버전입니다. 최신 내용을 확인한 뒤 다시 저장하세요(입력은 저장되지 않았습니다)." },
  conflict_revision: { tone: "warning", title: "초안이 먼저 바뀌었습니다", body: "다른 곳에서 초안을 저장했습니다. 최신 초안을 확인한 뒤 다시 저장하세요." },
  stale_content: { tone: "warning", title: "원문이 새 버전으로 바뀌었습니다", body: "최신 원문을 기준으로 초안을 다시 저장한 뒤 검토하세요." },
  not_latest: { tone: "warning", title: "검토한 대상이 최신이 아닙니다", body: "최신 원문·초안으로 다시 검토하세요." },
  subject_changed: { tone: "warning", title: "검토 화면을 연 뒤 내용이 바뀌었습니다", body: "바뀐 내용을 다시 확인한 뒤 결정하세요." },
  integrity_error: { tone: "error", title: "저장된 내용의 무결성 확인에 실패했습니다", body: "승인하지 않았습니다. 운영 확인이 필요합니다." },
  already_decided: { tone: "info", title: "이미 결정된 대상입니다", body: "현재 승인 상태를 아래에서 확인하세요." },
  already_revoked: { tone: "info", title: "이미 철회된 승인입니다", body: "현재 상태를 아래에서 확인하세요." },
  checklist_incomplete: { tone: "error", title: "확인 항목을 모두 체크해야 승인할 수 있습니다", body: "" },
  archived: { tone: "warning", title: "보관된 원문·초안입니다", body: "보관된 대상은 수정·승인할 수 없습니다." },
  no_content_version: { tone: "warning", title: "원문을 먼저 저장하세요", body: "" },
  duplicate: { tone: "info", title: "이미 있습니다", body: "같은 초안·작업·인계가 이미 있습니다. 화면을 새로 불러와 기존 항목을 확인하세요(새로 만들지 않았습니다)." },
  not_found: { tone: "error", title: "대상을 찾지 못했습니다", body: "목록에서 다시 선택하세요." },
  invalid_transition: { tone: "warning", title: "지금 상태에서는 할 수 없는 작업입니다", body: "작업 상태가 이미 바뀌었을 수 있습니다. 화면을 새로 불러와 현재 상태를 확인하세요." },
  evidence_conflict: { tone: "error", title: "다른 작업에 이미 같은 게시물이 증거로 기록돼 있습니다", body: "증거를 저장하지 않았습니다. 게시 주소를 다시 확인하세요." },
  not_approved: { tone: "warning", title: "승인이 유효하지 않습니다", body: "원문 버전과 채널 리비전이 모두 최신 상태로 승인돼야 작업을 만들 수 있습니다." },
  republish_confirmation: { tone: "warning", title: "이전 버전이 이미 게시됐습니다", body: "새 버전 재게시는 이 화면에서 지원하지 않습니다. 운영 검토가 필요합니다." },
  live_gate_closed: { tone: "warning", title: "실제 게시 gate가 닫혀 있습니다", body: "자동 게시는 준비되지 않았습니다." },
};

/** 화면별 안내 덮어쓰기(선택, FE-MEDIA-FIX-029). 주지 않은 코드는 공용 TEXT 그대로. `extra`는 본문 뒤 추가 동선(링크 등). */
export type WriteNoticeOverride = { tone?: "info" | "warning" | "error"; title?: string; body?: string; extra?: ReactNode };
export type WriteNoticeOverrides = Partial<Record<WriteNotice, WriteNoticeOverride>>;

export function WriteNoticeView({ notice, overrides }: { notice: unknown; overrides?: WriteNoticeOverrides }) {
  const code = parseWriteNotice(notice);
  if (!code) return null;
  const o = overrides?.[code];
  const t = o ? { ...TEXT[code], ...o } : TEXT[code];
  return (
    <StatusNotice tone={t.tone} title={t.title} announce>
      {t.body ? <p>{t.body}</p> : null}
      {o?.extra ?? null}
    </StatusNotice>
  );
}

/** 조회 결과 상태 안내(준비 전 / 스키마 미적용 / 조회 오류). ok는 각 화면이 그린다. */
export function ReadStateNotice({ status, what }: { status: "not_configured" | "schema_missing" | "error"; what: string }) {
  if (status === "not_configured") {
    return (
      <StatusNotice tone="warning" title="조회 준비 전">
        <p>로그인·저장소 연결이 설정되지 않아 {what}을(를) 불러올 수 없습니다.</p>
      </StatusNotice>
    );
  }
  if (status === "schema_missing") {
    return (
      <StatusNotice tone="warning" title="데이터 구조 준비 전">
        <p>{what} 저장소가 아직 만들어지지 않았습니다(DB 적용 전). 실제로 항목이 없다는 뜻이 아닙니다.</p>
      </StatusNotice>
    );
  }
  return (
    <StatusNotice tone="error" title={`${what}을(를) 불러오지 못했습니다`}>
      <p>잠시 후 다시 불러오세요. 조회 실패는 데이터가 없다는 뜻이 아닙니다.</p>
    </StatusNotice>
  );
}
