/**
 * 서버 이미지 처리(Node sharp) — AUTOPOST-M4-MEDIA-022.
 * 참고 출처: Insta_Auto_Posting_Kit_v1.11/insta_auto_poster/src/lib/posts/instagramJpeg.ts(toInstagramJpeg, © BUYLIFE —
 *   web/src/server/distribution/instagram/NOTICE). 원본은 JPEG면 그대로 통과·PNG/WEBP만 rotate+흰 배경+JPEG 92로 바꿨다.
 *   이 파일은 검사·정제 단계를 새로 짰다: JPEG도 항상 다시 인코딩(EXIF·GPS 등 metadata 제거), 바이트 magic·실제 형식 일치,
 *   크기·픽셀·애니메이션·손상 거부, EXIF 방향 적용, sRGB, 폭·비율 정책, sha256.
 * 입력은 **바이트만**(서버가 받은 업로드 또는 통제된 Storage 객체를 읽은 바이트). 외부 URL을 가져오지 않는다(SSRF 없음).
 */
import { createHash } from "node:crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { APP_MEDIA_POLICY, type InputFormat } from "./policy";

export type ProcessFailure =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "FORMAT_MISMATCH"
  | "DECODE_FAILED"
  | "PIXEL_LIMIT"
  | "ANIMATED_IMAGE"
  | "TOO_SMALL"
  | "ASPECT_OUT_OF_RANGE"
  | "OUTPUT_TOO_LARGE"
  | "PROCESSING_TIMEOUT";

export type InspectedOriginal = { format: InputFormat; byteSize: number; width: number; height: number; sha256: string };
export type ProcessedVariant = { bytes: Buffer; byteSize: number; width: number; height: number; sha256: string; mimeType: "image/jpeg" };

export type ProcessResult =
  | { ok: true; original: InspectedOriginal; variant: ProcessedVariant }
  | { ok: false; code: ProcessFailure; original: InspectedOriginal | null };

export const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** 바이트 첫머리(magic)로 형식 판정. 확장자·Content-Type·파일명은 믿지 않는다. */
export function sniffFormat(b: Buffer): InputFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export async function processImageBytes(input: Buffer): Promise<ProcessResult> {
  const P = APP_MEDIA_POLICY;
  if (!Buffer.isBuffer(input) || input.length === 0) return { ok: false, code: "EMPTY_INPUT", original: null };
  if (input.length > P.maxInputBytes) return { ok: false, code: "INPUT_TOO_LARGE", original: null };
  const sniffed = sniffFormat(input);
  if (!sniffed) return { ok: false, code: "UNSUPPORTED_FORMAT", original: null };

  const opts = { limitInputPixels: P.maxInputPixels, failOn: "error" as const, animated: true, sequentialRead: true };
  let meta: Metadata;
  try {
    meta = await sharp(input, opts).metadata();
  } catch (e) {
    return { ok: false, code: /pixel limit/i.test(String((e as Error)?.message)) ? "PIXEL_LIMIT" : "DECODE_FAILED", original: null };
  }
  if (meta.format !== sniffed) return { ok: false, code: "FORMAT_MISMATCH", original: null };
  if (!meta.width || !meta.height) return { ok: false, code: "DECODE_FAILED", original: null };
  const pageHeight = meta.pageHeight ?? meta.height;
  const pages = meta.pages ?? 1;
  const width = meta.width;
  const height = pages > 1 ? pageHeight : meta.height;
  if (width * height > P.maxInputPixels) return { ok: false, code: "PIXEL_LIMIT", original: null };
  const original: InspectedOriginal = { format: sniffed, byteSize: input.length, width, height, sha256: sha256Hex(input) };
  if (pages > 1) return { ok: false, code: "ANIMATED_IMAGE", original };

  // EXIF 방향 5~8은 가로·세로가 바뀐다 → 정책 판정은 방향 적용 후 크기로
  const swap = (meta.orientation ?? 1) >= 5;
  const ow = swap ? height : width;
  const oh = swap ? width : height;
  if (ow < P.outputMinWidth) return { ok: false, code: "TOO_SMALL", original };
  const aspect = ow / oh;
  if (aspect < P.minAspect || aspect > P.maxAspect) return { ok: false, code: "ASPECT_OUT_OF_RANGE", original };

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { ...opts, animated: false })
      .rotate() // EXIF 방향 적용
      .resize({ width: Math.min(ow, P.outputMaxWidth), withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // 투명 → 흰 배경
      .toColourspace("srgb")
      .jpeg({ quality: P.outputQuality, chromaSubsampling: "4:2:0" }) // withMetadata 미호출 → EXIF·ICC·XMP 제거
      .timeout({ seconds: P.sharpTimeoutSeconds })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    return { ok: false, code: /timeout/i.test(String((e as Error)?.message)) ? "PROCESSING_TIMEOUT" : "DECODE_FAILED", original };
  }
  if (out.data.length > P.maxOutputBytes) return { ok: false, code: "OUTPUT_TOO_LARGE", original };
  // 출력 재검사: 실제 JPEG·크기·metadata 없음
  const check = await sharp(out.data).metadata();
  if (check.format !== "jpeg" || !check.width || !check.height || check.exif || check.xmp || check.width < P.outputMinWidth || check.width > P.outputMaxWidth) {
    return { ok: false, code: "DECODE_FAILED", original };
  }
  return {
    ok: true,
    original,
    variant: { bytes: out.data, byteSize: out.data.length, width: check.width, height: check.height, sha256: sha256Hex(out.data), mimeType: "image/jpeg" },
  };
}
