/**
 * FE-CONNECTIONS-START-LOCK-060 — Threads 계정 연결 화면 계약·렌더 회귀(서버 렌더 문자열, 브라우저·Meta 실측 아님).
 * 결과 코드·경로·env 이름은 실제 Threads 모듈 값을 쓰고, 준비도·연결 목록만 대역으로 둔다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  ready: { ready: true, missing: [] as string[], serviceReady: true, redirectUri: "https://example.test/api/distribution/oauth/threads/callback" as string | null },
  listed: { status: "ok", connections: [] as unknown[] } as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/admin/distribution/connections/threads", redirect: () => undefined }));
vi.mock("@/components/distribution-console/guard", () => ({ denyUnlessDistributionAdmin: async () => null }));
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: async () => ({ ok: true }) }));
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => null }));
vi.mock("@/server/distribution/connections/service", () => ({ listConnections: async () => env.listed, revokeConnection: async () => ({ status: "ok", value: {} }) }));
vi.mock("@/server/distribution/threads/oauth/session", async () => {
  const cfg = await vi.importActual<typeof import("@/server/distribution/threads/oauth/config")>("@/server/distribution/threads/oauth/config");
  return { OAUTH_ENV: cfg.OAUTH_ENV, threadsOAuthReadiness: () => env.ready };
});

const Page = (await import("@/app/admin/distribution/connections/threads/page")).default;
const { OAUTH_RESULTS } = await import("@/server/distribution/threads/oauth/flow");
const { THREADS_CALLBACK_PATH } = await import("@/server/distribution/threads/oauth/endpoints");
const { revokeThreadsConnectionAction } = await import("@/app/admin/distribution/connections/threads/actions");

const START = "/api/distribution/oauth/threads/start";
const TH1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conn = (o: Record<string, unknown> = {}) => ({
  id: TH1, channel: "threads", providerAccountId: "TH-ACC-1", accountLabel: null, scopes: ["threads_basic", "threads_content_publish"],
  status: "connected", reauthReason: null, expiresAt: "2027-01-16T00:00:00Z", expired: false, keyVersion: 1, hasCredential: true, rowVersion: 4,
  createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", revokedAt: null, ...o,
});
async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);
}
const startForms = (out: string) => [...out.matchAll(/<form\s[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`action="${START}"`));
/** 텍스트가 정확히 같은 <button>들의 속성 맵(속성 순서 무관). FE-073 */
const buttonsByText = (out: string, text: string) =>
  [...out.matchAll(/<button((?:\s[^>]*)?)>([^<]*)<\/button>/g)]
    .filter((m) => m[2] === text)
    .map((m) => Object.fromEntries([...(m[1] ?? "").matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((x) => [x[1], x[2] ?? ""])) as Record<string, string>);
const classes = (b: Record<string, string> | undefined) => (b?.class ?? "").split(/\s+/).filter(Boolean);


beforeEach(() => {
  env.ready = { ready: true, missing: [], serviceReady: true, redirectUri: "https://example.test/api/distribution/oauth/threads/callback" };
  env.listed = { status: "ok", connections: [] };
});

describe("Threads 연결 화면: 준비·시작", () => {
  it("ready: 새 연결 start 폼(method=post, 실제 라우트 경로) 1개·활성, redirect URI·env 이름 표시", async () => {
    const out = await render();
    const forms = startForms(out);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/method="post"/);
    expect(out).toMatch(/<button type="submit" class="ds-button ds-button--primary">새 Threads 계정 연결<\/button>/);
    expect(out).toContain("https://example.test/api/distribution/oauth/threads/callback");
    expect(out).toContain("THREADS_APP_ID, THREADS_APP_SECRET");
    expect(out).toContain("연결됨은 게시 가능이 아닙니다");
  });

  it("not_ready: 빠진 이름만, 시작 버튼 비활성, 기본 redirect 자리표시", async () => {
    env.ready = { ready: false, missing: ["THREADS_APP_SECRET"], serviceReady: false, redirectUri: null };
    const out = await render();
    expect(out).toContain("연결 준비 전: 서버 설정 THREADS_APP_SECRET, SUPABASE_SECRET_KEY");
    const [start] = buttonsByText(out, "새 Threads 계정 연결");
    expect(start).toMatchObject({ type: "submit", disabled: "", "aria-describedby": "th-start-why" });
    expect(classes(start)).toEqual(expect.arrayContaining(["ds-button", "ds-button--primary"]));
    expect(out).toContain('<p id="th-start-why" class="ds-muted dc-reason">사용할 수 없음: 서버 설정 준비 전(위 준비 상태 참고)</p>');
    expect(out).toContain(`&lt;NEXT_PUBLIC_SITE_URL&gt;${THREADS_CALLBACK_PATH}`);
  });

  it("start 경로 하드코딩 값이 실제 start 라우트 파일 위치와 같다", () => {
    const route = join(process.cwd(), "src", "app", ...START.split("/").filter(Boolean), "route.ts");
    expect(readFileSync(route, "utf8")).toContain('form.get("connectionId")');
  });
});

