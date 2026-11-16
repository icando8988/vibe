/**
 * 본문 → 단락 배열. HTML을 해석하지 않으며 React 텍스트 노드로 렌더해 자동 이스케이프한다.
 * dangerouslySetInnerHTML을 쓰지 않는다.
 */

const MAX_PARAGRAPHS = 400;
const MAX_PARAGRAPH_LENGTH = 5000;

/** 탭·줄바꿈을 제외한 제어문자와 양방향 재정렬 제어문자 제거 */
function stripControl(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const control = (c < 0x20 && c !== 0x0a && c !== 0x09) || c === 0x7f || (c >= 0x80 && c < 0xa0);
    const bidi = (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    if (!control && !bidi) out += ch;
  }
  return out;
}

export function toParagraphs(body: string): string[] {
  const normalized = stripControl(body.replace(/\r\n?/g, "\n"));
  return normalized
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter((p) => p.length > 0)
    .slice(0, MAX_PARAGRAPHS)
    .map((p) => (p.length > MAX_PARAGRAPH_LENGTH ? `${p.slice(0, MAX_PARAGRAPH_LENGTH)}…` : p));
}

/** 메타 설명용 한 줄 요약 */
export function toPlainDescription(text: string, max = 160): string {
  const flat = stripControl(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
