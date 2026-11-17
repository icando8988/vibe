/**
 * 이식한 네이버 블로그 확장(web/extension/naver-blog)의 정적·설정 검사.
 * - 원본 운영 서버·외부 기본 도메인·임의 localhost 주소가 남아 있지 않은지
 * - 기본 설정이 "연결 준비 전"이라 어떤 서버 요청도 보내지 않는지(config.js를 격리 실행해 확인)
 * - 최종 [발행] 버튼을 누르는 경로가 없는지(원본 규칙 유지)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "extension", "naver-blog");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const codeFiles = readdirSync(DIR).filter((f) => /\.(js|html|json)$/.test(f));

type ConfigApi = {
  requireSite: () => string;
  isSiteUrl: (v: unknown) => boolean;
  originProblem: (v: string) => string;
};

function loadConfig(patch?: (src: string) => string): ConfigApi {
  const src = patch ? patch(read("config.js")) : read("config.js");
  const sandbox: { self: Record<string, unknown>; URL: typeof URL } = { self: {}, URL };
  runInNewContext(src, sandbox);
  return sandbox.self.NaverBlogExtConfig as ConfigApi;
}

describe("확장 이식본 — 주소", () => {
  it.each(codeFiles)("%s: 원본 운영 주소·자리표시·하드코딩 주소 없음", (f) => {
    const text = read(f);
    expect(text).not.toMatch(/buylife\.xyz|vercel\.app|__SITE_URL__|__SUPABASE_URL__|supabase\.co/i);
    expect(text).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
  });
  it("서버 주소 상수(BASE)가 없고 fetch는 설정 주소를 쓴다", () => {
    for (const f of ["background.js", "sidepanel.js"]) {
      const text = read(f);
      expect(text).not.toMatch(/const BASE\s*=/);
      const fetches = text.match(/fetch\(`?[^,)]*/g) ?? [];
      for (const call of fetches) expect(call === "fetch(block.url" || call.startsWith("fetch(`${base}")).toBe(true);
    }
  });
  it("manifest: 기본 권한은 네이버만, content_scripts 없음", () => {
    const m = JSON.parse(read("manifest.json")) as { host_permissions: string[]; content_scripts?: unknown };
    expect(m.host_permissions).toEqual(["https://*.naver.com/*"]);
    expect(m.content_scripts).toBeUndefined();
  });
  it("원본 NOTICE와 출처 문서 보존", () => {
    expect(read("NOTICE")).toContain("BUYLIFE");
    expect(read("SETUP.md")).toContain("Blog_Posting_Kit_v1.07");
  });
});

describe("확장 이식본 — config.js", () => {
  it("기본값: 주소 미설정 → 연결 준비 전 오류, 어떤 출처도 허용 안 함", () => {
    const cfg = loadConfig();
    expect(() => cfg.requireSite()).toThrow(/연결 준비 전/);
    expect(cfg.isSiteUrl("https://anything.example/page")).toBe(false);
  });
  it("주소를 넣어도 API_READY=false면 요청 차단", () => {
    const cfg = loadConfig((s) => s.replace('SITE_ORIGIN: ""', 'SITE_ORIGIN: "https://site.example"'));
    expect(() => cfg.requireSite()).toThrow(/API가 아직 구현되지 않았습니다/);
    expect(cfg.isSiteUrl("https://site.example/admin")).toBe(true);
    expect(cfg.isSiteUrl("https://site.example.evil.test/")).toBe(false);
  });
  it("주소·API 준비가 모두 되면 origin 반환", () => {
    const cfg = loadConfig((s) => s.replace('SITE_ORIGIN: ""', 'SITE_ORIGIN: "https://site.example"').replace("API_READY: false", "API_READY: true"));
    expect(cfg.requireSite()).toBe("https://site.example");
  });
  it.each(["http://site.example", "https://site.example/", "https://site.example/path", "nope"])("잘못된 주소 거절: %s", (v) => {
    expect(loadConfig().originProblem(v)).not.toBe("");
  });
});

describe("확장 이식본 — 최종 발행 금지", () => {
  it("최종 발행 버튼(seOnePublishBtn)은 제외 조건에만 등장", () => {
    for (const f of codeFiles.filter((name) => name.endsWith(".js"))) {
      const text = read(f);
      // 선택·비교로 최종 발행 버튼을 고르는 형태가 없어야 한다(제외 조건 `!==`만 허용).
      expect(text).not.toMatch(/===\s*"seOnePublishBtn"|\[data-testid=["']?seOnePublishBtn/);
      for (const line of text.split("\n").filter((l) => l.includes("seOnePublishBtn"))) {
        expect(/!==\s*"seOnePublishBtn"/.test(line) || line.trim().startsWith("//")).toBe(true);
      }
    }
    expect(read("naver-page.js")).toContain('el.getAttribute("data-testid") !== "seOnePublishBtn"');
    expect(read("naver-adapter.js")).toContain('마지막 "발행" 버튼은 누르지 않는다');
  });
});
