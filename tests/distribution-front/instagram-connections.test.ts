/**
 * FE-INSTAGRAM-OAUTH-044 — Instagram 계정 연결 화면·해제 액션(서버 렌더 문자열, 브라우저·Meta 실측 아님).
 * Backend 043 export(INSTAGRAM_OAUTH_CONTRACT §4)는 계약 이름 그대로 대역으로 둔다 — 실제 모듈 도착 뒤에도 같은 이름이어야 통과한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RESULTS = [
  "connected", "reconnected", "cancelled", "provider_error", "permission_missing", "denied", "not_ready", "invalid_request",
  "state_invalid", "state_used", "state_expired", "state_limit", "version_conflict", "connection_revoked", "connection_not_found",
  "exchange_failed", "exchange_unknown", "account_mismatch", "already_connected", "save_failed", "save_unknown", "start_unknown", "unexpected",
] as const;

const env = vi.hoisted(() => ({
  ready: { ready: true, missing: [] as string[], serviceReady: true, redirectUri: "https://example.test/api/distribution/oauth/instagram/callback" as string | null },
  listed: { status: "ok", connections: [] as unknown[] } as Record<string, unknown>,
  revoke: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/admin/distribution/connections/instagram",
  redirect: (u: string) => {
    env.redirect(u);
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock("@/components/distribution-console/guard", () => ({ denyUnlessDistributionAdmin: async () => null }));
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: async () => ({ ok: true }) }));
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => null }));
vi.mock("@/server/distribution/connections/service", () => ({
  listConnections: async () => env.listed,
  revokeConnection: async (_deps: unknown, input: unknown) => env.revoke(input),
}));
vi.mock("@/server/distribution/instagram/oauth/endpoints", () => ({
  INSTAGRAM_START_PATH: "/api/distribution/oauth/instagram/start",
  INSTAGRAM_CALLBACK_PATH: "/api/distribution/oauth/instagram/callback",
  INSTAGRAM_CONNECTIONS_PAGE: "/admin/distribution/connections/instagram",
  INSTAGRAM_REQUESTED_SCOPES: ["instagram_business_basic", "instagram_business_content_publish"],
}));
vi.mock("@/server/distribution/instagram/oauth/flow", () => ({
  INSTAGRAM_OAUTH_RESULTS: RESULTS,
  parseInstagramOAuthResult: (v: unknown) => (typeof v === "string" && (RESULTS as readonly string[]).includes(v) ? v : null),
}));
vi.mock("@/server/distribution/instagram/oauth/session", () => ({
  INSTAGRAM_OAUTH_ENV: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "DISTRIBUTION_TOKEN_KEY", "NEXT_PUBLIC_SITE_URL"],
  instagramOAuthReadiness: () => env.ready,
}));

const Page = (await import("@/app/admin/distribution/connections/instagram/page")).default;
const { revokeInstagramConnectionAction } = await import("@/app/admin/distribution/connections/instagram/actions");

const IG1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conn = (o: Record<string, unknown> = {}) => ({
  id: IG1, channel: "instagram", providerAccountId: "17841400000000001", accountLabel: null, scopes: ["instagram_business_basic", "instagram_business_content_publish"],
  status: "connected", reauthReason: null, expiresAt: "2027-01-16T00:00:00Z", expired: false, keyVersion: 1, hasCredential: true, rowVersion: 3,
  createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", revokedAt: null, ...o,
});
async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);
}
/** start 폼 태그(속성 순서 무관): method=post + action=INSTAGRAM_START_PATH */
const startForms = (out: string) => [...out.matchAll(/<form\s[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('action="/api/distribution/oauth/instagram/start"'));
/** 텍스트가 정확히 같은 <button>들의 속성 맵(속성 순서 무관). FE-073 */
const buttonsByText = (out: string, text: string) =>
  [...out.matchAll(/<button((?:\s[^>]*)?)>([^<]*)<\/button>/g)]
    .filter((m) => m[2] === text)
    .map((m) => Object.fromEntries([...(m[1] ?? "").matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((x) => [x[1], x[2] ?? ""])) as Record<string, string>);
const classes = (b: Record<string, string> | undefined) => (b?.class ?? "").split(/\s+/).filter(Boolean);


beforeEach(() => {
  env.ready = { ready: true, missing: [], serviceReady: true, redirectUri: "https://example.test/api/distribution/oauth/instagram/callback" };
  env.listed = { status: "ok", connections: [] };
  env.revoke.mockReset();
  env.redirect.mockReset();
});

describe("준비 상태", () => {
  it("ready: 시작 버튼 활성(form POST → INSTAGRAM_START_PATH), redirect URI·요청 권한 표시, 연결됨≠게시 가능·갱신 없음 고지", async () => {
    const out = await render();
    const forms = startForms(out);
    expect(forms.length).toBe(1);
    expect(forms[0]).toMatch(/method="post"/);
    expect(out).toMatch(/<button type="submit" class="ds-button ds-button--primary">새 Instagram 계정 연결<\/button>/);
    expect(out).toContain("https://example.test/api/distribution/oauth/instagram/callback");
    expect(out).toContain("instagram_business_basic, instagram_business_content_publish");
    expect(out).toContain("연결됨은 게시 가능이 아닙니다");
    expect(out).toContain("live gate가 닫혀");
    expect(out).toContain("재연결이 필요");
    expect(out).toContain("전문 계정");
    // FE-ACCOUNT-ACCESS-DISCLOSURE-052: 계정 유형·접근 수준은 앱이 검증하지 않음(계약 v2), 연결 안내 바로 옆에 표시
    expect(out).toContain("비즈니스·크리에이터 계정인지, Meta 앱의 접근 수준(권한 승인 상태)이 어떤지 확인하지 않습니다");
    expect(out).toContain("Meta(Instagram 계정 설정·앱 대시보드)에서 직접 확인");
    expect(out.indexOf("확인하지 않습니다")).toBeGreaterThan(out.indexOf("새 Instagram 계정 연결"));
    expect(out.indexOf("확인하지 않습니다")).toBeLessThan(out.indexOf("연결된 계정"));
  });

  it("not_ready: 빠진 설정 이름만 표시, 시작 버튼 비활성, 값 없음", async () => {
    env.ready = { ready: false, missing: ["INSTAGRAM_APP_SECRET"], serviceReady: false, redirectUri: null };
    const out = await render();
    expect(out).toContain("연결 준비 전: 서버 설정 INSTAGRAM_APP_SECRET, SUPABASE_SECRET_KEY");
    // FE-073: 속성 순서에 기대지 않고 의미(비활성·이유 연결)를 확인한다
    const [start] = buttonsByText(out, "새 Instagram 계정 연결");
    expect(start).toMatchObject({ type: "submit", disabled: "", "aria-describedby": "ig-start-why" });
    expect(classes(start)).toEqual(expect.arrayContaining(["ds-button", "ds-button--primary"]));
    expect(out).toContain('<p id="ig-start-why" class="ds-muted dc-reason">사용할 수 없음: 서버 설정 준비 전(위 준비 상태 참고)</p>');
    expect(out).toContain("&lt;NEXT_PUBLIC_SITE_URL&gt;/api/distribution/oauth/instagram/callback");
  });
});

describe("결과 코드", () => {
  it("허용 목록 23개 모두 제목·본문이 있고, 목록 밖 값은 아무 결과도 렌더하지 않음", async () => {
    const titles = new Set<string>();
    for (const r of RESULTS) {
      const out = await render({ result: r });
      const m = out.match(/role="(?:status|alert)"[\s\S]*?<\/p>/);
      expect(m, r).not.toBeNull();
      titles.add(m![0]);
    }
    expect(titles.size).toBe(RESULTS.length);
    const none = await render({ result: "<script>x</script>" });
    expect(none).not.toContain("script&gt;x");
    expect(none).not.toContain("연결이 취소됐습니다");
  });

  it("permission_missing: 두 권한 모두 허용 안내·저장 안 함 / save_unknown: 목록 재조회·자동 재시도 없음 / connected: 게시 가능 아님", async () => {
    const pm = await render({ result: "permission_missing" });
    expect(pm).toContain("instagram_business_basic과 instagram_business_content_publish 두 권한을 모두 허용");
    expect(pm).toContain("저장하지 않았습니다");
    expect(pm).toContain("부여 권한 목록에 필요한 권한이 빠져");
    // QA-045 정정: 취소는 사용자의 의도적 클릭으로 단정하지 않음, state 상한은 Threads·Instagram 합산, 권한 목록 형식 이상은 exchange_unknown
    const ca = await render({ result: "cancelled" });
    expect(ca).toContain("취소(허용 안 함)");
    expect(ca).toContain("맞춰 볼 수 없는 오류 응답"); // v2: 쿠키 state 불일치 + 공급자 error도 cancelled
    expect(ca).not.toMatch(/직접 취소|눌러|클릭/);
    const sl = await render({ result: "state_limit" });
    expect(sl).toContain("Threads·Instagram을 합쳐 5개");
    expect(sl).toContain("다른 채널 연결 시도 포함");
    expect(await render({ result: "exchange_unknown" })).toContain("부여 권한 목록 포함");
    const su = await render({ result: "save_unknown" });
    expect(su).toContain("목록을 새로 불러와 확인");
    expect(su).toContain("자동으로 다시 시도하지 않았습니다");
    const ok = await render({ result: "connected" });
    expect(ok).toContain("Instagram 계정을 연결했습니다");
    expect(ok).toContain("게시 가능이 아닙니다");
  });
});

describe("연결 목록", () => {
  it("channel=instagram만 표시(Threads 연결 제외), 메타만·토큰 없음, 재연결 폼은 렌더된 id·rowVersion 전송", async () => {
    env.listed = {
      status: "ok",
      connections: [conn(), conn({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", channel: "threads", providerAccountId: "THREADS-ACC-999" })],
    };
    const out = await render();
    expect(out).toContain("17841400000000001");
    expect(out).not.toContain("THREADS-ACC-999");
    expect(out).toContain("연결 때 Instagram이 부여한 값");
    expect(out).toContain(`<input type="hidden" name="connectionId" value="${IG1}"/><input type="hidden" name="expectedVersion" value="3"/><button type="submit" class="ds-button ds-button--secondary">같은 계정 재연결`);
    expect(out).not.toMatch(/access_token|ciphertext|nonce|secret=|keyVersion/i);
    expect(out).toContain("Instagram 쪽 앱 권한은 이 동작으로 회수되지 않으니");
    expect(out).not.toMatch(/권한(?:을|도) 회수합니다|앱 권한까지 회수/);
  });

  it("재인증 필요·만료·해제 상태 표시, 해제된 연결은 재연결·해제 폼 없음, not_ready면 재연결 비활성", async () => {
    env.ready = { ready: false, missing: ["INSTAGRAM_APP_ID"], serviceReady: true, redirectUri: null };
    env.listed = { status: "ok", connections: [conn({ status: "reauth_required", reauthReason: "provider_auth", expired: true })] };
    const out = await render();
    expect(out).toContain("재인증 필요 · 만료됨(재연결 필요) · Instagram 인증 거절");
    expect(out).toMatch(/같은 계정 재연결/);
    const [rc] = buttonsByText(out, "같은 계정 재연결");
    expect(rc).toMatchObject({ disabled: "", "aria-describedby": `rc-why-${IG1}` });
    expect(classes(rc)).toContain("ds-button--secondary");
    env.listed = { status: "ok", connections: [conn({ status: "revoked", revokedAt: "2026-11-17T01:00:00Z" })] };
    const rv = await render();
    expect(rv).not.toContain("같은 계정 재연결</button>");
    expect(startForms(rv)).toHaveLength(1); // 새 계정 연결 폼만
    expect(rv).not.toContain("연결 해제</button>");
    expect(rv).toContain("해제된 연결은 다시 쓸 수 없습니다");
  });

  it("조회 not_ready·오류·0건을 구분", async () => {
    env.listed = { status: "not_ready" };
    expect(await render()).toContain("조회 준비 전");
    env.listed = { status: "db_error", error: { code: "unavailable" } };
    expect(await render()).toContain("연결 목록을 불러오지 못했습니다(데이터가 없다는 뜻이 아님)");
    env.listed = { status: "ok", connections: [conn({ channel: "threads" })] };
    expect(await render()).toContain("연결된 Instagram 계정이 없습니다(조회 성공 · 0건)");
  });
});

describe("해제 액션", () => {
  const PREV = { notice: null, fields: [], seq: 0 };
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.append(k, v);
    return f;
  };

  it("확인 체크 없으면 서비스 호출 없이 invalid(confirmRevoke)", async () => {
    const st = await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "3" }));
    expect(st).toMatchObject({ notice: "invalid", fields: ["confirmRevoke"] });
    expect(env.revoke).not.toHaveBeenCalled();
  });

  const TH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  beforeEach(() => {
    env.listed = { status: "ok", connections: [conn(), conn({ id: TH, channel: "threads", providerAccountId: "TH-1" })] };
  });

  it("렌더된 expectedVersion 그대로 공용 revokeConnection 1회, 성공 시 이 화면으로 saved", async () => {
    env.revoke.mockResolvedValue({ status: "ok", value: {} });
    await expect(revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "3", confirmRevoke: "on", reason: "교체" }))).rejects.toThrow(
      "REDIRECT:/admin/distribution/connections/instagram?notice=saved",
    );
    expect(env.revoke).toHaveBeenCalledTimes(1);
    expect(env.revoke).toHaveBeenCalledWith({ connectionId: IG1, expectedVersion: 3, reason: "교체" });
  });

  it("Threads 연결 id·위조 id는 RPC 0회로 거절(채널 사전 확인)", async () => {
    for (const id of [TH, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]) {
      const st = await revokeInstagramConnectionAction(PREV, fd({ connectionId: id, expectedVersion: "3", confirmRevoke: "on" }));
      expect(st).toMatchObject({ notice: "invalid", fields: ["connectionId"] });
    }
    expect(env.revoke).not.toHaveBeenCalled();
  });

  it("렌더 버전과 현재 버전이 다르면 RPC 0회 conflict_version, 버전·id 형식 오류도 RPC 0회", async () => {
    const st = await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "2", confirmRevoke: "on" }));
    expect(st.notice).toBe("conflict_version");
    expect((await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "abc", confirmRevoke: "on" }))).fields).toEqual(["expectedVersion"]);
    expect((await revokeInstagramConnectionAction(PREV, fd({ expectedVersion: "3", confirmRevoke: "on" }))).fields).toEqual(["connectionId"]);
    expect(env.revoke).not.toHaveBeenCalled();
    expect(env.redirect).not.toHaveBeenCalled();
  });

