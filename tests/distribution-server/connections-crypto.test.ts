/**
 * AUTOPOST-M3-CONNECTION-017 — credential 암호화·저장 서비스 단위 검증.
 * 시험 키는 매 실행 randomBytes로 만든 임시 값만 쓴다(실제 env·키 파일 읽지 않음).
 * 토큰 문자열을 단언 값으로 쓰지 않는다(실패 출력에 남지 않도록 equals/includes→boolean만 비교).
 */
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import {
  decryptCredential,
  encryptCredential,
  loadKeyring,
  parseKeyring,
  SecretToken,
  TOKEN_KEY_ENV,
  type Keyring,
} from "@/server/distribution/connections/crypto";
import {
  isAccountMismatch,
  listConnections,
  readCredentialForWorker,
  reconnectSameAccount,
  revokeConnection,
  saveNewConnection,
  toConnectionDto,
} from "@/server/distribution/connections/service";
import type { RpcClient } from "@/server/distribution/write-runner";

const OWNER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const CONN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = `THtest_${randomBytes(18).toString("hex")}`;
const key = () => randomBytes(32).toString("base64");
const ring = (raw: string): Keyring => {
  const r = parseKeyring(raw);
  if (r.status !== "ok") throw new Error(`keyring ${r.status}`);
  return r.keyring;
};
const bind = { ownerId: OWNER, channel: "threads", providerAccountId: "17841400000000001" };
const contains = (x: unknown, s: string) => JSON.stringify(x).includes(s);

describe("키링 파싱(fail closed)", () => {
  it("없음 → not_configured, 형식 오류 → invalid", () => {
    expect(parseKeyring(undefined).status).toBe("not_configured");
    expect(parseKeyring("").status).toBe("not_configured");
    expect(parseKeyring(key()).status).toBe("invalid"); // 버전 접두 없음
    expect(parseKeyring(`v1:${randomBytes(16).toString("base64")}`).status).toBe("invalid"); // 16바이트
    expect(parseKeyring(`v1:${key()},v1:${key()}`).status).toBe("invalid"); // 버전 중복
    expect(parseKeyring(`v0:${key()}`).status).toBe("invalid");
    expect(parseKeyring(`v1:${Buffer.alloc(32).toString("base64")}`).status).toBe("invalid"); // 0 키
    expect(parseKeyring(`v1:${key()},garbage`).status).toBe("invalid"); // 일부만 쓰지 않음
  });
  it("런타임 이름 DISTRIBUTION_TOKEN_KEY, 첫 항목이 현재 키", () => {
    expect(TOKEN_KEY_ENV).toBe("DISTRIBUTION_TOKEN_KEY");
    const r = loadKeyring({ DISTRIBUTION_TOKEN_KEY: `v3:${key()},v1:${key()}` });
    expect(r.status === "ok" && r.keyring.currentVersion).toBe(3);
    expect(loadKeyring({}).status).toBe("not_configured");
  });
  it("키링·토큰은 문자열화·JSON·inspect에서 가려진다", () => {
    const raw = key();
    const k = ring(`v1:${raw}`);
    for (const out of [String(k), JSON.stringify(k), inspect(k)]) expect(out.includes(raw)).toBe(false);
    const t = new SecretToken(TOKEN);
    for (const out of [String(t), JSON.stringify({ t }), inspect(t), `${t}`]) expect(out.includes(TOKEN)).toBe(false);
    expect(t.equals(TOKEN)).toBe(true);
  });
});

