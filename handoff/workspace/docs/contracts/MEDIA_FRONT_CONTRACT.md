# 미디어(M4) — Front 연결 계약

작성: 2026-11-17 / BE-BASE-023 / Claude(Backend) CC-BACKEND-01 / 상태 `ready_review`
기준 파일: `web/supabase/migrations/20261116120000_distribution_media_assets.sql`, `web/src/server/distribution/media/{service,process,policy,storage}.ts`, `web/src/server/distribution/errors.ts`.
검증 근거: 로컬 PGlite만(000000~120000 전체 적용). 실제 Supabase·Storage 미적용, 운영 연결 증거 아님.

## 0. 한 줄 요약
서버 함수·RPC·런타임 배선(`media/session.ts`)·Storage 어댑터가 있다(BE-MEDIA-024, mock 검증). 운영에는 migration·키·bucket이 없어 실제로는 `not_ready` 또는 DB 오류가 난다. 업로드 동선은 §9 결정 전까지 비활성.

## 0-A. BE-MEDIA-024 런타임 진입점
상태: **확정(2026-11-17, BE-MEDIA-024)** — 파일 구현·mock 시험 완료. 잠정안과 이름·형식 동일. 실제 Supabase·Storage 연결 검증은 아님.
- 준비도 의미(Master 고정): `metadata`/`upload`는 **설정·의존성 준비도**이지 DB/Storage 검증 성공이 아니다. `metadata=true`여도 `listAssets` 결과(ok/denied/db_error)를 따로 판정한다. `upload=true`여도 `storageVerified`는 false다.
- 업로드 UI는 §9(업로드 동선) 결정 전까지 비활성 유지.
- 추가 export: `mediaReadinessOf(rt)`(시험용 순수 판정), `errors.ts`의 `MEDIA_ERROR_REASONS`(허용 사유 목록).

파일 `src/server/distribution/media/session.ts` (`import "server-only"` — server component·server action에서만):
```ts
export function getMediaMetadataDeps(): Omit<MediaDeps, "storage">; // listAssets · decideRights · archiveAsset 용
export function getMediaDeps(): MediaDeps;                          // createAndProcessFromBytes 용(업로드). issuePublishUrl은 실행기 전용
export function mediaReadiness(): MediaReadiness;                   // 동기, 네트워크 호출 없음

export type MediaReadiness = {
  metadata: boolean;   // 목록·상세·권리 결정·보관 가능(service RPC client 있음)
  upload: boolean;     // 업로드·처리 가능(metadata + Storage adapter 있음)
  preview: false;      // 미리보기(서명 URL)는 Front에 제공하지 않음 — 항상 false
  storageVerified: false; // bucket 존재·정책은 확인하지 않음(네트워크 호출 없음). 첫 업로드에서 STORAGE_UPLOAD_FAILED로 드러날 수 있음
  missing: Array<"service_client" | "storage_adapter">; // 이름만, 값 없음
};
```
사용 규칙:
- 목록·권리·보관 버튼은 `metadata`만 보고 켠다. `upload=false`라는 이유로 막지 않는다.
- 업로드 폼은 `upload`로 켠다. 미리보기 UI는 만들지 않는다(`preview`는 항상 false).
- 매 요청 `getMedia*Deps()`를 새로 부른다(모듈 전역 캐시 금지 — env 변경·요청별 세션).
- Front는 deps를 직접 조립하지 않는다.

오류 분기(파일 `src/server/distribution/errors.ts`, 추가):
```ts
export type MediaErrorReason = "pending_limit" | "asset_referenced" | "media_not_ready" | "variant_mismatch"
  | "rights_not_approved" | "rights_expired" | "channel_not_allowed";
export function mediaErrorReason(error: MappedDbError): MediaErrorReason | null; // 허용 목록 token + SQLSTATE 23514일 때만, 그 외 null
```
- `MappedDbError.code`는 바뀌지 않는다(M4 토큰은 계속 `invalid_input` = 확정 거절). 그래서 공용 `write-notice`(`invalid_input → "invalid"`)도 그대로 맞다. 새 code를 추가하지 않는 이유: 공용 notice 매핑에서 모르는 code는 `uncertain`(결과 불명)으로 바뀌어 확정 거절을 불명으로 잘못 안내하게 된다.
- Front 세부 안내는 `mediaErrorReason(e) ?? <code 기반 일반 안내>` 순서로.
- `unavailable`(응답 유실)·`bad_response`·업로드 `uncertain`은 확정 거절이 아니다 → "결과 확인 필요", 자동 재시도 금지.