it("FE-062 M-3: 해제 실패 요약에 내부 필드명(connectionId 등) 원문이 아닌 사용자용 레이블이 대응된다", async () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "connections", "instagram", "page.tsx"), "utf8");
    const m = src.match(/fieldLabels=\{\{([^}]*)\}\}/);
    expect(m).not.toBeNull();
    const labels = Object.fromEntries([...(m?.[1] ?? "").matchAll(/(\w+): "([^"]+)"/g)].map((x) => [x[1], x[2]]));
    const fields = new Set<string>();
    for (const f of [
      fd({ connectionId: IG1, expectedVersion: "3" }),
      fd({ expectedVersion: "3", confirmRevoke: "on" }),
      fd({ connectionId: IG1, expectedVersion: "abc", confirmRevoke: "on" }),
      fd({ connectionId: TH, expectedVersion: "3", confirmRevoke: "on" }),
    ]) for (const x of (await revokeInstagramConnectionAction(PREV, f)).fields) fields.add(x);
    expect([...fields].sort()).toEqual(["confirmRevoke", "connectionId", "expectedVersion"]);
    for (const x of fields) {
      expect(labels[x], x).toBeTruthy();
      expect(labels[x]).not.toMatch(/[A-Za-z]{4,}/);
    }
    expect(labels.connectionId).toContain("목록을 새로 불러와 다시 선택");
  });

  it("목록 조회 실패·준비 전이면 해제 시도 없이 실패 안내", async () => {
    env.listed = { status: "db_error", error: { code: "unavailable", token: null, sqlstate: null } };
    expect((await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "3", confirmRevoke: "on" }))).notice).not.toBeNull();
    env.listed = { status: "not_ready" };
    expect((await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "3", confirmRevoke: "on" }))).notice).toBe("not_ready");
    expect(env.revoke).not.toHaveBeenCalled();
  });

  it("사전 확인 통과 뒤 서버 충돌은 그대로 실패 상태(재전송 없음)", async () => {
    env.revoke.mockResolvedValue({ status: "db_error", error: { code: "conflict_version", token: null, sqlstate: "40001" } });
    const st = await revokeInstagramConnectionAction(PREV, fd({ connectionId: IG1, expectedVersion: "3", confirmRevoke: "on" }));
    expect(env.revoke).toHaveBeenCalledTimes(1);
    expect(st.notice).toBe("conflict_version");
    expect(env.redirect).not.toHaveBeenCalled();
  });
});

