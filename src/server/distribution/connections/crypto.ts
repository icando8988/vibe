/**
 * 채널 credential 서버 암호화 — Node crypto AES-256-GCM. AUTOPOST-M3-CONNECTION-017.
 *
 * 키(런타임 이름 `DISTRIBUTION_TOKEN_KEY`, 이 모듈은 env를 직접 읽지 않는다 — 호출자가 값을 넘긴다)
 *   형식: `v<버전>:<base64 32바이트>` 를 쉼표로 1~5개. **첫 항목이 현재 암호화 키**, 나머지는 복호화 전용(키 회전).
 *   예) `v2:<새 키>,v1:<옛 키>` → 새로 저장하는 credential은 v2, 기존 v1 credential은 계속 복호화.
 *   형식·길이·중복 버전이 틀리면 전체를 거부(invalid) → 준비 전(fail closed). 일부만 쓰지 않는다.
 * 지원 범위
 *   - AAD v1 = JSON ["autopost.distribution.credential", 1, owner_id, channel, provider_account_id, key_version].
 *     다른 소유자·채널·계정·키 버전 행으로 옮긴 암호문은 복호화 실패(→ 재인증 필요).
 *   - 키 회전: 새 키를 앞에 추가 → 이후 저장분부터 새 버전. 옛 credential 재암호화(일괄 rewrap)는 아직 없음 —
 *     옛 키를 빼면 그 버전 credential은 복호화 불가 → 재인증 필요(key_rotated). 다음 단계에서 rewrap RPC 검토.
 *   - nonce 12바이트 CSPRNG(매 암호화), auth tag 16바이트. 평문 형식 v1 = JSON {"access_token": "..."}.
 * 비밀 취급: 키·평문 토큰은 SecretToken/Keyring 안에만 두고 toString/toJSON/inspect는 가린다(로그·테스트 실패 출력 방지).
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_KEY_ENV = "DISTRIBUTION_TOKEN_KEY";
export const AAD_VERSION = 1 as const;
const AAD_LABEL = "autopost.distribution.credential";
const KEY_ENTRY_RE = /^v([1-9][0-9]{0,4}):([A-Za-z0-9+/]{43}=)$/; // 32바이트 base64
const INSPECT = Symbol.for("nodejs.util.inspect.custom");
const REDACTED = "[redacted]";

// ---------------------------------------------------------------- 비밀 값 래퍼
export class SecretToken {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** 서버 내부(공급자 호출 직전)에서만. 결과를 로그·응답에 싣지 말 것. */
  reveal(): string {
    return this.#value;
  }
  /** 상수 시간 비교(테스트·검증용 — 평문을 출력하지 않고 비교). */
  equals(other: string): boolean {
    const a = Buffer.from(this.#value, "utf8");
    const b = Buffer.from(other, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
  toString() {
    return REDACTED;
  }
  toJSON() {
    return REDACTED;
  }
  [INSPECT]() {
    return "SecretToken([redacted])";
  }
}

export function isValidAccessToken(v: unknown): v is string {
  return typeof v === "string" && v.length >= 10 && v.length <= 4096 && /^[\x21-\x7e]+$/.test(v);
}

// ---------------------------------------------------------------- 키링
export class Keyring {
  readonly #keys: ReadonlyMap<number, Buffer>;
  readonly currentVersion: number;
  constructor(keys: Map<number, Buffer>, currentVersion: number) {
    this.#keys = keys;
    this.currentVersion = currentVersion;
  }
  key(version: number): Buffer | null {
    return this.#keys.get(version) ?? null;
  }
  versions(): number[] {
    return [...this.#keys.keys()];
  }
  toString() {
    return REDACTED;
  }
  toJSON() {
    return { currentVersion: this.currentVersion, versions: this.versions() };
  }
  [INSPECT]() {
    return `Keyring(current=v${this.currentVersion}, versions=${this.versions().join(",")})`;
  }
}

export type KeyringResult = { status: "ok"; keyring: Keyring } | { status: "not_configured" } | { status: "invalid" };

/** 원문 문자열 → 키링. 실패 사유는 형식만(키 값은 어디에도 담지 않음). */
export function parseKeyring(raw: unknown): KeyringResult {
  if (raw === undefined || raw === null || raw === "") return { status: "not_configured" };
  if (typeof raw !== "string" || raw.length > 400) return { status: "invalid" };
  const entries = raw.split(",").map((s) => s.trim());
  if (entries.length < 1 || entries.length > 5) return { status: "invalid" };
  const keys = new Map<number, Buffer>();
  let current = 0;
  for (const e of entries) {
    const m = KEY_ENTRY_RE.exec(e);
    if (!m) return { status: "invalid" };
    const version = Number(m[1]);
    const key = Buffer.from(m[2] as string, "base64");
    if (version > 32767 || key.length !== 32 || key.toString("base64") !== m[2] || keys.has(version) || key.every((b) => b === 0)) {
      return { status: "invalid" };
    }
    keys.set(version, key);
    if (current === 0) current = version;
  }
  return { status: "ok", keyring: new Keyring(keys, current) };
}

/** 런타임: `loadKeyring(process.env)`처럼 호출자가 값을 넘긴다. 이 모듈은 process.env를 읽지 않는다. */
export function loadKeyring(source: Readonly<Record<string, string | undefined>>): KeyringResult {
  return parseKeyring(source[TOKEN_KEY_ENV]);
}

// ---------------------------------------------------------------- 봉투
export type CredentialBinding = { ownerId: string; channel: string; providerAccountId: string };
export type CredentialEnvelope = { keyVersion: number; aadVersion: typeof AAD_VERSION; ciphertext: string; nonce: string; tag: string };

export function credentialAad(b: CredentialBinding, keyVersion: number): Buffer {
  return Buffer.from(JSON.stringify([AAD_LABEL, AAD_VERSION, b.ownerId, b.channel, b.providerAccountId, keyVersion]), "utf8");
}

export function encryptCredential(keyring: Keyring, binding: CredentialBinding, token: SecretToken): CredentialEnvelope {
  const version = keyring.currentVersion;
  const key = keyring.key(version);
  if (!key) throw new Error("current key missing"); // 생성자 불변식상 도달 불가
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(credentialAad(binding, version));
  const ct = Buffer.concat([cipher.update(JSON.stringify({ access_token: token.reveal() }), "utf8"), cipher.final()]);
  return { keyVersion: version, aadVersion: AAD_VERSION, ciphertext: ct.toString("base64"), nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export type DecryptResult =
  | { ok: true; token: SecretToken }
  | { ok: false; reason: "key_rotated" | "decrypt_failed" };

/** 실패는 모두 fail closed(재인증 필요). 원인 상세(키·암호문)는 결과에 담지 않는다. */
export function decryptCredential(keyring: Keyring, binding: CredentialBinding, env: CredentialEnvelope): DecryptResult {
  if (env.aadVersion !== AAD_VERSION) return { ok: false, reason: "decrypt_failed" };
  const key = keyring.key(env.keyVersion);
  if (!key) return { ok: false, reason: "key_rotated" };
  try {
    const nonce = Buffer.from(env.nonce, "base64");
    const tag = Buffer.from(env.tag, "base64");
    if (nonce.length !== 12 || tag.length !== 16) return { ok: false, reason: "decrypt_failed" };
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(credentialAad(binding, env.keyVersion));
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(pt) as unknown;
    const t = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).access_token : undefined;
    if (!isValidAccessToken(t)) return { ok: false, reason: "decrypt_failed" };
    return { ok: true, token: new SecretToken(t) };
  } catch {
    return { ok: false, reason: "decrypt_failed" };
  }
}
