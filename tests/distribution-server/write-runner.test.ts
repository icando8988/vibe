import { describe, expect, it, vi } from "vitest";
import { resolveDistributionActor } from "@/server/distribution/actor-core";
import { runDistributionWrite, type RpcClient } from "@/server/distribution/write-runner";
import { createContentParams, parseContentVersionResult, RPC } from "@/server/distribution/rpc-params";
import { validateContentInput } from "@/server/distribution/validation";
import type { Viewer } from "@/lib/auth/viewer";

const ADMIN_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-8888-4777-8666-555555555555";
const member = (approval: "approved" | "pending" | "rejected" | "suspended", roles: Array<"admin" | "member">, userId = ADMIN_ID): Viewer => ({
  kind: "member",
  userId,
  approval,
  roles,
});

const okData = {
  content_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  version_no: 1,
  content_hash: "a".repeat(64),
};

function fakeClient(response: { data: unknown; error: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: { rpc } as unknown as RpcClient, rpc };
}

function spec(viewer: Viewer, form: Record<string, unknown>, client: RpcClient | null) {
  return {
    resolveActor: async () => resolveDistributionActor(viewer),
    validate: () => validateContentInput(form),
    getClient: () => client,
    fn: RPC.createContent,
    params: createContentParams,
    parse: parseContentVersionResult,
  };
}

const goodForm = { title: "제목", body: "본문", targetPath: "/about" };

describe("resolveDistributionActor (D1)", () => {
  it("승인된 admin → actorId = 세션 userId", () => {
    expect(resolveDistributionActor(member("approved", ["admin"]))).toEqual({ ok: true, actorId: ADMIN_ID });
  });
  it.each([
    ["비승인 admin", member("pending", ["admin"]), "not_approved"],
    ["정지 admin", member("suspended", ["admin"]), "not_approved"],
    ["승인된 일반 회원", member("approved", ["member"]), "forbidden"],
    ["비로그인", { kind: "anonymous", reason: "not_signed_in" } as Viewer, "unauthenticated"],
    ["인증 미설정", { kind: "anonymous", reason: "auth_not_configured" } as Viewer, "auth_not_configured"],
  ])("%s → 거부", (_, viewer, reason) => {
    expect(resolveDistributionActor(viewer)).toEqual({ ok: false, reason });
  });
  it("세션 userId가 uuid가 아니면 거부", () => {
    expect(resolveDistributionActor(member("approved", ["admin"], "not-a-uuid")).ok).toBe(false);
  });
});

describe("runDistributionWrite", () => {
  it.each([
    ["비승인 admin", member("pending", ["admin"])],
    ["일반 회원", member("approved", ["member"])],
    ["비로그인", { kind: "anonymous", reason: "not_signed_in" } as Viewer],
  ])("D1 거부(%s) → RPC 호출 0회, 클라이언트도 만들지 않음", async (_, viewer) => {
    const { client, rpc } = fakeClient({ data: okData, error: null });
    const getClient = vi.fn(() => client);
    const out = await runDistributionWrite({ ...spec(viewer, goodForm, client), getClient });
    expect(out.status).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("입력 오류 → invalid, RPC 0회", async () => {
    const { client, rpc } = fakeClient({ data: okData, error: null });
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), { title: "", body: "x" }, client));
    expect(out).toEqual({ status: "invalid", errors: [{ field: "title", rule: "required" }] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("service 키 없음(클라이언트 null) → not_ready", async () => {
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), goodForm, null));
    expect(out).toEqual({ status: "not_ready" });
  });

  it("p_actor_id는 세션에서만 — 폼에 다른 actor를 넣어도 무시", async () => {
    const { client, rpc } = fakeClient({ data: okData, error: null });
    const form = { ...goodForm, actorId: OTHER_ID, p_actor_id: OTHER_ID };
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), form, client));
    expect(out).toEqual({
      status: "ok",
      data: { contentId: okData.content_id, versionId: okData.version_id, versionNo: 1, contentHash: okData.content_hash },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const calls = rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const first = calls[0];
    if (!first) throw new Error("rpc not called");
    const [fn, params] = first;
    expect(fn).toBe("distribution_create_content");
    expect(params.p_actor_id).toBe(ADMIN_ID);
    expect(JSON.stringify(params)).not.toContain(OTHER_ID);
  });

  it("DB 오류는 토큰으로 매핑하고 원문 메시지는 남기지 않는다", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "P0001", message: "VERSION_CONFLICT: content 123 is at version 4 (expected 3)" },
    });
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), goodForm, client));
    expect(out).toEqual({ status: "db_error", error: { code: "conflict_version", token: "VERSION_CONFLICT", sqlstate: "P0001" } });
    expect(JSON.stringify(out)).not.toContain("expected 3");
  });

  it("응답 유실(throw) → unavailable, 재시도 없이 1회만", async () => {
    const { client, rpc } = fakeClient(new Error("network"));
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), goodForm, client));
    expect(out).toEqual({ status: "db_error", error: { code: "unavailable", token: null, sqlstate: null } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("반환 형식이 다르면 bad_response", async () => {
    const { client } = fakeClient({ data: { content_id: "x" }, error: null });
    const out = await runDistributionWrite(spec(member("approved", ["admin"]), goodForm, client));
    expect(out).toEqual({ status: "bad_response" });
  });
});
