/**
 * 채널 연결 저장 경계 — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-M3-CONNECTION-017.
 * 서버 내부 전용: OAuth callback(다음 단계)이 공급자에게서 받은 토큰을 여기로 넘기는 구조. 이번에는 mock 데이터로만 검증.
 *
 * 관리자 쪽(세션 actor): 검증된 세션 actor + D1 → 입력 검증 → 키링(없거나 형식 오류면 not_ready) → service RPC 1회.
 *   토큰은 앱에서 AES-256-GCM으로 암호화해 봉투만 보낸다. AAD에 actor(=소유자)·채널·계정·키 버전을 묶는다.
 * worker 쪽: service_role RPC로 소유자 현재 D1·connected·미만료·미철회를 확인받은 봉투를 서버 안에서만 복호화.
 *   키 없음 → not_ready, 키 버전 없음·복호화 실패 → reauth_required(fail closed). 토큰은 SecretToken으로만 돌려준다.
 * 응답 파서는 허용 키만 받고 비밀성 키(ciphertext·nonce·tag·token·secret)가 보이면 bad_response.
 */
import type { ActorResult } from "../actor-core";
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import { isUuid, type FieldError } from "../validation";
import { runDistributionWrite, type RpcClient, type WriteOutcome } from "../write-runner";
import {
  decryptCredential,
  encryptCredential,
  isValidAccessToken,
  SecretToken,
  type CredentialEnvelope,
  type Keyring,
  type KeyringResult,
} from "./crypto";
import {
  CONNECTION_CHANNELS,
  CONNECTION_STATUSES,
  FORBIDDEN_RESPONSE_KEYS,
  REAUTH_REASONS,
  type ConnectionChannel,
  type ConnectionDto,
  type ReauthReason,
} from "./types";

export const CONNECTION_RPC = Object.freeze({
  create: "distribution_create_channel_connection",
  reconnect: "distribution_reconnect_channel_connection",
  revoke: "distribution_revoke_channel_connection",
  markReauth: "distribution_mark_channel_connection_reauth",
  list: "distribution_list_channel_connections",
  readCredential: "distribution_read_channel_credential",
} as const);

export type ConnectionDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  getKeyring: () => KeyringResult;
};

const ACCOUNT_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SCOPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ZONED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------- 입력 검증
type MetaInput = { accountLabel: string | null; scopes: string[]; expiresAt: string; token: SecretToken };

function parseMeta(input: { accountLabel?: unknown; scopes: unknown; expiresAt: unknown; token: unknown }, now: number, errors: FieldError[]): MetaInput | null {
  const label = input.accountLabel;
  let accountLabel: string | null = null;
  if (label !== undefined && label !== null && label !== "") {
    if (typeof label !== "string" || [...label].length > 100 || /[\u0000-\u001f\u007f]/.test(label)) errors.push({ field: "accountLabel", rule: "label" });
    else accountLabel = label;
  }
  const scopes = input.scopes;
  const okScopes =
    Array.isArray(scopes) && scopes.length >= 1 && scopes.length <= 20 && scopes.every((s) => typeof s === "string" && SCOPE_RE.test(s)) && new Set(scopes).size === scopes.length;
  if (!okScopes) errors.push({ field: "scopes", rule: "scopes" });
  const exp = input.expiresAt;
  const expMs = typeof exp === "string" && ZONED_RE.test(exp) ? Date.parse(exp) : NaN;
  if (!Number.isFinite(expMs) || expMs <= now || expMs > now + 400 * 86_400_000) errors.push({ field: "expiresAt", rule: "future_zoned_datetime" });
  const t = input.token;
  const token = t instanceof SecretToken ? (isValidAccessToken(t.reveal()) ? t : null) : isValidAccessToken(t) ? new SecretToken(t) : null;
  if (!token) errors.push({ field: "token", rule: "token" });
  if (!okScopes || !Number.isFinite(expMs) || !token || errors.length) return null;
  return { accountLabel, scopes: scopes as string[], expiresAt: new Date(expMs).toISOString(), token };
}

function keyringOrNull(deps: ConnectionDeps): Keyring | null {
  const k = deps.getKeyring();
  return k.status === "ok" ? k.keyring : null;
}

function envelopeParams(e: CredentialEnvelope) {
  return { p_key_version: e.keyVersion, p_aad_version: e.aadVersion, p_ciphertext: e.ciphertext, p_nonce: e.nonce, p_tag: e.tag };
}

// ---------------------------------------------------------------- 응답 파서(비밀 차단)
const META_KEYS = new Set([
  "id", "channel", "provider_account_id", "account_label", "scopes", "status", "reauth_reason",
  "expires_at", "key_version", "row_version", "created_at", "updated_at", "revoked_at", "has_credential",
]);

