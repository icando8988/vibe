/**
 * Supabase Storage → MediaStorage 어댑터 — BE-MEDIA-024. 순수(의존성 주입) — env·server-only 없음, 시험은 SDK mock.
 * 실제 클라이언트 주입은 session.ts(server-only)만 한다.
 *
 * 통제:
 *   - bucket은 MEDIA_BUCKET 하나. 경로는 DB 생성 열 형식만: upload·createSignedUrl = variants/<asset>/feed_jpeg.jpg,
 *     download·remove = uploads/<owner>/<asset>/original. 형식이 다르면 SDK 호출 0회로 storage_error.
 *   - upload는 upsert:false(덮어쓰기 금지) + contentType image/jpeg + bucket 상한(8MB) 이하만.
 *   - download는 maxDownloadBytes 초과면 storage_error(바이트를 넘기지 않음).
 *   - 서명 URL은 https + 설정된 Supabase origin만 신뢰, ttl 60~900초.
 *   - 오류는 StorageFailCode로만 정제(메시지·경로·URL·토큰 비반영). 던져진 예외·5xx·상태 없음은 storage_unavailable(결과 불명).
 *   - 재시도 없음. 임의 외부 URL fetch 없음.
 */
import { APP_MEDIA_POLICY, MEDIA_BUCKET, MEDIA_INTAKE_BUCKET, UPLOAD_POLICY } from "./policy";
import {
  isUploadObjectPath,
  isVariantObjectPath,
  SignedUrl,
  type MediaIntakeStorage,
  type MediaStorage,
  type StorageFailCode,
  type StorageResult,
} from "./storage";

type SdkResult<T> = { data: T | null; error: unknown };
type BlobLike = { size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** supabase-js `client.storage.from(bucket)`에서 쓰는 부분만(시험 mock 대상). */
export type StorageBucketApi = {
  upload(path: string, body: Buffer, options: { contentType: string; upsert: boolean; cacheControl?: string }): PromiseLike<SdkResult<unknown>>;
  download(path: string): PromiseLike<SdkResult<BlobLike>>;
  remove(paths: string[]): PromiseLike<SdkResult<unknown[]>>;
  createSignedUrl(path: string, expiresIn: number): PromiseLike<SdkResult<{ signedUrl: string }>>;
};
export type StorageClientLike = { from(bucket: string): StorageBucketApi };

/** intake bucket에서 쓰는 부분(createSignedUploadUrl은 upsert 옵션 없이만 호출). */
export type IntakeBucketApi = {
  createSignedUploadUrl(path: string): PromiseLike<SdkResult<{ signedUrl: string; token?: string; path?: string }>>;
  download(path: string): PromiseLike<SdkResult<BlobLike>>;
  remove(paths: string[]): PromiseLike<SdkResult<unknown[]>>;
};
export type IntakeClientLike = { from(bucket: string): IntakeBucketApi };

export type SupabaseMediaStorageOptions = {
  /** 서명 URL이 가리켜야 하는 Supabase 프로젝트 origin(https). */
  origin: string;
  maxDownloadBytes?: number;
};

/** 변형 bucket 상한(120000 계약 file_size_limit 8388608과 같음). */
export const VARIANT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REMOVE_PATHS = 10;

const fail = (code: StorageFailCode): { ok: false; code: StorageFailCode } => ({ ok: false, code });

/** Storage 오류 → 정제 코드. 메시지는 보지 않는다(상태·서비스 코드만). */
export function sanitizeStorageError(error: unknown): StorageFailCode {
  if (!error || typeof error !== "object") return "storage_unavailable";
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof e.status === "number" ? e.status : null;
  const statusCode = typeof e.statusCode === "string" && /^\d{3}$/.test(e.statusCode) ? Number(e.statusCode) : null;
  const svc = typeof e.code === "string" ? e.code : null;
  if (svc === "NoSuchKey" || svc === "NoSuchUpload" || status === 404 || statusCode === 404) return "not_found";
  if (svc === "ResourceAlreadyExists" || svc === "Duplicate" || status === 409 || statusCode === 409) return "already_exists";
  if (status === null && statusCode === null) return "storage_unavailable"; // 응답 없음(네트워크·알 수 없는 오류)
  if ((status ?? 0) >= 500 || (statusCode ?? 0) >= 500) return "storage_unavailable";
  return "storage_error";
}

function trustedSignedUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.origin === origin && !u.username && !u.password ? raw : null;
  } catch {
    return null;
  }
}

async function guarded<T>(run: () => Promise<StorageResult<T>>): Promise<StorageResult<T>> {
  try {
    return await run();
  } catch {
    return fail("storage_unavailable");
  }
}

function httpsOrigin(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") throw new Error("origin");
    return u.origin;
  } catch {
    throw new Error("media storage origin must be an https origin");
  }
}

/**
 * 영구(결정적) 읽기 실패 표시 — BE-MEDIA-PERMANENT-INTAKE-ERROR-052.
 * 객체는 upsert 없이 한 번만 써지므로(덮어쓰기 불가) 빈 객체·상한 초과 객체는 다시 읽어도 같다 → 재시도 대상이 아니다.
 * code는 후방호환을 위해 storage_error 그대로 두고 `permanent`로만 구분한다(StorageResult 실패 모양과 구조적으로 호환).
 * 일시 장애(응답 없음·5xx·SDK 형식 이상)는 permanent 없이 기존 storage_error/storage_unavailable.
 */
export type PermanentReadReason = "empty_object" | "object_too_large";
export type PermanentReadFailure = { ok: false; code: "storage_error"; permanent: PermanentReadReason };
const permanentFail = (permanent: PermanentReadReason): PermanentReadFailure => ({ ok: false, code: "storage_error", permanent });

