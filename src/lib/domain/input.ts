/**
 * 외부 입력 검증 순수 함수: 로그인 복귀 경로, 멱등키.
 */

/**
 * 로그인 후 돌아갈 내부 경로만 허용한다(오픈 리디렉션 방지).
 * 허용: "/"로 시작하는 같은 사이트 경로. 거부: 프로토콜 상대(//), 역슬래시, 스킴, 제어문자.
 */
export function safeReturnTo(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\")) return fallback;
  // 제어문자(탭·개행 등)는 브라우저가 제거해 //로 바뀔 수 있다.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  // 인코딩된 슬래시/역슬래시로 우회하는 경우
  const lowered = value.toLowerCase();
  if (lowered.startsWith("/%2f") || lowered.startsWith("/%5c")) return fallback;
  try {
    const url = new URL(value, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** 멱등키: 16~128자 영숫자·_·-. 사용자+작업+키 단위로 유일하게 저장한다. */
export function isValidIdempotencyKey(raw: unknown): raw is string {
  return typeof raw === "string" && IDEMPOTENCY_KEY.test(raw);
}