function hasForbiddenKey(o: Record<string, unknown>): boolean {
  return Object.keys(o).some((k) => (FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(k) || !META_KEYS.has(k));
}

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

export function toConnectionDto(raw: unknown, now = Date.now()): ConnectionDto | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || hasForbiddenKey(r)) return null;
  const expiresAt = iso(r.expires_at);
  const createdAt = iso(r.created_at);
  const updatedAt = iso(r.updated_at);
  if (
    !isUuid(r.id) ||
    !(CONNECTION_CHANNELS as readonly unknown[]).includes(r.channel) ||
    typeof r.provider_account_id !== "string" ||
    !Array.isArray(r.scopes) ||
    !r.scopes.every((s) => typeof s === "string") ||
    !(CONNECTION_STATUSES as readonly unknown[]).includes(r.status) ||
    (r.reauth_reason !== null && !(REAUTH_REASONS as readonly unknown[]).includes(r.reauth_reason)) ||
    !expiresAt || !createdAt || !updatedAt ||
    !Number.isInteger(r.row_version) ||
    (r.key_version !== null && !Number.isInteger(r.key_version)) ||
    (r.revoked_at !== null && !iso(r.revoked_at)) ||
    (r.has_credential !== undefined && typeof r.has_credential !== "boolean")
  ) {
    return null;
  }
  return {
    id: r.id,
    channel: r.channel as ConnectionChannel,
    providerAccountId: r.provider_account_id,
    accountLabel: typeof r.account_label === "string" ? r.account_label : null,
    scopes: r.scopes as string[],
    status: r.status as ConnectionDto["status"],
    reauthReason: (r.reauth_reason as ReauthReason | null) ?? null,
    expiresAt,
    expired: Date.parse(expiresAt) <= now,
    keyVersion: (r.key_version as number | null) ?? null,
    hasCredential: typeof r.has_credential === "boolean" ? r.has_credential : null,
    rowVersion: r.row_version as number,
    createdAt,
    updatedAt,
    revokedAt: (r.revoked_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------- 1) 새 연결
export type NewConnectionInput = {
  channel: unknown;
  providerAccountId: unknown;
  accountLabel?: unknown;
  scopes: unknown;
  expiresAt: unknown;
  /** 공급자에게서 받은 access token(서버 내부). 문자열이면 즉시 SecretToken으로 감싼다. */
  token: unknown;
};

export function saveNewConnection(deps: ConnectionDeps, input: NewConnectionInput, now = Date.now()): Promise<WriteOutcome<ConnectionDto>> {
  const keyring = keyringOrNull(deps);
  return runDistributionWrite<{ channel: ConnectionChannel; providerAccountId: string } & MetaInput, ConnectionDto>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const errors: FieldError[] = [];
      const channel = input.channel;
      if (!(CONNECTION_CHANNELS as readonly unknown[]).includes(channel)) errors.push({ field: "channel", rule: "channel" });
      const account = input.providerAccountId;
      if (typeof account !== "string" || !ACCOUNT_RE.test(account)) errors.push({ field: "providerAccountId", rule: "account_id" });
      const meta = parseMeta(input, now, errors);
      if (errors.length || !meta) return { ok: false, errors };
      return { ok: true, value: { channel: channel as ConnectionChannel, providerAccountId: account as string, ...meta } };
    },
    // 키링이 없거나 형식 오류면 RPC 전에 not_ready(fail closed)
    getClient: () => (keyring ? deps.getClient() : null),
    fn: CONNECTION_RPC.create,
    params: (actorId, v) => {
      const env = encryptCredential(keyring as Keyring, { ownerId: actorId, channel: v.channel, providerAccountId: v.providerAccountId }, v.token);
      return {
        p_actor_id: actorId,
        p_channel: v.channel,
        p_provider_account_id: v.providerAccountId,
        p_account_label: v.accountLabel,
        p_scopes: v.scopes,
        p_expires_at: v.expiresAt,
        ...envelopeParams(env),
      };
    },
    parse: (d) => toConnectionDto(d, now),
  });
}

// ---------------------------------------------------------------- 2) 같은 계정 재연결
export type ReconnectInput = Omit<NewConnectionInput, "channel"> & { connectionId: unknown; channel: unknown; expectedVersion: unknown };

/**
 * 같은 계정만. 화면이 렌더한 연결의 channel·providerAccountId·rowVersion을 그대로 보낸다.
 * 공급자가 다른 계정을 돌려주면 서버가 ACCOUNT_MISMATCH로 거절 → 호출자는 saveNewConnection(새 연결)로 분기해야 한다.
 */
