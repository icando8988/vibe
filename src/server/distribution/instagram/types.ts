/**
 * Instagram 단일 이미지 게시 타입 — AUTOPOST-INSTAGRAM-PORT-021.
 * 출처: Insta_Auto_Posting_Kit_v1.11/insta_auto_poster/src/lib/instagram/publish.ts(© BUYLIFE — 같은 폴더 NOTICE, 고지 보존).
 * 이식 범위: Instagram 로그인 경로(graph.instagram.com)의 이미지 컨테이너·상태·게시·permalink 결과 계약만.
 * 제외: Facebook 로그인 경로, 캐러셀, OAuth·토큰 교환·계정 조회, 업로드·JPEG 변환·Storage(M4).
 */

/** 공식 문서 컨테이너 status_code 값(ig-container). FINISHED는 "게시 준비됨"이지 게시 확정이 아니다. */
export const IG_CONTAINER_STATUSES = ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"] as const;
export type IgContainerStatus = (typeof IG_CONTAINER_STATUSES)[number];

/** 정제된 오류 — 공급자 메시지·URL·토큰·이미지 URL은 담지 않는다(분류·숫자 코드만). */
export type IgErrorCode =
  | "timeout"
  | "network"
  | "http_5xx"
  | "rate_limited"
  | "auth"
  | "rejected"
  | "bad_response"
  | "invalid_input";

export type IgError = { code: IgErrorCode; httpStatus: number | null; providerCode: number | null };

/** 컨테이너 생성: 게시 아님. timeout·유실이면 컨테이너가 생겼는지 모름(definite=false) — 게시 요청 없이는 공개되지 않는다. */
export type IgCreateContainerResult = { ok: true; containerId: string } | { ok: false; definite: boolean; error: IgError };

export type IgContainerStatusResult = { ok: true; status: IgContainerStatus } | { ok: false; error: IgError };

/**
 * media_publish 결과. timeout·응답 유실·5xx·2xx인데 ID 없음 → unknown(게시됐을 수 있음, 재전송 금지·대사 필요).
 * 공급자가 4xx 오류 본문으로 명시 거절했을 때만 rejected. config_issue가 있어도 ID가 있으면 published(문서상 부분 성공).
 */
export type IgPublishResult =
  | { kind: "published"; mediaId: string; hasConfigIssue: boolean }
  | { kind: "rejected"; error: IgError }
  | { kind: "unknown"; error: IgError };

export type IgPermalinkResult = { ok: true; permalink: string } | { ok: false; error: IgError };

export type IgPublishOutcome =
  | { kind: "published"; mediaId: string; permalink: string; urlConfirmed: true }
  | { kind: "published"; mediaId: string; permalink: null; urlConfirmed: false } // 게시 확인 + URL 미확인(실패 아님)
  | { kind: "rejected"; error: IgError }
  | { kind: "unknown"; error: IgError };

/** 의존성 주입: 실제 fetch는 등록하지 않는다(live adapter·실행기 없음). */
export type IgHttpDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};