describe("계약 정합(실제 Backend 043 모듈)", () => {
  it("대역의 결과 목록·경로·권한·env 이름이 실제 export와 같다", async () => {
    const flow = await vi.importActual<typeof import("@/server/distribution/instagram/oauth/flow")>("@/server/distribution/instagram/oauth/flow");
    const ep = await vi.importActual<typeof import("@/server/distribution/instagram/oauth/endpoints")>("@/server/distribution/instagram/oauth/endpoints");
    const cfg = await vi.importActual<typeof import("@/server/distribution/instagram/oauth/config")>("@/server/distribution/instagram/oauth/config");
    expect([...flow.INSTAGRAM_OAUTH_RESULTS]).toEqual([...RESULTS]);
    expect(ep.INSTAGRAM_START_PATH).toBe("/api/distribution/oauth/instagram/start");
    expect(ep.INSTAGRAM_CALLBACK_PATH).toBe("/api/distribution/oauth/instagram/callback");
    expect(ep.INSTAGRAM_CONNECTIONS_PAGE).toBe("/admin/distribution/connections/instagram");
    expect([...ep.INSTAGRAM_REQUESTED_SCOPES]).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    expect([...cfg.INSTAGRAM_OAUTH_ENV]).toEqual(["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "DISTRIBUTION_TOKEN_KEY", "NEXT_PUBLIC_SITE_URL"]);
  });
});

describe("경계(정적)", () => {
  it("화면·액션은 OAuth 흐름을 복제하지 않고(authorize URL·code 교환·state 쿠키 없음) start 폼만 쓴다", () => {
    const dir = join(process.cwd(), "src", "app", "admin", "distribution", "connections", "instagram");
    for (const f of ["page.tsx", "actions.ts"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/instagram\.com\/oauth|api\.instagram\.com|graph\.instagram\.com|__Host-dist-instagram-oauth|client_secret|INSTAGRAM_APP_SECRET\s*[:=]|process\.env/);
    }
  });

  it("연결 랜딩: Instagram 비활성 버튼 제거, 전용 연결 화면 링크", () => {
    const land = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "connections", "page.tsx"), "utf8");
    expect(land).toContain('href="/admin/distribution/connections/instagram"');
    expect(land).not.toContain("DisabledAction");
    expect(land).not.toContain("OAuth) 연결이 아직 구현되지 않았습니다");
  });
});