export function reconnectSameAccount(deps: ConnectionDeps, input: ReconnectInput, now = Date.now()): Promise<WriteOutcome<ConnectionDto>> {
  const keyring = keyringOrNull(deps);
  return runDistributionWrite<{ connectionId: string; expectedVersion: number; channel: ConnectionChannel; providerAccountId: string } & MetaInput, ConnectionDto>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const errors: FieldError[] = [];
      if (!isUuid(input.connectionId)) errors.push({ field: "connectionId", rule: "uuid" });
      const ev = input.expectedVersion;
      if (!Number.isInteger(ev) || (ev as number) < 1) errors.push({ field: "expectedVersion", rule: "expected" });
      if (!(CONNECTION_CHANNELS as readonly unknown[]).includes(input.channel)) errors.push({ field: "channel", rule: "channel" });
      if (typeof input.providerAccountId !== "string" || !ACCOUNT_RE.test(input.providerAccountId)) errors.push({ field: "providerAccountId", rule: "account_id" });
      const meta = parseMeta(input, now, errors);
      if (errors.length || !meta) return { ok: false, errors };
      return {
        ok: true,
        value: { connectionId: input.connectionId as string, expectedVersion: ev as number, channel: input.channel as ConnectionChannel, providerAccountId: input.providerAccountId as string, ...meta },
      };
    },
    getClient: () => (keyring ? deps.getClient() : null),
    fn: CONNECTION_RPC.reconnect,
    params: (actorId, v) => {
      const env = encryptCredential(keyring as Keyring, { ownerId: actorId, channel: v.channel, providerAccountId: v.providerAccountId }, v.token);
      return {
        p_actor_id: actorId,
        p_connection_id: v.connectionId,
        p_expected_version: v.expectedVersion,
        p_provider_account_id: v.providerAccountId,
        p_account_label: v.accountLabel,
        p_scopes: v.scopes,
        p_expires_at: v.expiresAt,
        ...envelopeParams(env),
      };
    },
    parse: (d) => toConnectionDto(d, now),
  });
}

/** ACCOUNT_MISMATCH 판정(호출자가 새 연결로 분기할지 결정). */
export function isAccountMismatch(out: WriteOutcome<unknown>): boolean {
  return out.status === "db_error" && out.error.token === "ACCOUNT_MISMATCH";
}

// ---------------------------------------------------------------- 3) 철회 · 4) 재인증 표시
export function revokeConnection(
  deps: Pick<ConnectionDeps, "resolveActor" | "getClient">,
  input: { connectionId: unknown; expectedVersion: unknown; reason?: unknown },
  now = Date.now(),
): Promise<WriteOutcome<ConnectionDto>> {
  return runDistributionWrite<{ connectionId: string; expectedVersion: number; reason: string | null }, ConnectionDto>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const errors: FieldError[] = [];
      if (!isUuid(input.connectionId)) errors.push({ field: "connectionId", rule: "uuid" });
      if (!Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) errors.push({ field: "expectedVersion", rule: "expected" });
      const r = input.reason;
      if (r !== undefined && r !== null && (typeof r !== "string" || [...r].length > 500 || /[\u0000-\u001f\u007f]/.test(r))) errors.push({ field: "reason", rule: "reason" });
      if (errors.length) return { ok: false, errors };
      return { ok: true, value: { connectionId: input.connectionId as string, expectedVersion: input.expectedVersion as number, reason: typeof r === "string" && r.trim() ? r : null } };
    },
    getClient: deps.getClient,
    fn: CONNECTION_RPC.revoke,
    params: (actorId, v) => ({ p_actor_id: actorId, p_connection_id: v.connectionId, p_expected_version: v.expectedVersion, p_reason: v.reason }),
    parse: (d) => toConnectionDto(d, now),
  });
}

export function markReauthRequired(
  deps: Pick<ConnectionDeps, "resolveActor" | "getClient">,
  input: { connectionId: unknown; expectedVersion: unknown; reason: unknown },
  now = Date.now(),
): Promise<WriteOutcome<ConnectionDto>> {
  return runDistributionWrite<{ connectionId: string; expectedVersion: number; reason: ReauthReason }, ConnectionDto>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const errors: FieldError[] = [];
      if (!isUuid(input.connectionId)) errors.push({ field: "connectionId", rule: "uuid" });
      if (!Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) errors.push({ field: "expectedVersion", rule: "expected" });
      if (!(REAUTH_REASONS as readonly unknown[]).includes(input.reason)) errors.push({ field: "reason", rule: "reauth_reason" });
      if (errors.length) return { ok: false, errors };
      return { ok: true, value: { connectionId: input.connectionId as string, expectedVersion: input.expectedVersion as number, reason: input.reason as ReauthReason } };
    },
    getClient: deps.getClient,
    fn: CONNECTION_RPC.markReauth,
    params: (actorId, v) => ({ p_actor_id: actorId, p_connection_id: v.connectionId, p_expected_version: v.expectedVersion, p_reason: v.reason }),
    parse: (d) => toConnectionDto(d, now),
  });
}

