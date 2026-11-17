/**
 * 미디어 Storage 계약(의존성 주입) — AUTOPOST-M4-MEDIA-022.
 * 실제 Supabase Storage 연결은 등록하지 않는다(실프로젝트 bucket 생성·업로드 없음). 시험은 mock만.
 * bucket 계약: `distribution-media`, public=false, file_size_limit 8MB, allowed_mime_types ['image/jpeg'],
 *   storage.objects 정책 없음(anon/authenticated 접근 0) — service_role 서버만 업로드·다운로드·서명.
 * 객체 경로는 DB 생성 열 값만 쓴다(사용자 파일명·경로 불신). 서명 URL은 SignedUrl로만 다루고 로그·목록·감사 기록에 넣지 않는다.
 */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class SignedUrl {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** 공급자 호출 직전(서버 내부)에서만. */
  reveal(): string {
    return this.#value;
  }
  toString() {
    return "[signed-url]";
  }
  toJSON() {
    return "[signed-url]";
  }
  [INSPECT]() {
    return "SignedUrl([redacted])";
  }
}

/**
 * 실패 코드(정제됨 — 공급자 메시지·경로·URL 없음).
 *   storage_unavailable: 응답 유실·5xx·네트워크 → 결과 불명(업로드는 객체가 생겼을 수 있음 — 재시도 없음)
 *   already_exists: 같은 경로에 객체가 이미 있음(덮어쓰기 금지, BE-MEDIA-024)
 */
export type StorageFailCode = "storage_error" | "storage_unavailable" | "not_found" | "already_exists";
export type StorageResult<T> = { ok: true; value: T } | { ok: false; code: StorageFailCode };

export interface MediaStorage {
  upload(bucket: string, path: string, bytes: Buffer, contentType: "image/jpeg"): Promise<StorageResult<true>>;
  /** 통제된 업로드 객체(uploads/<owner>/<asset>/original)만 읽는다. */
  download(bucket: string, path: string): Promise<StorageResult<Buffer>>;
  remove(bucket: string, paths: string[]): Promise<StorageResult<true>>;
  createSignedUrl(bucket: string, path: string, ttlSeconds: number): Promise<StorageResult<string>>;
}

/**
 * 원본 intake bucket 계약(BE-UPLOAD-025). MediaStorage와 분리(기존 구현·mock 후방호환).
 * createSignedUploadUrl은 upsert 없이(덮어쓰기 금지) DB 생성 업로드 경로에만 발급한다. URL은 grant 응답 외에 쓰지 않는다.
 */
export interface MediaIntakeStorage {
  createSignedUploadUrl(bucket: string, path: string): Promise<StorageResult<SignedUrl>>;
  download(bucket: string, path: string): Promise<StorageResult<Buffer>>;
  remove(bucket: string, paths: string[]): Promise<StorageResult<true>>;
}

const UPLOAD_PATH_RE = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original$/;
const VARIANT_PATH_RE = /^variants\/[0-9a-f-]{36}\/feed_jpeg\.jpg$/;

export const isUploadObjectPath = (p: unknown): p is string => typeof p === "string" && UPLOAD_PATH_RE.test(p);
export const isVariantObjectPath = (p: unknown): p is string => typeof p === "string" && VARIANT_PATH_RE.test(p);
