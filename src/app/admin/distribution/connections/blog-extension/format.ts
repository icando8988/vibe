/**
 * 토큰 화면 시각 표시(UX-FIX-008 BC-05). 서버 목록·발급 결과·철회 확인이 같은 기준을 쓴다:
 * 브라우저 시간대와 무관하게 한국 표준시(KST, Asia/Seoul)로 표시하고 기준을 글자로 붙인다.
 */
export const DISPLAY_TZ_LABEL = "KST";

export function formatKst(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
  return `${s} ${DISPLAY_TZ_LABEL}`;
}

export function formatLastUsed(iso: string | null | undefined): string {
  return formatKst(iso) ?? "사용 기록 없음";
}
