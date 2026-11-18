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
    const url = new URL(value, INTERNAL_BASE);
    if (url.origin !== INTERNAL_BASE) return fallback;
    const normalized = url.pathname + url.search + url.hash;
    // BE-AUTH-RETURNTO-111: 입력이 아니라 **정규화 결과**를 다시 검사한다.
    // "/..//evil.example"·"/%2e%2e//evil.example"처럼 점 세그먼트를 지운 결과가 "//host"가 되면
    // 브라우저·redirect·new URL(next, origin)이 외부 출처로 해석한다.
    return isSameOriginPath(normalized) ? normalized : fallback;
  } catch {
    return fallback;
  }
}

const INTERNAL_BASE = "http://internal.invalid";

/**
 * 정규화된 경로가 어떤 소비자(href·Location·new URL(path, origin))에서도 같은 출처로 남는지.
 * - "/" 하나로 시작하고 두 번째 글자가 "/"·"\"가 아니다(프로토콜 상대 금지).
 * - 맨 앞 세그먼트가 인코딩된 슬래시·역슬래시가 아니다(디코딩하는 소비자 대비).
 * - 제어문자가 없다.
 * - 다시 해석해도 같은 출처이고 같은 문자열이다(정규화가 끝난 고정점).
 */
function isSameOriginPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
  const lowered = path.toLowerCase();
  if (lowered.startsWith("/%2f") || lowered.startsWith("/%5c")) return false;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  const again = new URL(path, INTERNAL_BASE);
  return again.origin === INTERNAL_BASE && again.pathname + again.search + again.hash === path;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** 멱등키: 16~128자 영숫자·_·-. 사용자+작업+키 단위로 유일하게 저장한다. */
export function isValidIdempotencyKey(raw: unknown): raw is string {
  return typeof raw === "string" && IDEMPOTENCY_KEY.test(raw);
}