## 1. 호출 경계
- Front(페이지·server action)는 `src/server/distribution/media/service.ts`의 함수만 부른다. RPC 직접 호출·Supabase client 직접 사용 금지.
- 모든 함수는 의존성 주입형: `deps = { resolveActor, getClient, storage }`.
  - `resolveActor()` — 검증된 세션 actor(D1 승인 admin). 클라이언트가 보낸 actor/role은 쓰지 않는다.
  - `getClient()` — service_role RPC client. 없으면 `null` → `not_ready`.
  - `storage` — `MediaStorage` 구현. **실 Supabase Storage adapter는 없다**(mock만 존재). 업로드·처리·서명 URL 함수는 storage가 `null`이면 `not_ready`.
- **배선**: BE-MEDIA-024에서 `media/session.ts`(server-only)와 `media/storage-supabase.ts`(Supabase Storage 어댑터)를 추가했다(§0-A). Front는 `deps`를 직접 조립하지 않는다.
- Storage 어댑터 통제: bucket `distribution-media`만, upload·서명 = `variants/<asset>/feed_jpeg.jpg`, download·remove = `uploads/<owner>/<asset>/original`(형식이 다르면 SDK 호출 0), upload는 `upsert:false`(같은 경로 존재 → `already_exists`, 덮어쓰기 없음)·image/jpeg·≤8MB, download는 ≤20MB, 서명 URL은 설정된 Supabase origin의 https만, TTL 60~900. 오류는 `storage_error · storage_unavailable(결과 불명) · not_found · already_exists`로만 정제(메시지·경로·URL 없음). 재시도 없음.

## 2. DTO
```ts
type MediaVariantDto = { id: string; kind: "feed_jpeg"; byteSize: number; width: number; height: number; sha256: string };
type MediaAssetDto = {
  id: string;
  status: "pending_upload" | "processing" | "ready" | "failed";
  source: string;               // own_creation | licensed | public_domain | other
  sourceNote: string | null;    // ≤500자
  originalFormat: string | null; originalByteSize: number | null; originalWidth: number | null; originalHeight: number | null;
  failureCode: string | null;   // status=failed일 때만
  rightsState: "unreviewed" | "approved" | "rejected" | "revoked";
  allowedChannels: string[] | null;   // rightsState=approved일 때만
  rightsValidUntil: string | null;    // ISO, null=무기한
  archivedAt: string | null;
  rowVersion: number;           // 모든 쓰기의 expectedVersion
  variant: MediaVariantDto | null;
};
type PinnedMediaRef = { assetId: string; variantId: string; sha256: string; width: number; height: number; byteSize: number };
```
- DTO에는 Storage 경로·서명 URL·토큰이 없다(`toMediaAssetDto`가 `object_path`·`signed_url`·`url`·`token` 키가 있으면 응답 전체를 거부 → `bad_response`).
- 원본 바이트는 저장하지 않는다. 화면에 원본 미리보기는 불가(변형 미리보기도 서명 URL이 필요하므로 현재 불가).