describe("Threads 연결 화면: 결과 코드", () => {
  it("실제 OAUTH_RESULTS 전부에 고유 안내, 목록 밖 값은 렌더 안 함", async () => {
    const seen = new Set<string>();
    for (const r of OAUTH_RESULTS) {
      const m = (await render({ result: r })).match(/role="(?:status|alert)"[\s\S]*?<\/p>/);
      expect(m, r).not.toBeNull();
      seen.add(m![0]);
    }
    expect(seen.size).toBe(OAUTH_RESULTS.length);
    expect(await render({ result: "nope" })).not.toContain("연결이 취소됐습니다");
  });

  it("FE-062 M-1: cancelled는 사용자의 의도적 취소로 단정하지 않는다(쿠키 불일치 + 공급자 error도 포함)", async () => {
    const ca = await render({ result: "cancelled" });
    expect(ca).toContain("연결이 취소됐습니다");
    expect(ca).toContain("취소(허용 안 함)");
    expect(ca).toContain("맞춰 볼 수 없는 오류 응답");
    expect(ca).toContain("아무것도 저장하지 않았습니다");
    expect(ca).not.toMatch(/연결을 취소했습니다|허용하지 않아|직접 취소|눌러|클릭/);
  });

  it("FE-062 M-2: state_limit는 Threads·Instagram 합산 actor 상한을 밝힌다", async () => {
    const sl = await render({ result: "state_limit" });
    expect(sl).toContain("관리자 한 명당");
    expect(sl).toContain("Threads·Instagram을 합쳐 5개");
    expect(sl).toContain("다른 채널 연결 시도 포함");
    expect(sl).toContain("10분");
  });
});

describe("Threads 연결 화면: 목록·재연결·해제 폼", () => {
  it("channel=threads만, 재연결 폼은 렌더된 id·rowVersion, 해제 폼 필드(확인·사유·버전), 토큰 없음", async () => {
    env.listed = { status: "ok", connections: [conn(), conn({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", channel: "instagram", providerAccountId: "IG-ACC-9" })] };
    const out = await render();
    expect(out).toContain("TH-ACC-1");
    expect(out).not.toContain("IG-ACC-9");
    expect(startForms(out)).toHaveLength(2);
    expect(out).toContain(
      `<input type="hidden" name="connectionId" value="${TH1}"/><input type="hidden" name="expectedVersion" value="4"/><button type="submit" class="ds-button ds-button--secondary">같은 계정 재연결</button>`,
    );
    expect(out).toContain('name="confirmRevoke"');
    expect(out).toContain('name="reason"');
    expect(out).toMatch(/연결 해제<\/button>/);
    expect(out).not.toMatch(/access_token|ciphertext|nonce/i);
  });

  it("해제된 연결: 재연결·해제 폼 없음 / not_ready면 재연결 비활성", async () => {
    env.listed = { status: "ok", connections: [conn({ status: "revoked", revokedAt: "2026-11-17T01:00:00Z" })] };
    const rv = await render();
    expect(startForms(rv)).toHaveLength(1);
    expect(rv).not.toContain("연결 해제</button>");
    env.ready = { ready: false, missing: ["THREADS_APP_ID"], serviceReady: true, redirectUri: null };
    env.listed = { status: "ok", connections: [conn()] };
    const [rc] = buttonsByText(await render(), "같은 계정 재연결");
    expect(rc).toMatchObject({ disabled: "", "aria-describedby": `rc-why-${TH1}` });
    expect(classes(rc)).toContain("ds-button--secondary");
  });

  it("조회 not_ready·오류·0건 구분", async () => {
    env.listed = { status: "not_ready" };
    expect(await render()).toContain("조회 준비 전");
    env.listed = { status: "bad_response" };
    expect(await render()).toContain("연결 목록을 불러오지 못했습니다(데이터가 없다는 뜻이 아님)");
    env.listed = { status: "ok", connections: [conn({ channel: "instagram" })] };
    expect(await render()).toContain("연결된 Threads 계정이 없습니다(조회 성공 · 0건)");
  });
});

describe("Threads 해제 액션 오류 요약 레이블", () => {
  const PREV = { notice: null, fields: [], seq: 0 };
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.append(k, v);
    return f;
  };
  const IG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  beforeEach(() => {
    env.listed = { status: "ok", connections: [conn(), conn({ id: IG, channel: "instagram" })] };
  });

  it("FE-062 M-3: 해제 실패 요약에 내부 필드명(connectionId 등) 원문이 아닌 사용자용 레이블이 대응된다", async () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "connections", "threads", "page.tsx"), "utf8");
    const m = src.match(/fieldLabels=\{\{([^}]*)\}\}/);
    expect(m).not.toBeNull();
    const labels = Object.fromEntries([...(m?.[1] ?? "").matchAll(/(\w+): "([^"]+)"/g)].map((x) => [x[1], x[2]]));
    const fields = new Set<string>();
    for (const f of [
      fd({ connectionId: TH1, expectedVersion: "3" }),
      fd({ expectedVersion: "3", confirmRevoke: "on" }),
      fd({ connectionId: TH1, expectedVersion: "abc", confirmRevoke: "on" }),
      fd({ connectionId: IG, expectedVersion: "3", confirmRevoke: "on" }),
    ]) for (const x of (await revokeThreadsConnectionAction(PREV, f)).fields) fields.add(x);
    expect([...fields].sort()).toEqual(["confirmRevoke", "connectionId", "expectedVersion"]);
    for (const x of fields) {
      expect(labels[x], x).toBeTruthy();
      expect(labels[x]).not.toMatch(/[A-Za-z]{4,}/);
    }
    expect(labels.connectionId).toContain("목록을 새로 불러와 다시 선택");
  });
});