/** 실패 결과가 결정적 입력 문제인지(빈 객체·상한 초과). 그 밖(일시 장애·없음)은 null. */
export function permanentReadReason(r: StorageResult<unknown>): PermanentReadReason | null {
  if (r.ok) return null;
  const p = (r as { permanent?: unknown }).permanent;
  return p === "empty_object" || p === "object_too_large" ? p : null;
}

async function downloadCapped(api: { download(path: string): PromiseLike<SdkResult<BlobLike>> }, path: string, max: number, tagPermanent = false): Promise<StorageResult<Buffer>> {
  const sized = (reason: PermanentReadReason) => (tagPermanent ? permanentFail(reason) : fail("storage_error")); // 052: intake만 영구 표시(M4 어댑터 결과 모양 불변)
  const r = await api.download(path);
  if (r.error) return fail(sanitizeStorageError(r.error));
  const blob = r.data;
  if (!blob || typeof blob.size !== "number" || typeof blob.arrayBuffer !== "function") return fail("storage_error");
  if (blob.size === 0) return sized("empty_object");
  if (blob.size > max) return sized("object_too_large"); // 바이트를 읽지 않는다
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length === 0) return sized("empty_object");
  if (buf.length > max) return sized("object_too_large");
  return { ok: true, value: buf };
}

async function removeChecked(api: { remove(paths: string[]): PromiseLike<SdkResult<unknown[]>> }, paths: string[]): Promise<StorageResult<true>> {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_REMOVE_PATHS || !paths.every(isUploadObjectPath)) return fail("storage_error");
  const r = await api.remove([...paths]);
  if (r.error) return fail(sanitizeStorageError(r.error));
  return Array.isArray(r.data) && r.data.length > 0 ? { ok: true, value: true as const } : fail("not_found");
}

/**
 * 원본 intake 어댑터(BE-UPLOAD-025). bucket = MEDIA_INTAKE_BUCKET만, 경로 = uploads/<owner>/<asset>/original만.
 * 서명 업로드 URL: upsert 옵션 없이 발급(덮어쓰기 금지), 설정 origin의 https + `/object/upload/sign/<intake>/<path>` + token 쿼리만 신뢰.
 * 서명 업로드 토큰 수명(공식 문서 2시간·철회 불가)은 여기서 바꿀 수 없다.
 */
export function createSupabaseIntakeStorage(client: IntakeClientLike, options: SupabaseMediaStorageOptions): MediaIntakeStorage {
  const origin = httpsOrigin(options.origin);
  const maxDownload = options.maxDownloadBytes ?? UPLOAD_POLICY.maxBytes;
  const bucketOk = (b: string) => b === MEDIA_INTAKE_BUCKET;
  return {
    createSignedUploadUrl: (bucket, path) =>
      guarded(async () => {
        if (!bucketOk(bucket) || !isUploadObjectPath(path)) return fail("storage_error");
        const r = await client.from(bucket).createSignedUploadUrl(path);
        if (r.error) return fail(sanitizeStorageError(r.error));
        const raw = trustedSignedUrl(r.data?.signedUrl, origin);
        if (!raw) return fail("storage_error");
        const u = new URL(raw);
        if (!u.pathname.endsWith(`/object/upload/sign/${MEDIA_INTAKE_BUCKET}/${path}`) || !u.searchParams.get("token")) return fail("storage_error");
        return { ok: true, value: new SignedUrl(raw) };
      }),
    download: (bucket, path) =>
      guarded(async () => (!bucketOk(bucket) || !isUploadObjectPath(path) ? fail("storage_error") : downloadCapped(client.from(bucket), path, maxDownload, true))),
    remove: (bucket, paths) => guarded(async () => (!bucketOk(bucket) ? fail("storage_error") : removeChecked(client.from(bucket), paths))),
  };
}

export function createSupabaseMediaStorage(client: StorageClientLike, options: SupabaseMediaStorageOptions): MediaStorage {
  const origin = httpsOrigin(options.origin);
  const maxDownload = options.maxDownloadBytes ?? APP_MEDIA_POLICY.maxInputBytes;
  const bucketOk = (b: string) => b === MEDIA_BUCKET;

  return {
    upload: (bucket, path, bytes, contentType) =>
      guarded(async () => {
        if (!bucketOk(bucket) || !isVariantObjectPath(path) || contentType !== "image/jpeg") return fail("storage_error");
        if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > VARIANT_MAX_BYTES) return fail("storage_error");
        const r = await client.from(bucket).upload(path, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
        return r.error ? fail(sanitizeStorageError(r.error)) : { ok: true, value: true as const };
      }),
    download: (bucket, path) =>
      guarded(async () => {
        if (!bucketOk(bucket) || !isUploadObjectPath(path)) return fail("storage_error");
        return downloadCapped(client.from(bucket), path, maxDownload);
      }),
    remove: (bucket, paths) => guarded(async () => (!bucketOk(bucket) ? fail("storage_error") : removeChecked(client.from(bucket), paths))),
    createSignedUrl: (bucket, path, ttlSeconds) =>
      guarded(async () => {
        if (!bucketOk(bucket) || !isVariantObjectPath(path)) return fail("storage_error");
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > APP_MEDIA_POLICY.signedUrlMaxTtlSeconds) return fail("storage_error");
        const r = await client.from(bucket).createSignedUrl(path, ttlSeconds);
        if (r.error) return fail(sanitizeStorageError(r.error));
        const url = trustedSignedUrl(r.data?.signedUrl, origin);
        return url ? { ok: true, value: url } : fail("storage_error");
      }),
  };
}