## 3. 함수와 입출력
| 함수 | 입력 | 성공 | 비고 |
|---|---|---|---|
| `listAssets(deps)` | — | `{status:"ok", assets: MediaAssetDto[]}` | 소유 actor 것만, 최신순 최대 100, 페이지 없음. `ok([])`만 0건 |
| `createAndProcessFromBytes(deps, {source, sourceNote?, bytes: Buffer})` | 서버가 받은 업로드 바이트 | `{status:"ready", asset}` | 생성→검사·변환(sharp)→수신 기록→변형 업로드→완료를 한 번에. 입력 ≤20MB |
| `processControlledUpload(deps, {asset, uploadObjectPath})` | DB가 준 `uploads/<actor>/<asset>/original` | 위와 같음 | 직접 업로드 흐름용. 현재 화면에서 쓸 일 없음 |
| `decideRights(deps, {assetId, expectedVersion, decision, allowedChannels?, validUntil?, note?})` | decision = approved/rejected/revoked | `{status:"ok", asset}` | approved는 ready 자산만, channels 1~3개 필수. rejected는 approved 상태에서 불가(revoked 사용). note ≤1000 |
| `archiveAsset(deps, {assetId, expectedVersion})` | — | `{status:"ok", asset}` | 리비전이 참조 중이면 거부. 행 삭제 없음, 보관은 되돌릴 수 없음 |
| `issuePublishUrl(deps, {pinned, channel, ttlSeconds?})` | 실행기 전용 | `{status:"ok", ref, channel, expiresAt, url: SignedUrl}` | **Front에서 호출하지 않는다.** 게시 실행기 전용. TTL 기본 600·최대 900초 |

업로드 처리 결과(`IngestResult`) 추가 상태:
- `{status:"failed", asset|null, code}` — `code`: `EMPTY_INPUT · INPUT_TOO_LARGE · UNSUPPORTED_FORMAT · FORMAT_MISMATCH · DECODE_FAILED · PIXEL_LIMIT · ANIMATED_IMAGE · TOO_SMALL · ASPECT_OUT_OF_RANGE · OUTPUT_TOO_LARGE · PROCESSING_TIMEOUT · STORAGE_UPLOAD_FAILED · STORAGE_READ_FAILED`. 자산은 보통 `failed`로 남는다(재처리 없음 → 새로 올림).
- `{status:"uncertain", assetId, stage:"complete"}` — 변형은 올렸지만 DB 완료를 확인 못함. **성공으로 표시하지 않는다.** 자동 재시도 금지, 목록 새로고침으로 실제 상태를 확인하게 안내.

## 4. 실패 공통(`MediaFail`)과 화면 처리
| status | 뜻 | 화면 |
|---|---|---|
| `denied` | 세션 없음·D1 아님(42501) | 권한 안내, 데이터 숨김 |
| `not_ready` | client 또는 storage 없음(배선·env·Storage 미설정) | "미디어 저장 준비 전" — 업로드·결정 버튼 비활성. 현재 운영에서는 항상 이 상태 |
| `invalid` + `field` | 서버 입력 검사 실패(RPC 호출 전) | 해당 필드 오류, 입력 유지 |
| `db_error` + `error: MappedDbError` | DB 거절 | 아래 표 |
| `bad_response` | 응답 형식 이상 | 일반 오류, 재시도 버튼 없음 |

`MappedDbError = { code, token, sqlstate }`. BE-MEDIA-024부터 M4 토큰은 TOKEN_MAP에 **명시적으로 `invalid_input`**(확정 거절)으로 매핑되고, 세부 사유는 `mediaErrorReason(error)`로 얻는다(§0-A). Front는 `error.token` 원문을 직접 비교하지 말고 `mediaErrorReason`을 쓴다. 표(사유 ↔ token):

