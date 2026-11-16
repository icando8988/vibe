/**
 * MKT-006 회귀 방지: 이야기 상세 라우트는 없는·비공개 slug를 라우팅 단계 404로 처리해야 한다.
 * (페이지 렌더 중 notFound()에 의존하면 Next 16.4.6이 빈 오류 셸 HTML을 보내 JS 없이 빈 화면이 된다.)
 * 실제 HTML 확인은 docs/qa/MKT-006/check-raw-html.mjs (production build/start 필요).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getStoryRepository } from "@/lib/content";

const source = readFileSync(join(process.cwd(), "src", "app", "stories", "[slug]", "page.tsx"), "utf8");

describe("이야기 상세 라우트 설정", () => {
  it("dynamicParams=false + generateStaticParams", () => {
    expect(source).toMatch(/export const dynamicParams = false;/);
    expect(source).toMatch(/export async function generateStaticParams\(/);
  });

  it("요청 시 동적 렌더로 되돌리지 않는다(force-dynamic 금지)", () => {
    expect(source).not.toMatch(/dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("정적 경로는 공개 판정을 통과한 글에서만 만든다(현재 빈 저장소 → 0개)", async () => {
    expect(source).toMatch(/listPublished\(/);
    expect(await getStoryRepository().listPublished(new Date())).toEqual([]);
  });
});
