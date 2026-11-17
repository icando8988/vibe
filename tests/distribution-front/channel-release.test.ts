/**
 * FE-CHANNEL-RELEASE-034 — 세 채널 통합 동선·안내 회귀(서버 렌더 문자열·정적 경로 검사, 브라우저 실측 아님).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/admin/distribution" }));

const { CHANNEL_INFO, CHANNELS } = await import("@/components/distribution-console/readiness");
const { CapabilityTable, ChannelCards, IdLine } = await import("@/components/distribution-console/states");
const { ConsoleShell } = await import("@/components/distribution-console/console-shell");
type ShellProps = ComponentProps<typeof ConsoleShell>; // children은 createElement 세 번째 인자로 전달

const root = process.cwd();
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("채널 안내가 현재 구현과 일치", () => {
  it("Blog=수동+증거, Threads=연결·모의 실행·게시 닫힘, Instagram=초안·미디어 권리·연결/게시 미구현", () => {
    expect(CHANNEL_INFO.blog.summary).toContain("수동 게시 작업");
    expect(CHANNEL_INFO.blog.summary).toContain("게시 증거");
    expect(CHANNEL_INFO.blog.blocked).not.toContain("연결되지 않았습니다");
    expect(CHANNEL_INFO.threads.summary).toContain("계정을 연결");
    expect(CHANNEL_INFO.threads.summary).toContain("모의 실행 작업");
    expect(CHANNEL_INFO.threads.blocked).toContain("live gate가 닫혀");
    // 034 정정: 모의 실행은 작업 상세에서 관리자가 수동 실행 가능(runDryRunAction → runThreadsDryRun 연결과 일치)
    expect(CHANNEL_INFO.threads.blocked).toContain("관리자가 작업 상세에서 직접 실행");
    expect(CHANNEL_INFO.threads.blocked).not.toMatch(/모의 실행 작업도 아직 실행되지 않습니다|실행되지 않습니다/);
    const jobActions = readFileSync(join(root, "src", "app", "admin", "distribution", "jobs", "actions.ts"), "utf8");
    expect(jobActions).toMatch(/export async function runDryRunAction[\s\S]*runThreadsDryRun\(/);
    const jobPage = readFileSync(join(root, "src", "app", "admin", "distribution", "jobs", "[jobId]", "page.tsx"), "utf8");
    expect(jobPage).toContain("<ActionForm action={runDryRunAction}");
    // 034 정정2: 실행 준비 화면도 같은 경로(대기 작업 생성 → 작업 상세 버튼으로 수동 실행)를 안내, OAuth·토큰 미구현 단정 없음
    const prep = readFileSync(join(root, "src", "app", "admin", "distribution", "contents", "[contentId]", "prepare", "page.tsx"), "utf8");
    expect(prep).toContain("작업 상세의 '모의 실행' 버튼으로 관리자가 직접 실행");
    expect(prep).toContain("자동 실행기(스케줄러)는 없");
    expect(prep).toContain("live gate가 닫혀");
    expect(prep).not.toMatch(/실행기\(워커·스케줄러\)가 아직 없어 실행되지 않으며|계정 연결\(OAuth\)·토큰 저장·live gate가 준비되지 않아/);
    expect(prep).toContain('href={`/admin/distribution/jobs/${openThreadsDry.id}`}');
    expect(CHANNEL_INFO.instagram.summary).toContain("미디어 권리");
    expect(CHANNEL_INFO.instagram.blocked).toContain("OAuth");
    expect(CHANNEL_INFO.instagram.blocked).toContain("live gate가 닫혀");
    // 044: Instagram 연결 화면·초안 이미지 선택이 생겼으므로 "없다"고 단정하지 않고, OAuth는 서버 준비 상태로 구분
    expect(CHANNEL_INFO.instagram.blocked).not.toMatch(/초안 이미지 첨부 화면|계정 연결(OAuth)·/);
    expect(CHANNEL_INFO.instagram.blocked).toContain("준비 상태로 확인");
    expect(CHANNEL_INFO.instagram.summary).toContain("이미지 1장 선택");
    // 어떤 채널도 실제 게시 가능·연결 완료를 말하지 않는다
    for (const c of CHANNELS) {
      const all = `${CHANNEL_INFO[c].summary} ${CHANNEL_INFO[c].blocked} ${CHANNEL_INFO[c].methodTag}`;
      expect(all).not.toMatch(/게시할 수 있습니다|자동 게시됩니다|연결 완료/);
    }
  });

  it("채널 카드 렌더: 세 채널·막힌 이유 표시", () => {
    const out = html(createElement(ChannelCards));
    for (const c of CHANNELS) expect(out).toContain(CHANNEL_INFO[c].label);
    expect(out).toContain("현재 막힌 이유");
  });

  it("콘솔 기본 안내: 구 '입력·버튼 동작 안 함' 문구 없음, 게시 gate 닫힘·채널별 범위 명시, 화면별 gateNotice는 그대로 우선", () => {
    const out = html(createElement(ConsoleShell, { section: "overview", title: "t" } as unknown as ShellProps, createElement("p", null, "body")));
    expect(out).not.toContain("동작하지 않으며");
    expect(out).toContain("실제 게시 gate 닫힘");
    expect(out).toContain("자동 게시는 열려 있지 않습니다");
    expect(out).toContain("Threads는 계정 연결·모의 실행 작업까지");
    const custom = html(createElement(ConsoleShell, { section: "media", title: "t", gateNotice: createElement("p", null, "CUSTOM-GATE") } as unknown as ShellProps, null));
    expect(custom).toContain("CUSTOM-GATE");
    expect(custom).not.toContain("저장은 서버 연결 기준");
  });

  it("기능 준비도 표는 정적 connected 값을 계정 연결 상태로 표시하지 않는다(기능 검증 ≠ 계정 조회)", () => {
    for (const c of CHANNELS) {
      const out = html(createElement(CapabilityTable, { channel: c }));
      expect(out).not.toMatch(/연결 상태: |연결 안 됨|연결됨/);
      expect(out).toContain("기능 검증 상태만");
      expect(out).toContain("연결 화면에서 확인");
    }
    expect(readFileSync(join(root, "src", "components", "distribution-console", "states.tsx"), "utf8")).not.toContain("caps.connected");
  });

  it("IdLine은 조회 미연결을 단정하지 않는다", () => {
    const out = html(createElement(IdLine, { label: "자산 ID", value: "x" }));
    expect(out).not.toContain("조회 경로 미연결");
    expect(out).toContain("아래 조회 결과로 확인");
  });
});

describe("동선: 진입·내부 링크", () => {
  it("모든 고정 /admin 내부 링크는 실제 page.tsx 경로가 있다(끊긴 링크 없음)", () => {
    const appDir = join(root, "src", "app");
    const routes = new Set(
      walk(appDir)
        .filter((p) => p.endsWith(`${sep}page.tsx`))
        .map((p) => "/" + relative(appDir, p).split(sep).slice(0, -1).join("/"))
        .map((r) => (r === "/" ? "/" : r)),
    );
    const files = [...walk(join(root, "src", "app")), ...walk(join(root, "src", "components"))].filter((p) => /\.(tsx|ts)$/.test(p));
    const hrefs = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/href=\{?[`"](\/admin[^`"?#]*)/g)) hrefs.add(m[1]!);
    expect(hrefs.size).toBeGreaterThan(5);
    for (const h of hrefs) {
      // 동적 세그먼트(${...})는 [param] 경로로 대응
      const segs = h.split("/").filter(Boolean);
      const ok = [...routes].some((r) => {
        const rs = r.split("/").filter(Boolean);
        return rs.length === segs.length && rs.every((s, i) => s === segs[i] || (/^\[.+\]$/.test(s) && segs[i]!.includes("${")));
      });
      expect(ok, `끊긴 링크: ${h}`).toBe(true);
    }
  });

  it("/me → /admin → 콘솔 진입이 있고, 관리 진입 문구가 현재 범위와 맞다", () => {
    expect(readFileSync(join(root, "src", "app", "me", "page.tsx"), "utf8")).toContain('href="/admin"');
    const admin = readFileSync(join(root, "src", "app", "admin", "page.tsx"), "utf8");
    expect(admin).toContain('href="/admin/distribution"');
    expect(admin).not.toContain("저장·예약·게시는 할 수 없습니다");
    expect(admin).toContain("자동 게시·예약은 열려 있지 않습니다");
  });

  it("Instagram: 연결 화면·초안 화면이 실제 미디어·권리 화면으로 안내하고, 연결은 전용 화면(044)으로 안내", () => {
    const conn = readFileSync(join(root, "src", "app", "admin", "distribution", "connections", "page.tsx"), "utf8");
    expect(conn).toContain('href="/admin/distribution/media"');
    expect(conn).toContain('href="/admin/distribution/connections/instagram"'); // FE-INSTAGRAM-OAUTH-044: 비활성 버튼 → 전용 연결 화면
    const draft = readFileSync(join(root, "src", "app", "admin", "distribution", "contents", "[contentId]", "channels", "[channel]", "page.tsx"), "utf8");
    expect(draft).toContain('href="/admin/distribution/media"');
    expect(draft).not.toContain("기능이 준비되면 연결됩니다");
    // 044에서 Instagram 연결 화면이 생겼다(start 폼만, OAuth 흐름은 서버 라우트)
    expect(existsSync(join(root, "src", "app", "admin", "distribution", "connections", "instagram", "page.tsx"))).toBe(true);
  });

  it("개요의 작업 영역은 '운영 데이터 미연결'을 단정하지 않고 실제 작업 화면으로 안내", () => {
    const ov = readFileSync(join(root, "src", "app", "admin", "distribution", "page.tsx"), "utf8");
    expect(ov).not.toContain("<NotConnected");
    expect(ov).toContain('href="/admin/distribution/jobs"');
  });
});