| token | code(현재 매핑) | 발생 | 안내 |
|---|---|---|---|
| `VERSION_CONFLICT` | conflict_version | 낡은 rowVersion | 최신 상태 다시 불러오기, 입력 유지 |
| `ARCHIVED` | archived | 보관된 자산 | 보관됨 표시, 조치 없음 |
| `INVALID_TRANSITION` | invalid_transition | 상태상 불가(예: ready 아닌 자산 권리 승인, approved에 rejected) | 가능한 조치만 노출 |
| `MEDIA_PENDING_LIMIT` | invalid_input | 대기·처리 중 자산 20개 이상 | 기존 대기 자산 정리 안내 |
| `ASSET_REFERENCED` | invalid_input | 리비전이 쓰는 자산 보관 | "사용 중이라 보관 불가" |
| `MEDIA_NOT_READY` | invalid_input | ready가 아니거나 보관된 자산을 리비전에 붙임 | 리비전 저장 화면에서 "준비 완료 자산만 첨부 가능" |
| `VARIANT_MISMATCH` | invalid_input | 다른 자산의 변형 지정 | 일반 입력 오류 |
| `RIGHTS_NOT_APPROVED` · `RIGHTS_EXPIRED` · `CHANNEL_NOT_ALLOWED` | invalid_input | 서명 승인 단계(실행기) | Front 직접 노출 없음 |
| (토큰 없음) P0002 | not_found | 없는/타인 자산 | 찾을 수 없음 |

`mediaErrorReason` 값: MEDIA_PENDING_LIMIT→`pending_limit`, ASSET_REFERENCED→`asset_referenced`, MEDIA_NOT_READY→`media_not_ready`, VARIANT_MISMATCH→`variant_mismatch`, RIGHTS_NOT_APPROVED→`rights_not_approved`, RIGHTS_EXPIRED→`rights_expired`, CHANNEL_NOT_ALLOWED→`channel_not_allowed`. 허용 목록 token + SQLSTATE 23514일 때만 값이 있고, 그 외는 null.

## 5. 리비전 미디어와의 관계(Front가 알아야 할 제약)
- 120000부터 `distribution_draft_revision_media`에 넣는 자산은 **존재·미보관·ready**여야 한다(트리거 `MEDIA_NOT_READY`, FK). `variant_id`를 주면 같은 자산 소속이어야 한다.
- 권리 승인 여부는 리비전 저장 때 검사하지 않는다. 게시 시점(`distribution_authorize_media_signing`)에서만 검사한다 → 화면은 "권리 미승인 자산은 게시 때 막힘"을 첨부 화면에 표시해야 한다.
- 원문 버전의 `media_asset_ids`(content_versions)에는 이 검사가 **없다**(아래 §8 관찰 1).
- 이미 리비전에 붙은 자산은 보관할 수 없다(`ASSET_REFERENCED`).

## 6. 정책 수치(`policy.ts`)
입력 JPEG·PNG·WEBP 정지 이미지, ≤20MB, ≤4천만 픽셀. 출력 sRGB JPEG 품질 88, ≤7MB, 폭 320~1440(1440 초과는 축소, 320 미만 거부), 비율 0.8~1.91(자동 자르기 없음 → 범위 밖 거부). EXIF 방향 적용, metadata 제거. Front 입력 안내 문구는 이 값을 그대로 쓴다.

## 7. 배포·출처 제약
- `process.ts`는 키트(`Insta_Auto_Posting_Kit_v1.11 … instagramJpeg.ts`, © BUYLIFE, `instagram/NOTICE`) **참고 파생**이다. 공개 release 범위 판단 전까지 Instagram 모듈과 같은 제외 대상으로 묶는 것을 권장한다(최종 판단 Master). `service.ts`는 `process.ts`를 import하므로 함께 묶인다.
- `sharp`(0.35.5)는 네이티브 모듈이다. Vercel 등 배포 환경 빌드 확인 필요(package/lock은 Master 조정).
- Storage bucket `distribution-media`(private, 8MB, image/jpeg)는 migration 주석의 계약일 뿐 생성 SQL은 실행되지 않는다. 운영 생성은 별도 승인 작업.

