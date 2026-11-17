/**
 * 미디어 처리 정책 — AUTOPOST-M4-MEDIA-022.
 * 플랫폼 상한(공식 문서, INSTAGRAM-PORT-021에서 대조 — developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media):
 *   JPEG만(MPO/JPS 불가), 파일 ≤ 8MB, 비율 4:5(0.8) ~ 1.91:1, 폭 320 ~ 1440, sRGB.
 * 앱 상한(보수적, 플랫폼보다 좁게 둔 우리 정책):
 *   입력 ≤ 20MB, 입력 픽셀 ≤ 4천만(압축 폭탄 방지), 입력 형식 JPEG·PNG·WEBP 정지 이미지만(애니메이션 거부),
 *   출력 JPEG 품질 88, 출력 ≤ 7MB(플랫폼 8MB보다 여유), 폭은 1440으로 축소·320 미만 거부, 비율은 자동 자르기 없이 범위 밖이면 거부.
 *   sharp 처리 시간 제한 10초. 게시용 서명 URL 기본 TTL 600초(최대 900초 — DB도 60~900만 허용).
 */
export const PLATFORM_LIMITS = Object.freeze({
  instagram: { format: "jpeg", maxBytes: 8 * 1024 * 1024, minAspect: 0.8, maxAspect: 1.91, minWidth: 320, maxWidth: 1440 },
});

export const APP_MEDIA_POLICY = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxInputPixels: 40_000_000,
  inputFormats: ["jpeg", "png", "webp"] as const,
  outputQuality: 88,
  maxOutputBytes: 7 * 1024 * 1024,
  outputMaxWidth: 1440,
  outputMinWidth: 320,
  minAspect: 0.8,
  maxAspect: 1.91,
  sharpTimeoutSeconds: 10,
  signedUrlTtlSeconds: 600,
  signedUrlMaxTtlSeconds: 900,
});

export const MEDIA_BUCKET = "distribution-media";

/**
 * 원본 intake bucket(BE-UPLOAD-025, 130000 계약): private, image/jpeg·png·webp, 20MB. 경로는 DB 생성 uploads/<owner>/<asset>/original.
 * 변형 bucket(MEDIA_BUCKET, jpeg·8MB)과 분리한다.
 */
export const MEDIA_INTAKE_BUCKET = "distribution-media-intake";
export const UPLOAD_POLICY = Object.freeze({
  contentTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  maxBytes: APP_MEDIA_POLICY.maxInputBytes, // 20MB = intake file_size_limit
  /** 앱 grant 기한(완료 요청을 받는 기한). Storage 서명 업로드 토큰 수명과 다르다. */
  grantTtlSeconds: 900,
  /** Supabase 공식 문서: 서명 업로드 URL은 2시간 유효·개별 철회 불가. 앱이 줄일 수 없는 값(참고용, 실측 아님). */
  storageTokenDocumentedTtlSeconds: 7200,
  maxOpenGrants: 5,
});
export type UploadContentType = (typeof UPLOAD_POLICY.contentTypes)[number];

export type InputFormat = (typeof APP_MEDIA_POLICY.inputFormats)[number];