describe("시작 폼 중복 제출 차단 배선(정적)", () => {
  it("두 연결 화면의 start 폼은 모두 OAuthStartForm(일반 <form> start 폼 없음)", () => {
    for (const ch of ["threads", "instagram"]) {
      const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "connections", ch, "page.tsx"), "utf8");
      expect((src.match(/<OAuthStartForm action=\{/g) ?? []).length).toBe(2);
      expect(src).not.toMatch(/<form method="post" action=\{/);
    }
  });
});

describe("FE-065: ?notice= 쿼리(해제 성공만)", () => {
  it("saved만 해제 성공 안내(저장했습니다 아님, 자격 증명 제거·Threads 앱 권한 별도 해제)", async () => {
    const out = await render({ notice: "saved" });
    expect(out).toContain("연결을 해제했습니다");
    expect(out).toContain("저장된 연결 자격 증명(토큰)을 지웠습니다");
    expect(out).toContain("Threads(Meta) 쪽 앱 권한은 이 해제로 회수되지 않으니 Threads 설정에서 따로 해제하세요");
    expect(out).not.toContain("저장했습니다");
    expect(out).not.toContain("서버가 저장을 확인했습니다");
  });

  it("saved 외 허용 목록 코드·배열·임의 값은 URL 조작만으로 렌더되지 않는다(쿼리 없을 때와 같은 마크업)", async () => {
    const { WRITE_NOTICES } = await import("@/server/distribution/write-notice");
    const base = await render();
    const others = WRITE_NOTICES.filter((c) => c !== "saved");
    expect(others).toEqual(expect.arrayContaining(["denied", "conflict_version", "uncertain", "invalid"]));
    for (const c of others) expect(await render({ notice: c }), c).toBe(base);
    expect(await render({ notice: "nope" })).toBe(base);
    expect(renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ notice: ["saved"] }) })) as ReactElement)).toBe(base);
  });

  it("OAuth result 안내는 notice와 무관하게 그대로", async () => {
    const out = await render({ result: "connected", notice: "denied" });
    expect(out).toContain("계정을 연결했습니다");
    expect(out).not.toContain("권한이 없습니다</");
  });
});