## 8. 관찰(결함 후보, 수정하지 않음 — 재현·제안)
1. **원문 버전 media_asset_ids 무검증**: `distribution_create_content`/`append_content_version`의 `p_media_asset_ids`는 120000 이후에도 임의 uuid를 받는다. 근거: `content_versions.media_asset_ids`는 `uuid[]` 열(030000)이라 FK를 걸 수 없고, 050000의 입력 검사는 1차원·null 없음·≤50개만 보며, 120000은 이 열에 트리거를 추가하지 않았다(정적 확인 — 실행 재현은 하지 않음). 리비전과 달리 존재·ready 검사가 없다. 원문 미디어를 실제로 쓸지 정한 뒤 검사 추가 여부를 Master가 결정.
2. **변형 업로드 후 DB 완료 실패 → 고아 객체**: service.ts 주석대로 정리 작업 없음.
3. ~~M4 토큰 미매핑~~ → BE-MEDIA-024에서 해결(§0-A·§4).
4. **목록 페이지 없음**: 최대 100건 고정, 커서 없음.
5. **원본 읽기 실패 시 원본 유지**: `processControlledUpload`는 download 실패면 처리·삭제 없이 `STORAGE_READ_FAILED`를 돌려준다(원본 객체는 남음 — 재처리·정리 판단은 운영). 처리 후 원본 삭제 실패는 결과를 바꾸지 않는다(원본 고아 가능).

## 9. 업로드 실제 동선 — 검토와 제안(결정 전, 공유 설정·정책 변경 없음)
공식 문서(2026-11-17 조회):
- Vercel Functions: "The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB." 초과 시 413 `FUNCTION_PAYLOAD_TOO_LARGE`. (https://vercel.com/docs/functions/limitations)
- Next.js Server Actions: "By default, the maximum size of the request body sent to a Server Action is 1MB", `experimental.serverActions.bodySizeLimit`로 조정. multipart 오버헤드 포함. (https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)
- Supabase standard upload: 6MB 이하 권장, 같은 경로는 기본 "400 Asset Already Exists"(덮어쓰기는 upsert 명시). (https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- Signed upload URL: 추가 인증 없이 업로드, "valid for 2 hours", upsert는 `createSignedUploadUrl()`에서만 설정. 개별 철회 불가(서명 키 교체 필요). (https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl, …/storage-from-uploadtosignedurl)
- Bucket 제한(allowedMimeTypes·fileSizeLimit)은 bucket 단위, 불충족 업로드는 거절. (https://supabase.com/docs/guides/storage/buckets/creating-buckets)

충돌점:
1. **Server Action 경유(`createAndProcessFromBytes`)**: 기본 1MB(설정 상향해도 Vercel 4.5MB) ↔ 앱 정책 입력 ≤20MB. 실사진 대부분이 1MB를 넘어 기본 설정으론 사실상 불가.
2. **통제 직접 업로드(`processControlledUpload`)**: 원본을 `uploads/…/original`에 올려야 하는데 120000 계약 bucket은 `allowed_mime_types ['image/jpeg']`·8MB → PNG·WEBP 원본과 8MB 초과 JPEG 원본이 bucket에서 거절된다. 또 서명 업로드 URL 발급 함수가 `MediaStorage`·service에 없다.

제안(Master 결정 필요, 이번에 구현·설정 변경 없음):
- **권장 A — 원본 전용 private intake bucket 분리**: `distribution-media-intake`(private, jpeg/png/webp, 20MB) + 서버가 발급하는 서명 업로드 URL(upsert:false, 경로 = DB 생성 `uploads/<owner>/<asset>/original`) → 브라우저가 직접 업로드 → server action은 asset id만 보내 `processControlledUpload`(intake에서 읽기 → 변형을 `distribution-media`에 저장 → 원본 삭제). 함수 크기 제한과 무관, 변형 bucket의 JPEG 전용 보장 유지. 필요 작업: bucket 계약 SQL 주석·운영 생성, `MediaStorage`에 intake bucket·`createSignedUploadUrl` 추가, 서명 업로드 발급 server 함수(2시간 유효·철회 불가 → 대기 20개 상한과 만료 정리 필요).
- B — 단일 bucket 허용 형식·크기 확대: 간단하지만 변형 bucket의 "JPEG만" 보장이 서버 코드에만 의존.
- C — Server Action 경유 유지 + `bodySizeLimit` 상향(≤4MB): 공유 `next.config` 변경 필요(Master 조정), 입력 정책을 4MB로 낮춰야 하며 큰 사진은 거절.
