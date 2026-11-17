import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { authenticateExtensionRequest } from "@/server/distribution/blog/extension-auth";
import {
  generateExtensionToken,
  hashExtensionToken,
  parseBearerToken,
  parseTokenLabel,
  parseTokenTtl,
  TOKEN_RE,
} from "@/server/distribution/blog/token";
import {
  isDefiniteFailure,
  issueExtensionToken,
  listExtensionTokens,
  revokeExtensionToken,
  tokenNoticeOf,
} from "@/server/distribution/blog/token-service";
import { formatKst, formatLastUsed } from "@/app/admin/distribution/connections/blog-extension/format";
import { handleWhoami } from "@/server/distribution/blog/whoami";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const TOKEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
const deniedActor = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });

function client(response: { data: unknown; error: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { c: { rpc } as unknown as RpcClient, rpc };
}
const callsOf = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;

describe("token 규칙", () => {
  it("pat_ + CSPRNG 32바이트 hex, 매번 다름", () => {
    const a = generateExtensionToken();
    const b = generateExtensionToken();
    expect(a).toMatch(TOKEN_RE);
    expect(a).not.toBe(b);
  });
  it("엔트로피 크기가 다르면 실패", () => {
    expect(() => generateExtensionToken(() => new Uint8Array(16))).toThrow();
  });
  it("sha256 hex 해시", () => {
    const t = `pat_${"0".repeat(64)}`;
    expect(hashExtensionToken(t)).toBe(createHash("sha256").update(t).digest("hex"));
  });
  it.each([
    [null, null],
    ["", null],
    ["Bearer", null],
    [`bearer pat_${"a".repeat(64)}`, null],
    [`Bearer pat_${"A".repeat(64)}`, null],
    [`Bearer pat_${"a".repeat(63)}`, null],
    [`Bearer pat_${"a".repeat(64)} extra`, null],
    [`Basic pat_${"a".repeat(64)}`, null],
    [`Bearer pat_${"a".repeat(64)}`, `pat_${"a".repeat(64)}`],
  ])("Bearer 파싱 %j", (h, expected) => {
    expect(parseBearerToken(h)).toBe(expected);
  });
  it("label·기간", () => {
    expect(parseTokenLabel("내 노트북")).toBe("내 노트북");
    expect(parseTokenLabel("  ")).toBeNull();
    expect(parseTokenLabel("x".repeat(61))).toBeNull();
    expect(parseTokenLabel("a\nb")).toBeNull();
    expect(parseTokenTtl("90")).toBe(90);
    expect(parseTokenTtl("365")).toBeNull();
    expect(parseTokenTtl("0")).toBeNull();
  });
});

describe("발급", () => {
  const ok = { data: { id: TOKEN_ID, label: "pc", created_at: "2026-11-17T00:00:00Z", expires_at: "2027-02-15T00:00:00Z" }, error: null };

  it("D1 거부 → RPC 0회, 토큰 생성 0회", async () => {
    const { c, rpc } = client(ok);
    const generate = vi.fn(() => `pat_${"b".repeat(64)}`);
    const out = await issueExtensionToken({ resolveActor: deniedActor, getClient: () => c, generate }, { label: "pc", ttlDays: "90" });
    expect(out).toEqual({ status: "denied", reason: "not_approved" });
    expect(rpc).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("키 없음 → not_ready", async () => {
    const out = await issueExtensionToken({ resolveActor: allowed, getClient: () => null }, { label: "pc", ttlDays: "90" });
    expect(out).toEqual({ status: "not_ready" });
  });

  it("RPC에는 해시만, 원문은 성공 결과에 1회", async () => {
    const { c, rpc } = client(ok);
    const token = `pat_${"c".repeat(64)}`;
    const out = await issueExtensionToken({ resolveActor: allowed, getClient: () => c, generate: () => token }, { label: "pc", ttlDays: "90" });
    expect(out).toEqual({ status: "ok", data: { id: TOKEN_ID, label: "pc", createdAt: ok.data.created_at, expiresAt: ok.data.expires_at, token } });
    const [fn, params] = callsOf(rpc)[0] ?? ["", {}];
    expect(fn).toBe("distribution_issue_extension_token");
    expect(params).toEqual({ p_actor_id: ADMIN, p_token_hash: hashExtensionToken(token), p_label: "pc", p_ttl_days: 90 });
    expect(JSON.stringify(params)).not.toContain(token);
  });

  it("폼의 actor 값은 무시(세션 actor만)", async () => {
    const { c, rpc } = client(ok);
    await issueExtensionToken({ resolveActor: allowed, getClient: () => c }, { label: "pc", ttlDays: "90", actorId: OTHER } as never);
    expect(callsOf(rpc)[0]?.[1].p_actor_id).toBe(ADMIN);
  });

  it("DB 오류 시 원문을 돌려주지 않고 안내 코드로", async () => {
    const { c } = client({ data: null, error: { code: "23514", message: "TOKEN_LIMIT: revoke an existing token first" } });
    const out = await issueExtensionToken({ resolveActor: allowed, getClient: () => c }, { label: "pc", ttlDays: "90" });
    expect(out.status).toBe("db_error");
    expect(JSON.stringify(out)).not.toMatch(/pat_[0-9a-f]{64}/);
    expect(tokenNoticeOf(out, "issued")).toBe("token_limit");
  });

  it("잘못된 입력 → invalid, RPC 0회", async () => {
    const { c, rpc } = client(ok);
    const out = await issueExtensionToken({ resolveActor: allowed, getClient: () => c }, { label: "", ttlDays: "7" });
    expect(out.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("목록·철회", () => {
  it("목록: 상태 계산, 해시 열이 섞이면 bad_response", async () => {
    const rows = [
      { id: TOKEN_ID, label: "a", created_at: "2026-11-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", last_used_at: null, revoked_at: null },
      { id: OTHER, label: "b", created_at: "2026-01-01T00:00:00Z", expires_at: "2026-02-01T00:00:00Z", last_used_at: null, revoked_at: null },
    ];
    const now = new Date("2026-11-17T00:00:00Z");
    const { c } = client({ data: rows, error: null });
    const out = await listExtensionTokens({ resolveActor: allowed, getClient: () => c }, now);
    expect(out.status === "ok" && out.tokens.map((t) => t.state)).toEqual(["active", "expired"]);
    const { c: c2 } = client({ data: [{ ...rows[0], token_hash: "f".repeat(64) }], error: null });
    expect((await listExtensionTokens({ resolveActor: allowed, getClient: () => c2 }, now)).status).toBe("bad_response");
  });
  it("목록: D1 거부 → RPC 0회", async () => {
    const { c, rpc } = client({ data: [], error: null });
    expect((await listExtensionTokens({ resolveActor: deniedActor, getClient: () => c })).status).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("철회: uuid만, 다른 소유자(P0002) → not_found", async () => {
    const { c, rpc } = client({ data: null, error: { code: "P0002", message: "extension token not found" } });
    expect((await revokeExtensionToken({ resolveActor: allowed, getClient: () => c }, { tokenId: "x" })).status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
    const out = await revokeExtensionToken({ resolveActor: allowed, getClient: () => c }, { tokenId: OTHER });
    expect(tokenNoticeOf(out, "revoked")).toBe("not_found");
    expect(callsOf(rpc)[0]?.[1]).toEqual({ p_actor_id: ADMIN, p_token_id: OTHER });
  });
});

describe("UX-FIX-008 결과 분류·시각", () => {
  const issueWith = (r: { data: unknown; error: unknown } | Error) =>
    issueExtensionToken({ resolveActor: allowed, getClient: () => client(r).c }, { label: "pc", ttlDays: "90" });

  it("BC-03: 응답 유실·잘못된 성공 응답은 uncertain(확인 필요), 실패로 단정하지 않음", async () => {
    const lost = await issueWith(new Error("socket hang up"));
    expect(tokenNoticeOf(lost, "issued")).toBe("uncertain");
    expect(isDefiniteFailure(tokenNoticeOf(lost, "issued"))).toBe(false);
    const bad = await issueWith({ data: { id: "not-uuid" }, error: null });
    expect(tokenNoticeOf(bad, "issued")).toBe("uncertain");
    expect(JSON.stringify(bad)).not.toMatch(/pat_[0-9a-f]{64}/);
  });
  it("R010-03A: 식별 못 한 DB 오류는 확정 실패로 단정하지 않음(uncertain)", async () => {
    for (const error of [{ code: "XX000", message: "x" }, { message: "no sqlstate" }, { code: "57014", message: "canceling statement" }]) {
      const n = tokenNoticeOf(await issueWith({ data: null, error }), "issued");
      expect(n).toBe("uncertain");
      expect(isDefiniteFailure(n)).toBe(false);
    }
  });
  it("BC-03: 알려진 DB 거절과 RPC 전 거절만 확정 실패", async () => {
    for (const [r, notice] of [
      [{ data: null, error: { code: "23514", message: "TOKEN_LIMIT: x" } }, "token_limit"],
      [{ data: null, error: { code: "42501", message: "actor is not" } }, "denied"],
      [{ data: null, error: { code: "23505", message: "DUPLICATE: token already registered" } }, "failed"],
      [{ data: null, error: { code: "22023", message: "label must be" } }, "invalid"],
    ] as const) {
      const n = tokenNoticeOf(await issueWith(r), "issued");
      expect(n).toBe(notice);
      expect(isDefiniteFailure(n)).toBe(true);
    }
    expect(tokenNoticeOf(await issueExtensionToken({ resolveActor: allowed, getClient: () => null }, { label: "pc", ttlDays: "90" }), "issued")).toBe("not_ready");
  });
  it("BC-04: 철회 응답 유실도 uncertain", async () => {
    const out = await revokeExtensionToken({ resolveActor: allowed, getClient: () => client(new Error("x")).c }, { tokenId: TOKEN_ID });
    expect(tokenNoticeOf(out, "revoked")).toBe("uncertain");
  });
  it("BC-05: 표시 시각은 브라우저 시간대와 무관하게 KST", () => {
    expect(formatKst("2026-11-16T15:30:00Z")).toBe(formatKst("2026-11-17T00:30:00+09:00"));
    expect(formatKst("2026-11-16T15:30:00Z")).toMatch(/KST$/);
    expect(formatKst(null)).toBeNull();
    expect(formatLastUsed(null)).toBe("사용 기록 없음");
  });
});

describe("Bearer 인증·whoami", () => {
  const token = `pat_${"d".repeat(64)}`;
  const req = (auth?: string) => new Request("https://site.example/api/distribution/extension/whoami", { headers: auth ? { authorization: auth } : {} });

  it("형식 오류 → 401, 서버 조회 0회", async () => {
    const { c, rpc } = client({ data: [], error: null });
    expect(await authenticateExtensionRequest("Bearer nope", () => c)).toEqual({ ok: false, status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("키 없음 → 503, DB 오류 → 503", async () => {
    expect(await authenticateExtensionRequest(`Bearer ${token}`, () => null)).toEqual({ ok: false, status: 503 });
    const { c } = client({ data: null, error: { code: "42P01", message: "relation does not exist" } });
    expect(await authenticateExtensionRequest(`Bearer ${token}`, () => c)).toEqual({ ok: false, status: 503 });
  });
  it("해시로 조회, 0행 → 401, 1행 → 사용자", async () => {
    const empty = client({ data: [], error: null });
    expect(await authenticateExtensionRequest(`Bearer ${token}`, () => empty.c)).toEqual({ ok: false, status: 401 });
    expect(callsOf(empty.rpc)[0]).toEqual(["distribution_authenticate_extension_token", { p_token_hash: hashExtensionToken(token) }]);
    const hit = client({ data: [{ user_id: ADMIN, token_id: TOKEN_ID }], error: null });
    expect(await authenticateExtensionRequest(`Bearer ${token}`, () => hit.c)).toEqual({ ok: true, userId: ADMIN, tokenId: TOKEN_ID });
  });

  it("whoami: 최소 응답, no-store, CORS 헤더 없음, 토큰·해시·사용자 미포함", async () => {
    const hit = client({ data: [{ user_id: ADMIN, token_id: TOKEN_ID }], error: null });
    const res = await handleWhoami(req(`Bearer ${token}`), () => hit.c);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, connected: true });
    for (const secret of [token, hashExtensionToken(token), ADMIN, TOKEN_ID]) expect(text).not.toContain(secret);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("whoami: 401은 WWW-Authenticate, 503은 not_ready", async () => {
    const r401 = await handleWhoami(req(), () => null);
    expect(r401.status).toBe(401);
    expect(r401.headers.get("www-authenticate")).toContain("Bearer");
    const r503 = await handleWhoami(req(`Bearer ${token}`), () => null);
    expect(r503.status).toBe(503);
    expect(await r503.json()).toEqual({ ok: false, error: "not_ready" });
  });
});