describe("FE-065: ?notice= 쿼리(해제 성공만)", () => {
  it("saved만 해제 성공 안내(저장했습니다 아님, 자격 증명 제거·Instagram 앱 권한 별도 해제)", async () => {
    const out = await render({ notice: "saved" });
    expect(out).toContain("연결을 해제했습니다");
    expect(out).toContain("저장된 연결 자격 증명(토큰)을 지웠습니다");
    expect(out).toContain("Instagram(Meta) 쪽 앱 권한은 이 해제로 회수되지 않으니 Instagram 설정에서 따로 해제하세요");
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

describe("FE-073 회귀: Instagram 연결 화면", () => {
  const ID2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const WRAP = '<div style="display:contents">';
  const count = (out: string) => out.split(WRAP).length - 1;
  const renderRaw = async (sp: Record<string, string | string[]>) =>
    renderToStaticMarkup((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);

  it("ResultFocus 래퍼(서버 렌더 조건만): 허용 result·정확한 notice=saved에서만 1개, 둘 다면 OAuth 결과만", async () => {
    const ok = await render({ result: "connected" });
    expect(count(ok)).toBe(1);
    expect(ok).toContain(WRAP + '<div class="ds-notice ds-notice--info" role="status"><strong class="ds-notice-title">Instagram 계정을 연결했습니다');
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
    expect(rcs.map((b) => b["aria-describedby"])).toEqual([`rc-why-${IG1}`, `rc-why-${ID2}`]);
    for (const b of rcs) {
      expect(b.disabled).toBe("");
      expect(out).toContain(`<p id="${b["aria-describedby"]}" class="ds-muted dc-reason">사용할 수 없음: 서버 설정 준비 전`);
    }
    expect(buttonsByText(out, "새 Instagram 계정 연결")[0]?.["aria-describedby"]).toBe("ig-start-why");
    env.ready = { ...env.ready, ready: true, missing: [] };
    const ready = await render();
    for (const b of [...buttonsByText(ready, "같은 계정 재연결"), ...buttonsByText(ready, "새 Instagram 계정 연결")]) {
      expect(b).not.toHaveProperty("disabled");
      expect(b).not.toHaveProperty("aria-describedby");
    }
    expect(ready).not.toContain("rc-why-");
    expect(ready).not.toContain("ig-start-why");
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
    expect(out).toContain("재인증 필요 · Instagram 인증 거절");
    expect(out).toContain("상태 확인 필요 · 재인증 사유 확인 필요");
    expect(out).not.toMatch(/zz_status|zz_reason|provider_auth/);
  });
});