describe("AES-256-GCM 봉투", () => {
  it("왕복 + 매번 새 nonce + 봉투에 평문 없음", () => {
    const k = ring(`v1:${key()}`);
    const a = encryptCredential(k, bind, new SecretToken(TOKEN));
    const b = encryptCredential(k, bind, new SecretToken(TOKEN));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(contains(a, TOKEN)).toBe(false);
    expect(Buffer.from(a.nonce, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
    const d = decryptCredential(k, bind, a);
    expect(d.ok && d.token.equals(TOKEN)).toBe(true);
  });
  it("변조(암호문·tag·nonce) → decrypt_failed", () => {
    const k = ring(`v1:${key()}`);
    const e = encryptCredential(k, bind, new SecretToken(TOKEN));
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64");
      buf[0] = (buf[0] ?? 0) ^ 1;
      return buf.toString("base64");
    };
    expect(decryptCredential(k, bind, { ...e, ciphertext: flip(e.ciphertext) })).toEqual({ ok: false, reason: "decrypt_failed" });
    expect(decryptCredential(k, bind, { ...e, tag: flip(e.tag) })).toEqual({ ok: false, reason: "decrypt_failed" });
    expect(decryptCredential(k, bind, { ...e, nonce: flip(e.nonce) })).toEqual({ ok: false, reason: "decrypt_failed" });
  });
  it("잘못된 AAD(소유자·채널·계정·키 버전) → decrypt_failed", () => {
    const k = ring(`v1:${key()}`);
    const e = encryptCredential(k, bind, new SecretToken(TOKEN));
    for (const b of [{ ...bind, ownerId: OTHER }, { ...bind, channel: "instagram" }, { ...bind, providerAccountId: "17841400000000002" }]) {
      expect(decryptCredential(k, b, e)).toEqual({ ok: false, reason: "decrypt_failed" });
    }
    // 키 버전만 바꾼 봉투(같은 키 바이트를 다른 버전으로 등록해도 AAD가 달라 실패)
    const raw = key();
    const k2 = ring(`v1:${raw},v2:${raw}`.split(",").reverse().join(","));
    const e1 = encryptCredential(ring(`v1:${raw}`), bind, new SecretToken(TOKEN));
    expect(decryptCredential(k2, bind, { ...e1, keyVersion: 2 })).toEqual({ ok: false, reason: "decrypt_failed" });
  });
  it("다른 키 → decrypt_failed, 키 회전: 옛 키 유지 시 복호화, 제거 시 key_rotated", () => {
    const k1raw = key();
    const e = encryptCredential(ring(`v1:${k1raw}`), bind, new SecretToken(TOKEN));
    expect(decryptCredential(ring(`v1:${key()}`), bind, e)).toEqual({ ok: false, reason: "decrypt_failed" });
    const rotated = ring(`v2:${key()},v1:${k1raw}`);
    const d = decryptCredential(rotated, bind, e);
    expect(d.ok && d.token.equals(TOKEN)).toBe(true);
    expect(encryptCredential(rotated, bind, new SecretToken(TOKEN)).keyVersion).toBe(2);
    expect(decryptCredential(ring(`v2:${key()}`), bind, e)).toEqual({ ok: false, reason: "key_rotated" });
  });
});

describe("저장 서비스(mock RPC)", () => {
  const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: OWNER });
  const denied = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
  const meta = (o: Record<string, unknown> = {}) => ({
    id: CONN, channel: "threads", provider_account_id: "17841400000000001", account_label: "me", scopes: ["threads_basic"],
    status: "connected", reauth_reason: null, expires_at: "2027-01-01T00:00:00.000Z", key_version: 1, row_version: 1,
    created_at: "2026-11-17T00:00:00.000Z", updated_at: "2026-11-17T00:00:00.000Z", revoked_at: null, ...o,
  });
  const mock = (data: unknown, error: unknown = null) => {
    const rpc = vi.fn(async () => ({ data, error }));
    return { c: { rpc } as unknown as RpcClient, rpc };
  };
  const input = { channel: "threads", providerAccountId: "17841400000000001", accountLabel: "me", scopes: ["threads_basic", "threads_content_publish"], expiresAt: "2027-01-01T00:00:00Z", token: TOKEN };
  const NOW = Date.parse("2026-11-17T00:00:00Z");

  it("D1 거부·키링 없음/오류 → RPC 0회", async () => {
    const { c, rpc } = mock(meta());
    expect((await saveNewConnection({ resolveActor: denied, getClient: () => c, getKeyring: () => parseKeyring(`v1:${key()}`) }, input, NOW)).status).toBe("denied");
    expect((await saveNewConnection({ resolveActor: allowed, getClient: () => c, getKeyring: () => ({ status: "not_configured" }) }, input, NOW)).status).toBe("not_ready");
    expect((await saveNewConnection({ resolveActor: allowed, getClient: () => c, getKeyring: () => ({ status: "invalid" }) }, input, NOW)).status).toBe("not_ready");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("RPC 인자에는 봉투만(평문 없음), actor=세션, AAD는 세션 actor에 묶임", async () => {
    const k = ring(`v1:${key()}`);
    const { c, rpc } = mock(meta());
    const out = await saveNewConnection({ resolveActor: allowed, getClient: () => c, getKeyring: () => ({ status: "ok", keyring: k }) }, { ...input, p_actor_id: OTHER } as typeof input, NOW);
    expect(out.status).toBe("ok");
    const params = (rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]?.[1] ?? {};
    expect(contains(params, TOKEN)).toBe(false);
    expect(params.p_actor_id).toBe(OWNER);
    expect(Object.keys(params).sort()).toEqual(
      ["p_aad_version", "p_account_label", "p_actor_id", "p_channel", "p_ciphertext", "p_expires_at", "p_key_version", "p_nonce", "p_provider_account_id", "p_scopes", "p_tag"].sort(),
    );
    const env = { keyVersion: params.p_key_version as number, aadVersion: 1 as const, ciphertext: params.p_ciphertext as string, nonce: params.p_nonce as string, tag: params.p_tag as string };
    const d = decryptCredential(k, bind, env);
    expect(d.ok && d.token.equals(TOKEN)).toBe(true);
    expect(decryptCredential(k, { ...bind, ownerId: OTHER }, env).ok).toBe(false);
  });
  it("입력 검증: 만료 과거·형식, 토큰 형식, scope 형식", async () => {
    const { c, rpc } = mock(meta());
    const d = { resolveActor: allowed, getClient: () => c, getKeyring: () => parseKeyring(`v1:${key()}`) };
    expect((await saveNewConnection(d, { ...input, expiresAt: "2026-01-01T00:00:00Z" }, NOW)).status).toBe("invalid");
    expect((await saveNewConnection(d, { ...input, expiresAt: "2027-01-01" }, NOW)).status).toBe("invalid");
    expect((await saveNewConnection(d, { ...input, token: "short" }, NOW)).status).toBe("invalid");
    expect((await saveNewConnection(d, { ...input, scopes: ["Threads Basic"] }, NOW)).status).toBe("invalid");
    expect((await saveNewConnection(d, { ...input, channel: "blog" }, NOW)).status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("응답에 비밀성 키가 있으면 bad_response", async () => {
    const d = (data: unknown) => ({ resolveActor: allowed, getClient: () => mock(data).c, getKeyring: () => parseKeyring(`v1:${key()}`) });
    expect((await saveNewConnection(d(meta({ ciphertext: "AAAA" })), input, NOW)).status).toBe("bad_response");
    expect((await listConnections(d([meta({ nonce: "x" })]))).status).toBe("bad_response");
    expect(toConnectionDto(meta({ tag: "x" }))).toBeNull();
    expect(toConnectionDto(meta())).toMatchObject({ id: CONN, status: "connected", keyVersion: 1 });
  });
  it("재연결: 다른 계정 → ACCOUNT_MISMATCH 판정, 철회: version 필수", async () => {
    const d = { resolveActor: allowed, getClient: () => mock(null, { code: "23514", message: "ACCOUNT_MISMATCH: different" }).c, getKeyring: () => parseKeyring(`v1:${key()}`) };
    const out = await reconnectSameAccount(d, { ...input, connectionId: CONN, expectedVersion: 1, providerAccountId: "17841400000000009" }, NOW);
    expect(isAccountMismatch(out)).toBe(true);
    const { c, rpc } = mock(meta({ status: "revoked", key_version: null, revoked_at: "2026-11-17T01:00:00.000Z" }));
    expect((await revokeConnection({ resolveActor: allowed, getClient: () => c }, { connectionId: CONN, expectedVersion: "1" })).status).toBe("invalid");
    expect((await revokeConnection({ resolveActor: allowed, getClient: () => c }, { connectionId: CONN, expectedVersion: 1 })).status).toBe("ok");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("worker 읽기: 키 없음 not_ready, 오류 토큰 → reauth_required, 소유자 불일치 bad_response", async () => {
    const k = ring(`v1:${key()}`);
    const env = encryptCredential(k, bind, new SecretToken(TOKEN));
    const row = { connection_id: CONN, owner_id: OWNER, channel: "threads", provider_account_id: bind.providerAccountId, key_version: 1, aad_version: 1, ciphertext: env.ciphertext, nonce: env.nonce, auth_tag: env.tag, expires_at: "2099-01-01T00:00:00.000Z", row_version: 2 };
    const deps = (data: unknown, error: unknown = null, keyring = k) => ({ getClient: () => mock(data, error).c, getKeyring: () => ({ status: "ok" as const, keyring }) });
    expect((await readCredentialForWorker({ getClient: () => mock([row]).c, getKeyring: () => ({ status: "not_configured" }) }, { ownerId: OWNER, connectionId: CONN })).status).toBe("not_ready");
    const ok = await readCredentialForWorker(deps([row]), { ownerId: OWNER, connectionId: CONN, expectChannel: "threads" });
    expect(ok.status === "ok" && ok.credential.token.equals(TOKEN)).toBe(true);
    expect(contains(ok, TOKEN)).toBe(false); // 결과 직렬화에도 평문 없음
    expect(await readCredentialForWorker(deps([row], null, ring(`v1:${key()}`)), { ownerId: OWNER, connectionId: CONN })).toEqual({ status: "reauth_required", reason: "decrypt_failed", rowVersion: 2 });
    expect((await readCredentialForWorker(deps([{ ...row, owner_id: OTHER }]), { ownerId: OWNER, connectionId: CONN })).status).toBe("bad_response");
    expect((await readCredentialForWorker(deps([row]), { ownerId: OWNER, connectionId: CONN, expectChannel: "instagram" })).status).toBe("bad_response");
    expect(await readCredentialForWorker(deps(null, { code: "55000", message: "REAUTH_REQUIRED: x" }), { ownerId: OWNER, connectionId: CONN })).toMatchObject({ status: "reauth_required" });
    expect(await readCredentialForWorker(deps(null, { code: "55000", message: "CREDENTIAL_EXPIRED: x" }), { ownerId: OWNER, connectionId: CONN })).toMatchObject({ status: "reauth_required", reason: "expired" });
    expect((await readCredentialForWorker(deps(null, { code: "42501", message: "actor is not" }), { ownerId: OWNER, connectionId: CONN })).status).toBe("denied");
  });
});
