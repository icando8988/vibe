/**
 * 채널 연결 DTO·상수. AUTOPOST-M3-CONNECTION-017.
 * UI/DTO에는 credential(암호문·nonce·tag·토큰·secret)이 절대 들어가지 않는다 — 응답 파서가 허용 키만 받는다.
 */

export const CONNECTION_CHANNELS = ["threads", "instagram"] as const;
export type ConnectionChannel = (typeof CONNECTION_CHANNELS)[number];

export const CONNECTION_STATUSES = ["connected", "reauth_required", "revoked"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const REAUTH_REASONS = ["decrypt_failed", "provider_auth", "expired", "key_rotated", "manual"] as const;
export type ReauthReason = (typeof REAUTH_REASONS)[number];

/**
 * Threads OAuth가 요청할 권한 — 출처: Threads_Auto_Posting_Kit_v1.02/threads/src/lib/threads/client.ts THREADS_SCOPES
 * (© BUYLIFE, web/src/server/distribution/threads/NOTICE). OAuth는 다음 단계이며 저장 함수는 이 값을 강제하지 않는다.
 */
export const THREADS_OAUTH_SCOPES = ["threads_basic", "threads_content_publish"] as const;

export type ConnectionDto = {
  id: string;
  channel: ConnectionChannel;
  providerAccountId: string;
  accountLabel: string | null;
  scopes: string[];
  status: ConnectionStatus;
  reauthReason: ReauthReason | null;
  expiresAt: string;
  /** 만료 여부는 조회 시점 기준 화면 계산(DB 상태와 별개) */
  expired: boolean;
  keyVersion: number | null;
  hasCredential: boolean | null; // 목록에서만 알 수 있음(저장 응답은 null)
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

/** 응답에 이런 키가 있으면 형식 오류로 거절(비밀 유출 차단). */
export const FORBIDDEN_RESPONSE_KEYS = ["ciphertext", "nonce", "auth_tag", "tag", "token", "access_token", "secret", "app_secret"] as const;
