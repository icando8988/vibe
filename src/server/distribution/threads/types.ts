/**
 * Threads 텍스트 게시 타입. AUTOPOST-THREADS-PORT-016.
 * 출처: Threads_Auto_Posting_Kit_v1.02/threads/src/lib/threads/types.ts (© BUYLIFE, 같은 폴더 NOTICE 참조 — 고지 보존).
 * 이식 범위: 텍스트 컨테이너·상태·게시·permalink 응답 타입만. OAuth·토큰 교환·프로필·이미지/영상/캐러셀 타입은 다음 단계라 제외.
 * 변경: 응답 타입은 원본 이름 유지, 결과는 예외 대신 판별 가능한 결과 계약(ThreadsStepResult 등)으로 바꿨다.
 */

// ---- 원본 응답 타입(이름·필드 유지) ----
export interface ThreadsContainerResponse {
  id: string;
}

export interface ThreadsContainerStatusResponse {
  status: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  error_message?: string;
}

export interface ThreadsPublishResponse {
  id: string;
}

export interface ThreadsApiError {
  error: {
    message: string;
    type?: string;
    code?: number;
  };
}

// ---- 이식 후 결과 계약 ----

/** 정제된 오류: 공급자 메시지·URL·토큰은 담지 않는다(숫자 코드·분류만). */
export type ThreadsErrorCode =
  | "timeout" // 시간 초과(요청이 닿았는지 모름)
  | "network" // 연결 실패·응답 유실
  | "http_5xx"
  | "rate_limited"
  | "auth" // 토큰 만료·권한 없음(재연결 필요)
  | "rejected" // 4xx + 공급자 오류 본문
  | "bad_response" // 2xx인데 형식이 다름
  | "invalid_input"; // 호출 전 검증 실패(요청 안 보냄)

export type ThreadsError = { code: ThreadsErrorCode; httpStatus: number | null; providerCode: number | null };

/** 컨테이너 생성: 게시가 아니다. 실패해도 외부 글은 생기지 않는다(단 timeout이면 컨테이너가 남았을 수 있음). */
export type CreateContainerResult = { ok: true; containerId: string } | { ok: false; definite: boolean; error: ThreadsError };

export type ContainerStatusResult =
  | { ok: true; status: ThreadsContainerStatusResponse["status"]; hasErrorMessage: boolean }
  | { ok: false; error: ThreadsError };

/**
 * publish 결과. 응답 유실·timeout·5xx·형식 오류는 **unknown**(게시됐을 수 있음 → 재시도 금지, 대사 필요).
 * 공급자가 4xx 오류 본문으로 명시 거절했을 때만 rejected.
 */
export type PublishContainerResult =
  | { kind: "published"; postId: string }
  | { kind: "rejected"; error: ThreadsError }
  | { kind: "unknown"; error: ThreadsError };

export type PermalinkResult = { ok: true; permalink: string } | { ok: false; error: ThreadsError };

/** publish + permalink를 합친 최종 판정(호출은 각각 따로 한다). */
export type ThreadsPublishOutcome =
  | { kind: "published"; postId: string; permalink: string; urlConfirmed: true }
  | { kind: "published"; postId: string; permalink: null; urlConfirmed: false } // 게시 확인 + URL 미확인(실패 아님)
  | { kind: "rejected"; error: ThreadsError }
  | { kind: "unknown"; error: ThreadsError };

/** 의존성 주입: 실제 fetch는 아직 등록하지 않는다(live adapter 미등록). 테스트는 mock fetch. */
export type ThreadsHttpDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** 요청별 제한 시간(ms). 기본 15000 */
  timeoutMs?: number;
};
