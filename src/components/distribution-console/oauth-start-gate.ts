/**
 * OAuth 연결 시작 폼의 중복 제출 차단 판정(FE-CONNECTIONS-START-LOCK-060). 순수 로직 — 시험 대상.
 * start POST는 요청마다 서버에 state 1개를 등록하고, 관리자당 열린 state 상한(Threads·Instagram 합산 5개, 10분)을 쓴다.
 * 연타로 같은 의도의 요청이 여러 번 나가지 않도록 첫 제출 뒤 잠근다.
 * - 잠금 해제: 뒤로가기 캐시(bfcache)로 페이지가 되살아날 때(`pageshow` persisted), 또는 잠근 뒤 RELOCK_MS가 지나면
 *   (이동이 멈췄을 때 사용자가 다시 시도할 수 있게). 해제는 다시 시작을 허용할 뿐 자동 재전송하지 않는다.
 */
export const START_RELOCK_MS = 15_000;

export type StartGate = {
  /** 제출 허용 여부. 허용이면 그 시각으로 잠근다. */
  tryStart(now: number): boolean;
  /** bfcache 복원 등으로 다시 시작을 허용. */
  reset(): void;
  isLocked(now: number): boolean;
};

export function createStartGate(relockMs: number = START_RELOCK_MS): StartGate {
  let lockedAt: number | null = null;
  const locked = (now: number) => lockedAt !== null && now - lockedAt < relockMs;
  return {
    tryStart(now) {
      if (locked(now)) return false;
      lockedAt = now;
      return true;
    },
    reset() {
      lockedAt = null;
    },
    isLocked: locked,
  };
}
