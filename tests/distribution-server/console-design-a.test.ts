/**
 * AUTOPOST-DESIGN-A-013: 디자인 A 콘솔의 메뉴 모델·관리 진입 권한·CSS 범위 회귀 시험.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showAdminEntry } from "@/components/distribution-console/access";
import { ALL_NAV_ITEMS, CONSOLE_NAV, CONTENT_FLOW } from "@/components/distribution-console/nav";
import type { Viewer } from "@/lib/auth/viewer";

const ID = "11111111-2222-4333-8444-555555555555";
const member = (approval: "approved" | "pending" | "suspended", roles: Array<"admin" | "member">): Viewer => ({ kind: "member", userId: ID, approval, roles });

describe("A안 메뉴 모델", () => {
  it("작업 공간 / 연결과 운영 두 묶음, 원문(콘텐츠 보관함)이 작업 공간에 있음", () => {
    expect(CONSOLE_NAV.map((g) => g.label)).toEqual(["작업 공간", "연결과 운영"]);
    expect(CONSOLE_NAV[0]?.items.map((i) => i.key)).toEqual(["overview", "contents", "jobs", "media"]);
    expect(CONSOLE_NAV[1]?.items.map((i) => i.key)).toEqual(["connections", "extension"]);
  });
  it("모든 메뉴는 콘솔 안 경로, 키·경로 중복 없음", () => {
    for (const i of ALL_NAV_ITEMS) expect(i.href.startsWith("/admin/distribution")).toBe(true);
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.key)).size).toBe(ALL_NAV_ITEMS.length);
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.href)).size).toBe(ALL_NAV_ITEMS.length);
  });
  it("메뉴 경로는 실제 존재하는 페이지로만 이어짐(가짜 진입 없음)", () => {
    const appDir = join(process.cwd(), "src", "app");
    for (const i of ALL_NAV_ITEMS) {
      expect(statSync(join(appDir, ...i.href.split("/").filter(Boolean), "page.tsx")).isFile(), i.href).toBe(true);
    }
  });
  it("구현되지 않은 기능(글감·AI 생성·캠페인)은 메뉴에 없음", () => {
    const labels = ALL_NAV_ITEMS.map((i) => i.label).join(" ");
    expect(labels).not.toMatch(/글감|AI|캠페인|캘린더/);
  });
  it("A안 흐름: 원문 → 채널 초안 → 검토·승인 → 실행 준비", () => {
    expect(CONTENT_FLOW).toEqual(["원문 작성", "채널 초안", "채널별 검토·승인", "개별 실행 준비"]);
  });
});

describe("회원 영역 관리 진입(DQ-04)", () => {
  it("승인된 admin만 true", () => {
    expect(showAdminEntry(member("approved", ["admin"]))).toBe(true);
  });
  it.each([
    ["비승인 admin", member("pending", ["admin"])],
    ["정지 admin", member("suspended", ["admin"])],
    ["승인된 일반 회원", member("approved", ["member"])],
    ["비로그인", { kind: "anonymous", reason: "not_signed_in" } as Viewer],
    ["인증 미설정", { kind: "anonymous", reason: "auth_not_configured" } as Viewer],
  ])("%s → false", (_, v) => {
    expect(showAdminEntry(v)).toBe(false);
  });
});

describe("콘솔 CSS 범위(DQ-01)", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = css.slice(css.lastIndexOf("/*", css.indexOf("디자인 A(콘텐츠 중심)")));
  it("콘솔 규칙은 .dc-console 아래(관리 진입 카드 제외), !important 없음", () => {
    const selectors = block
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((r) => r.split("{")[0]?.trim() ?? "")
      .filter((s) => s && !s.startsWith("@"));
    for (const sel of selectors) {
      for (const part of sel.split(",").map((p) => p.trim()).filter(Boolean)) {
        expect(part === ".dc-console" || part.startsWith(".dc-console ") || part === ".dc-admin-entry", part).toBe(true);
      }
    }
    expect(block.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("!important");
  });
  it("콘솔 h1·사유 문단이 공통 .ds-main 규칙보다 높은 특정성", () => {
    expect(block).toContain(".dc-console .dc-pagehead h1");
    expect(block).toContain(".dc-console .dc-reason");
    expect(block).toMatch(/\.dc-console \.dc-filters input/); // DQ-02 필터 폰트·여백 공유
    expect(block).toMatch(/max-width: 700px[\s\S]*\.dc-channel-links ul \{ flex-direction: column; \}/); // DQ-03
  });
  it("콘솔 셸은 main에 dc-console을 단다", () => {
    expect(readFileSync(join(process.cwd(), "src", "components", "distribution-console", "console-shell.tsx"), "utf8")).toContain('className="ds-main dc-console"');
  });
});

describe("콘솔 페이지 공통 규칙 유지", () => {
  const root = join(process.cwd(), "src", "app", "admin", "distribution");
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === "page.tsx") pages.push(p);
    }
  };
  walk(root);
  it("모든 콘솔 page가 D1 guard를 먼저 호출하고 force-dynamic", () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toContain("await denyUnlessDistributionAdmin()");
      expect(src, p).toContain('export const dynamic = "force-dynamic"');
      const guardAt = src.indexOf("denyUnlessDistributionAdmin()");
      const paramsAt = src.indexOf("await params");
      if (paramsAt >= 0) expect(guardAt, p).toBeLessThan(paramsAt);
    }
  });
  it("재게시·복제 버튼 문구 없음", () => {
    for (const p of pages) expect(readFileSync(p, "utf8"), p).not.toMatch(/>\s*(재게시|다시 게시|복제)\s*</);
  });
});
