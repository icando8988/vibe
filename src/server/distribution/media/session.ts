/**
 * 미디어 런타임 연결(server-only) — BE-MEDIA-024.
 * 검증 세션 actor(requireDistributionActor) + service_role RPC + Supabase Storage 어댑터를 묶는다.
 * env는 기존 client factory(lib/supabase/admin.ts)와 parseServiceConfig로만 읽고, 값은 로그·응답에 싣지 않는다.
 * 네트워크 호출 없음(준비도 판정은 설정 유무만 — bucket 존재·정책은 확인하지 않는다).
 * 매 요청 새로 부른다(모듈 전역 캐시 없음).
 */
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { requireDistributionActor } from "../actor";
import { parseServiceConfig } from "../service-config";
import type { RpcClient } from "../write-runner";
import type { MediaDeps } from "./service";
import type { MediaIntakeStorage, MediaStorage } from "./storage";
import { createSupabaseIntakeStorage, createSupabaseMediaStorage, type IntakeClientLike, type StorageClientLike } from "./storage-supabase";
import type { UploadDeps } from "./upload";

type Runtime = { client: RpcClient | null; storage: MediaStorage | null; intake?: MediaIntakeStorage | null };

function buildRuntime(): Runtime {
  const sb = createSupabaseServiceClient();
  if (!sb) return { client: null, storage: null, intake: null };
  const client: RpcClient = { rpc: (fn, params) => sb.rpc(fn, params) as unknown as PromiseLike<{ data: unknown; error: unknown }> };
  const origin = parseServiceConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)?.url;
  let storage: MediaStorage | null = null;
  let intake: MediaIntakeStorage | null = null;
  if (origin) {
    try {
      storage = createSupabaseMediaStorage(sb.storage as unknown as StorageClientLike, { origin });
      intake = createSupabaseIntakeStorage(sb.storage as unknown as IntakeClientLike, { origin });
    } catch {
      storage = null;
      intake = null;
    }
  }
  return { client, storage, intake };
}

/** 직접 업로드(grant·complete·cancel) 라우트용. BE-UPLOAD-025. */
export function getMediaUploadDeps(): UploadDeps {
  const rt = buildRuntime();
  return { resolveActor: requireDistributionActor, getClient: () => rt.client, storage: rt.storage, intake: rt.intake ?? null };
}

/** 목록·권리 결정·보관용(Storage 불필요). */
export function getMediaMetadataDeps(): Omit<MediaDeps, "storage"> {
  const rt = buildRuntime();
  return { resolveActor: requireDistributionActor, getClient: () => rt.client };
}

/** 업로드·처리용(Storage 필요). issuePublishUrl은 게시 실행기 전용 — 화면에서 호출하지 않는다. */
export function getMediaDeps(): MediaDeps {
  const rt = buildRuntime();
  return { resolveActor: requireDistributionActor, getClient: () => rt.client, storage: rt.storage };
}

export type MediaReadiness = {
  /** 목록·상세·권리 결정·보관 가능 */
  metadata: boolean;
  /** 바이트를 서버가 직접 받는 업로드 경로(metadata + Storage 어댑터). Server Action 본문 한도(기본 1MB) 때문에 화면 업로드에는 쓰지 않는다. */
  upload: boolean;
  /** 직접 업로드(intake 서명 업로드 → 완료 요청) 가능 — 설정·의존성 준비도일 뿐 bucket 실존·정책 검증 아님. 화면 업로드 UI는 이 값으로만 켠다. */
  directUpload: boolean;
  /** 미리보기(서명 URL)는 화면에 제공하지 않는다 */
  preview: false;
  /** bucket 존재·정책은 확인하지 않는다(네트워크 호출 없음) */
  storageVerified: false;
  /** 빠진 구성 이름만(값 없음) */
  missing: Array<"service_client" | "storage_adapter" | "intake_bucket">;
};

export function mediaReadinessOf(rt: Runtime): MediaReadiness {
  const missing: MediaReadiness["missing"] = [];
  const intake = rt.intake ?? null;
  if (!rt.client) missing.push("service_client");
  if (!rt.storage) missing.push("storage_adapter");
  if (!intake) missing.push("intake_bucket");
  const upload = rt.client !== null && rt.storage !== null;
  return { metadata: rt.client !== null, upload, directUpload: upload && intake !== null, preview: false, storageVerified: false, missing };
}

export function mediaReadiness(): MediaReadiness {
  return mediaReadinessOf(buildRuntime());
}
