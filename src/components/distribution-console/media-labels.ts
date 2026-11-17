/**
 * 미디어 화면 라벨·판정 — 순수 함수(시험 대상). FE-MEDIA-024 / CC-FRONT-01.
 * 기준 계약: docs/contracts/MEDIA_FRONT_CONTRACT.md(BE-BASE-023). DTO·결과 타입은 서버 모듈에서 type만 가져온다(런타임 import 없음).
 * 원칙: 처리 상태(업로드·변환)와 권리 상태(사용권 검토)는 서로 다른 축이다 — ready여도 권리 미승인이면 게시에 못 쓴다.
 */
import type { MediaAssetDto } from "@/server/distribution/media/service";

export const MEDIA_STATUS_LABEL: Record<MediaAssetDto["status"], string> = {
  pending_upload: "업로드 대기",
  processing: "처리 중",
  ready: "처리 완료",
  failed: "처리 실패",
};

export const RIGHTS_LABEL: Record<MediaAssetDto["rightsState"], string> = {
  unreviewed: "권리 미검토",
  approved: "권리 승인",
  rejected: "권리 반려",
  revoked: "권리 철회",
};

export const SOURCE_LABEL: Record<string, string> = {
  own_creation: "직접 제작",
  licensed: "사용 허락 받음",
  public_domain: "공공 영역",
  other: "기타",
};

export const MEDIA_CHANNELS = ["blog", "threads", "instagram"] as const;
export const CHANNEL_LABEL: Record<string, string> = { blog: "Blog", threads: "Threads", instagram: "Instagram" };

/** 처리 실패 코드 → 사람이 읽는 이유(계약 §3 코드 목록, 정책 수치는 §6). 모르는 코드는 원문 코드만. */
export const FAILURE_TEXT: Record<string, string> = {
  EMPTY_INPUT: "빈 파일입니다.",
  INPUT_TOO_LARGE: "원본이 20MB를 넘습니다.",
  UNSUPPORTED_FORMAT: "JPEG·PNG·WEBP 정지 이미지만 받습니다.",
  FORMAT_MISMATCH: "파일 내용과 형식이 맞지 않습니다.",
  DECODE_FAILED: "이미지를 읽지 못했습니다(손상 가능).",
  PIXEL_LIMIT: "픽셀 수가 4천만을 넘습니다.",
  ANIMATED_IMAGE: "움직이는 이미지는 받지 않습니다.",
  TOO_SMALL: "폭이 320px보다 작습니다.",
  ASPECT_OUT_OF_RANGE: "가로세로 비율이 0.8~1.91 범위 밖입니다(자동 자르기 없음).",
  OUTPUT_TOO_LARGE: "변환 결과가 7MB를 넘습니다.",
  PROCESSING_TIMEOUT: "처리 시간이 초과됐습니다.",
  STORAGE_UPLOAD_FAILED: "변환본을 저장소에 올리지 못했습니다.",
  STORAGE_READ_FAILED: "업로드 원본을 읽지 못했습니다.",
  // 서버 고착 복구(140000, BE-UPLOAD-RECOVERY-030): 처리 중·업로드 대기로 멈춘 자산을 failed로 닫음. 삭제·재시도·권리와 무관.
  UPLOAD_STALLED: "처리가 제시간에 끝나지 않아 서버가 이 업로드를 닫았습니다.",
};

export function failureText(code: string | null): string | null {
  if (!code) return null;
  return FAILURE_TEXT[code] ?? "알 수 없는 이유로 처리하지 못했습니다."; // 모르는 코드는 원문을 보여 주지 않는다(M025-03)
}

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

export function formatKst(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(t))} KST`;
}

export function formatPixels(w: number | null, h: number | null): string {
  return w && h ? `${w}×${h}px` : "—";
}

export type RightsDecision = "approved" | "rejected" | "revoked";

/**
 * 지금 기록할 수 있는 권리 결정(계약 §3: approved는 ready만, approved 상태에서는 revoked만, rejected는 approved가 아닐 때).
 * 보관된 자산은 없음. 서버가 최종 판단(INVALID_TRANSITION)한다.
 */
export function rightsDecisionOptions(a: Pick<MediaAssetDto, "status" | "rightsState" | "archivedAt">): RightsDecision[] {
  if (a.archivedAt) return [];
  if (a.rightsState === "approved") return ["revoked"];
  const out: RightsDecision[] = [];
  if (a.status === "ready") out.push("approved");
  out.push("rejected");
  return out;
}

/** 권리 승인이 아직 유효한가(표시용 — 게시 시점 최종 판단은 서버). */
export function rightsUsableNow(a: Pick<MediaAssetDto, "rightsState" | "rightsValidUntil">, now = Date.now()): boolean {
  if (a.rightsState !== "approved") return false;
  return a.rightsValidUntil === null || Date.parse(a.rightsValidUntil) > now;
}


/** 요청 시각(서버 페이지가 한 번 구해 컴포넌트에 넘긴다 — 컴포넌트 렌더 안에서 시계를 읽지 않음). */
export function requestNow(): number {
  return Date.now();
}

/** 서버 mediaErrorReason() 값 → 폼 안내(액션이 fields에 `reason:<값>`으로 싣는다). */
export const MEDIA_REASON_FIELD_LABELS: Record<string, string> = {
  "reason:pending_limit": "업로드 대기·처리 중 자산이 너무 많음(기존 대기 자산 정리 필요)",
  "reason:asset_referenced": "채널 초안이 쓰는 자산이라 보관할 수 없음",
  "reason:media_not_ready": "처리 완료된 자산만 가능",
  "reason:variant_mismatch": "변환본이 이 자산 것이 아님",
  "reason:rights_not_approved": "권리 미승인",
  "reason:rights_expired": "권리 유효기한 지남",
  "reason:channel_not_allowed": "권리 허용 채널이 아님",
};

/**
 * 미디어 페이지 쿼리 notice 제한(R031-01). 미디어 action의 정상 redirect는 `saved`뿐이라 그것만 받는다.
 * 그 밖의 코드(직접 입력·공유된 주소)는 무시해 공용 원문·초안·체크리스트 안내로 흘리지 않는다.
 * 쿼리 값은 주소 표시일 뿐 저장의 독립 증거가 아니다 — 실제 상태는 다시 불러온 서버 조회 결과로 본다.
 */
export function mediaPageNotice(v: unknown): "saved" | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "saved" ? "saved" : null;
}
