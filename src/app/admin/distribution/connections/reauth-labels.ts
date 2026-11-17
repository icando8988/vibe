/**
 * 연결 화면 공용 표시 라벨(FE-CONNECTIONS-FIX-070, C057-05). Threads·Instagram이 같은 의미의 한글 라벨을 쓴다.
 * 순수 상수·함수만 둔다(서버 모듈·"use client" 없음). 모르는 코드는 원문을 보이지 않고 "확인 필요"로 표시한다.
 */
export type ConnectionChannel = "threads" | "instagram";

const CHANNEL_NAME: Record<ConnectionChannel, string> = { threads: "Threads", instagram: "Instagram" };

const STATUS_LABELS: Record<string, string> = { connected: "연결됨", reauth_required: "재인증 필요", revoked: "연결 해제됨" };

const REAUTH_LABELS: Record<string, string> = {
  decrypt_failed: "저장 토큰을 읽지 못함",
  expired: "토큰 만료",
  key_rotated: "암호화 키 교체",
  manual: "관리자 표시",
};

/** 자체 키만 조회(toString·__proto__ 같은 프로토타입 키가 라벨로 새지 않게). FE-073 */
const own = (m: Record<string, string>, k: string): string | undefined => (Object.hasOwn(m, k) ? m[k] : undefined);

/** 연결 상태 라벨. 모르는 값은 "상태 확인 필요". */
export function connectionStatusLabel(status: string): string {
  return own(STATUS_LABELS, status) ?? "상태 확인 필요";
}

/** 재인증 사유 라벨. 사유가 없으면 null, 모르는 코드는 "재인증 사유 확인 필요". provider_auth는 채널 이름을 붙인다. */
export function reauthReasonLabel(reason: string | null | undefined, channel: ConnectionChannel): string | null {
  if (!reason) return null;
  if (reason === "provider_auth") return `${CHANNEL_NAME[channel]} 인증 거절`;
  return own(REAUTH_LABELS, reason) ?? "재인증 사유 확인 필요";
}