// ---------------------------------------------------------------- 5) 목록(비밀 없음)
export type ConnectionListOutcome =
  | { status: "ok"; connections: ConnectionDto[] }
  | { status: "denied"; reason: Extract<ActorResult, { ok: false }>["reason"] }
  | { status: "not_ready" }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

export async function listConnections(deps: Pick<ConnectionDeps, "resolveActor" | "getClient">, now = Date.now()): Promise<ConnectionListOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };
  const client = deps.getClient();
  if (!client) return { status: "not_ready" };
  let res;
  try {
    res = await client.rpc(CONNECTION_RPC.list, { p_actor_id: actor.actorId });
  } catch {
    return { status: "db_error", error: unavailableError() };
  }
  if (res.error) return { status: "db_error", error: mapDistributionDbError(res.error) };
  if (!Array.isArray(res.data)) return { status: "bad_response" };
  const out: ConnectionDto[] = [];
  for (const row of res.data) {
    const dto = toConnectionDto(row, now);
    if (!dto) return { status: "bad_response" };
    out.push(dto);
  }
  return { status: "ok", connections: out };
}

// ---------------------------------------------------------------- 6) worker credential 읽기(서버 내부)
export type WorkerCredential = {
  connectionId: string;
  ownerId: string;
  channel: ConnectionChannel;
  providerAccountId: string;
  rowVersion: number;
  expiresAt: string;
  token: SecretToken;
};

export type WorkerCredentialOutcome =
  | { status: "ok"; credential: WorkerCredential }
  | { status: "not_ready" } // 키링·service 연결 없음
  | { status: "reauth_required"; reason: ReauthReason | "revoked"; rowVersion: number | null }
  | { status: "denied" } // 소유자 D1 상실
  | { status: "not_found" }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function readCredentialForWorker(
  deps: Pick<ConnectionDeps, "getClient" | "getKeyring">,
  input: { ownerId: unknown; connectionId: unknown; expectChannel?: ConnectionChannel },
): Promise<WorkerCredentialOutcome> {
  if (!isUuid(input.ownerId) || !isUuid(input.connectionId)) return { status: "not_found" };
  const k = deps.getKeyring();
  if (k.status !== "ok") return { status: "not_ready" };
  const client = deps.getClient();
  if (!client) return { status: "not_ready" };
  let res;
  try {
    res = await client.rpc(CONNECTION_RPC.readCredential, { p_owner_id: input.ownerId, p_connection_id: input.connectionId });
  } catch {
    return { status: "db_error", error: unavailableError() };
  }
  if (res.error) {
    const e = mapDistributionDbError(res.error);
    if (e.token === "REAUTH_REQUIRED") return { status: "reauth_required", reason: "manual", rowVersion: null };
    if (e.token === "CREDENTIAL_EXPIRED") return { status: "reauth_required", reason: "expired", rowVersion: null };
    if (e.token === "CONNECTION_REVOKED") return { status: "reauth_required", reason: "revoked", rowVersion: null };
    if (e.code === "forbidden") return { status: "denied" };
    if (e.code === "not_found") return { status: "not_found" };
    return { status: "db_error", error: e };
  }
  const row = Array.isArray(res.data) && res.data.length === 1 ? (res.data[0] as Record<string, unknown>) : null;
  if (
    !row ||
    row.connection_id !== input.connectionId ||
    row.owner_id !== input.ownerId ||
    !(CONNECTION_CHANNELS as readonly unknown[]).includes(row.channel) ||
    (input.expectChannel && row.channel !== input.expectChannel) ||
    typeof row.provider_account_id !== "string" ||
    !Number.isInteger(row.key_version) ||
    row.aad_version !== 1 ||
    typeof row.ciphertext !== "string" || !B64.test(row.ciphertext) ||
    typeof row.nonce !== "string" || typeof row.auth_tag !== "string" ||
    !iso(row.expires_at) || !Number.isInteger(row.row_version)
  ) {
    return { status: "bad_response" };
  }
  const rowVersion = row.row_version as number;
  if (Date.parse(row.expires_at as string) <= Date.now()) return { status: "reauth_required", reason: "expired", rowVersion };
  const binding = { ownerId: input.ownerId, channel: row.channel as string, providerAccountId: row.provider_account_id };
  const dec = decryptCredential(k.keyring, binding, {
    keyVersion: row.key_version as number,
    aadVersion: 1,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    tag: row.auth_tag,
  });
  if (!dec.ok) return { status: "reauth_required", reason: dec.reason, rowVersion };
  return {
    status: "ok",
    credential: {
      connectionId: input.connectionId,
      ownerId: input.ownerId,
      channel: row.channel as ConnectionChannel,
      providerAccountId: row.provider_account_id,
      rowVersion,
      expiresAt: row.expires_at as string,
      token: dec.token,
    },
  };
}