describe("FE-073 회귀: Threads 연결 화면", () => {
  const ID2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const WRAP = '<div style="display:contents">';
  const count = (out: string) => out.split(WRAP).length - 1;
  const renderRaw = async (sp: Record<string, string | string[]>) =>
    renderToStaticMarkup((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);

  it("ResultFocus 래퍼(서버 렌더 조건만): 허용 result·정확한 notice=saved에서만 1개, 둘 다면 OAuth 결과만", async () => {
    const ok = await render({ result: "connected" });
    expect(count(ok)).toBe(1);
    expect(ok).toContain(WRAP + '<div class="ds-notice ds-notice--info" role="status"><strong class="ds-notice-title">Threads 계정을 연결했습니다');
    const sv = await render({ notice: "saved" });
    expect(count(sv)).toBe(1);
    expect(sv).toMatch(/<div style="display:contents"><div class="ds-notice ds-notice--info" role="status"><strong class="ds-notice-title">연결을 해제했습니다/);
    const both = await render({ result: "state_expired", notice: "saved" });
    expect(count(both)).toBe(1);
    expect(both.slice(both.indexOf(WRAP), both.indexOf(WRAP) + 200)).toContain("연결 요청 시간이 지났습니다");
    expect(both).toContain("연결을 해제했습니다"); // saved 안내는 보이되 초점 래퍼 밖
  });

  it("ResultFocus 래퍼: 임의·허용 밖 값에는 렌더 안 함(쿼리 없을 때와 같음)", async () => {
    const base = await render();
    expect(count(base)).toBe(0);
    const cases: Record<string, string>[] = [{ result: "nope" }, { result: "CONNECTED" }, { notice: "denied" }, { notice: "SAVED" }, { notice: "saved " }, { result: "", notice: "" }];
    for (const sp of cases) {
      expect(await render(sp), JSON.stringify(sp)).toBe(base);
    }
    expect(await renderRaw({ notice: ["saved"] })).toBe(base);
    expect(count(await renderRaw({ result: ["connected"], notice: ["saved", "saved"] }))).toBe(0);
  });

  it("카드별 비활성 이유 id가 연결마다 고유하고 버튼과 연결된다, 준비되면 이유·aria 없음", async () => {
    env.ready = { ...env.ready, ready: false, missing: ["X"], redirectUri: null };
    env.listed = { status: "ok", connections: [conn(), conn({ id: ID2, providerAccountId: "ACC-2", rowVersion: 7 })] };
    const out = await render();
    const rcs = buttonsByText(out, "같은 계정 재연결");
    expect(rcs.map((b) => b["aria-describedby"])).toEqual([`rc-why-${TH1}`, `rc-why-${ID2}`]);
    for (const b of rcs) {
      expect(b.disabled).toBe("");
      expect(out).toContain(`<p id="${b["aria-describedby"]}" class="ds-muted dc-reason">사용할 수 없음: 서버 설정 준비 전`);
    }
    expect(buttonsByText(out, "새 Threads 계정 연결")[0]?.["aria-describedby"]).toBe("th-start-why");
    env.ready = { ...env.ready, ready: true, missing: [] };
    const ready = await render();
    for (const b of [...buttonsByText(ready, "같은 계정 재연결"), ...buttonsByText(ready, "새 Threads 계정 연결")]) {
      expect(b).not.toHaveProperty("disabled");
      expect(b).not.toHaveProperty("aria-describedby");
    }
    expect(ready).not.toContain("rc-why-");
    expect(ready).not.toContain("th-start-why");
  });

  it("해제 영역: 카드 목록 stack, danger-zone 안에 dc-check 확인·danger 해제 버튼, 해제된 연결에는 없음", async () => {
    env.listed = { status: "ok", connections: [conn()] };
    const out = await render();
    expect(out).toContain('<ul class="dc-cards dc-cards--stack">');
    const zone = out.slice(out.indexOf('<div class="dc-danger-zone">'));
    expect(out).toContain('<div class="dc-danger-zone">');
    expect(zone).toMatch(/^<div class="dc-danger-zone"><div class="dc-action-form">/);
    expect(zone).toContain('<label class="dc-check"><input type="checkbox" name="confirmRevoke"/>');
    const [rv] = buttonsByText(out, "연결 해제");
    expect(classes(rv)).toEqual(expect.arrayContaining(["ds-button", "ds-button--danger"]));
    expect(classes(rv)).not.toContain("ds-button--secondary");
    expect(out.indexOf('<div class="dc-danger-zone">')).toBeGreaterThan(out.indexOf("같은 계정 재연결"));
    env.listed = { status: "ok", connections: [conn({ status: "revoked", revokedAt: "2026-11-17T01:00:00Z" })] };
    expect(await render()).not.toContain("dc-danger-zone");
  });

  it("재인증 사유·상태: 한글 라벨, 모르는 코드·상태는 원문 없이 '확인 필요'", async () => {
    env.listed = {
      status: "ok",
      connections: [
        conn({ status: "reauth_required", reauthReason: "provider_auth" }),
        conn({ id: ID2, status: "zz_status", reauthReason: "zz_reason" }),
      ],
    };
    const out = await render();
    expect(out).toContain("재인증 필요 · Threads 인증 거절");
    expect(out).toContain("상태 확인 필요 · 재인증 사유 확인 필요");
    expect(out).not.toMatch(/zz_status|zz_reason|provider_auth/);
  });
});
