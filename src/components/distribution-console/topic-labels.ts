/**
 * 글감 수집 화면 공용 문구·판정(순수 — 서버·클라이언트 양쪽에서 import, 시험 대상). task_e3081d32118a.
 */
import type { TopicListOutcome, TopicStatus } from "@/server/distribution/topics/types";

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = { new: "새 후보", selected: "고름", converted: "원고로 전환됨", dismissed: "제외" };

/** 목록 조회 결과 → 쓰기 잠금 사유. 0건(ok)은 잠그지 않는다. null이면 쓰기 가능. */
export function topicWriteLock(list: TopicListOutcome, writeConfigured: boolean): string | null {
  if (list.status === "schema_missing") return "글감 저장소가 아직 준비되지 않아(데이터 구조 미적용) 등록·변경할 수 없습니다.";
  if (list.status === "denied") return "관리자 권한이 확인되지 않아 등록·변경할 수 없습니다.";
  if (list.status === "not_configured") return "글감 저장소 조회 연결이 설정되지 않아 등록·변경할 수 없습니다.";
  if (list.status === "error") return "글감 목록을 확인할 수 없어 등록·변경을 잠갔습니다. 잠시 뒤 새로 불러와 주세요.";
  if (!writeConfigured) return "서버 저장 연결이 설정되지 않아 등록·변경할 수 없습니다.";
  return null;
}

/** ok가 아닌 목록 상태 안내 — 0건과 조회 불가를 구분한다. */
export function topicListStateText(list: Exclude<TopicListOutcome, { status: "ok" }>): string {
  switch (list.status) {
    case "schema_missing":
      return "글감 저장소가 아직 준비되지 않았습니다(데이터 구조 미적용). 후보가 없는 것이 아니라 조회할 수 없는 상태입니다.";
    case "not_configured":
      return "글감 저장소 조회 연결이 설정되지 않았습니다. 후보가 없는 것이 아니라 조회할 수 없는 상태입니다.";
    case "denied":
      return "관리자 권한이 확인되지 않아 목록을 보여 줄 수 없습니다.";
    case "error":
      return "글감 목록을 불러오지 못했습니다. 후보가 없는 것이 아니라 조회에 실패한 상태입니다. 잠시 뒤 새로 불러와 주세요.";
  }
}
