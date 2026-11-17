# 미디어 직접 업로드(private intake) 계약

작성: 2026-11-17 / BE-UPLOAD-025 → **BE-UPLOAD-RESUME-026** / Claude(Backend) CC-BACKEND-01
상태: **로컬 기준 확정(코드·mock·PGlite 왕복과 일치). 실제 Supabase Storage 전송·bucket·CORS·토큰 수명은 미검증.** Master 인수 전 업로드 UI 활성화 보류.
채택: MEDIA_FRONT_CONTRACT §9 권장 A. 실제 bucket 생성·Storage 실호출·실DB 적용은 범위 밖이다.
구현: `src/server/distribution/media/upload.ts`(흐름) · `upload-http.ts`(HTTP 조립) · `storage-supabase.ts`(intake 어댑터) · `session.ts`(준비도) · `src/app/api/distribution/media/upload/{grant,complete,cancel}/route.ts` · migration `20261116130000`.

## 1. 흐름
```
브라우저 ──(1) POST /api/distribution/media/upload/grant  {메타데이터만, 바이트 없음}──▶ 서버
   서버: 세션 actor·D1 → 입력 검사 → DB에 자산(pending_upload)+grant(nonce sha256·앱 기한) 원자 기록 → intake 서명 업로드 URL 발급(upsert 없음)
브라우저 ◀── {status:"issued", grant:{grantId, assetId, rowVersion, nonce, grantExpiresAt, upload:{url, method:"PUT", headers, storageTokenDocumentedTtlSeconds}}}
브라우저 ──(2) PUT upload.url  (원본 바이트, Supabase Storage로 직접 — Next 본문 한도 무관)
브라우저 ──(3) POST /api/distribution/media/upload/complete {grantId, nonce, expectedVersion}──▶ 서버
   서버: grant 조회(변경 없음: actor·nonce·만료·상태) → rowVersion 대조 → intake 원본 다운로드(≤20MB)
         → 없으면 not_uploaded(grant 그대로) / 읽기 오류면 storage_error(grant 그대로)
         → grant 1회 소비(원자) → 신고 형식·크기 대조 → M4 검사·sharp 변환 → 변형 저장 → ready/failed → intake 원본 삭제
(취소) POST /api/distribution/media/upload/cancel {grantId, nonce}
```
상태 구분: **업로드됨(PUT 2xx) ≠ ready ≠ 권리 approved.** ready는 (3) 서버 검사 통과, 게시는 별도 권리 승인 필요.

## 2. bucket 계약(운영 생성은 별도 승인 작업 — 130000에는 실행되지 않는 주석으로만 있음)
| bucket | 용도 | public | 허용 형식 | 크기 상한 | 경로 |
|---|---|---|---|---|---|
| `distribution-media-intake` | 원본 임시 보관 | false | image/jpeg, image/png, image/webp | 20MB(20971520) | `uploads/<owner_id>/<asset_id>/original` (DB 생성 열) |
| `distribution-media` | 서버 변형 | false | image/jpeg | 8MB(8388608) | `variants/<asset_id>/feed_jpeg.jpg` |
- 두 bucket 모두 storage.objects 정책 없음(anon/authenticated 직접 접근 0). intake 쓰기는 서버 발급 서명 업로드 URL로만, 읽기·삭제·변형 쓰기는 service_role 서버만.
- 경로·파일명은 클라이언트가 정하지 않는다(DB 생성 열만). 브라우저 파일명은 서버에 보내지 않는다.

## 3. Endpoint (모두 POST)
공통 요청 조건: `Content-Type: application/json`, `Origin` 헤더 필수이며 요청 URL origin과 같아야 함, 본문 4096바이트 이하, JSON 객체.
위반이면 **`400 {"status":"invalid_request"}`** (도메인 `invalid`와 구분). 세션 쿠키 인증(D1 승인 admin) — 아니면 `401 denied`.
모든 응답: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, 본문은 아래 status와 명시 필드만.
라우트 내부 예외는 세 endpoint 모두 `503 {"status":"uncertain"}`.

### 3.1 `/api/distribution/media/upload/grant`
요청: `{ "source": "own_creation"|"licensed"|"public_domain"|"other", "sourceNote"?: string|null (≤500자, 제어문자 불가, 공백만이면 null), "contentType": "image/jpeg"|"image/png"|"image/webp", "byteSize": 정수 1..20971520 }`
성공 `200`:
```json
{ "status": "issued",
  "grant": { "grantId": "<uuid>", "assetId": "<uuid>", "rowVersion": 1, "nonce": "<43자 base64url>",
             "grantExpiresAt": "<ISO — 완료·취소 요청을 받는 앱 기한(기본 900초)>",
             "upload": { "url": "<서명 업로드 URL — 비밀>", "method": "PUT",
                         "headers": { "content-type": "<요청한 contentType>", "x-upsert": "false" },
                         "storageTokenDocumentedTtlSeconds": 7200 } } }
```
- `byteSize`·`contentType`은 신고값. (3)에서 실제 바이트로 다시 검사한다(크기는 정확히 일치, 형식은 magic 대조 — 다르면 `failed DECLARED_MISMATCH`).
- `storageTokenDocumentedTtlSeconds`: 공식 문서상 Storage 토큰 수명(참고값, 실측 아님). 앱이 줄이지 못한다.

| status | HTTP | 추가 필드 | 뜻 | 화면 |
|---|---|---|---|---|
| `issued` | 200 | `grant` | 발급 | PUT 진행 |
| `invalid` | 400 | `field`: `source`·`sourceNote`·`contentType`·`byteSize`·`input` | 입력 오류 | 입력 수정 |
| `denied` | 401 | | 세션·D1 실패 | 재로그인/권한 안내 |
| `limit` | 409 | `reason`: `grant_limit`(열린 grant 5) · `pending_limit`(대기 자산 20) | 상한 | 진행 중 업로드 완료·취소 후 |
| `signing_failed` | 502 | | URL 발급 실패. 서버가 grant 취소·자산 failed(`UPLOAD_CANCELLED`) 시도, URL 없음 | 사용자가 새로 시도 가능 |
| `not_ready` | 503 | | 서버 client·Storage·intake 미구성 | 업로드 비활성 |
| `uncertain` | 503 | | DB 응답 유실/응답 불신 — grant·자산이 생겼을 수 있음 | **자동 재요청 금지**, 목록 새로고침 후 판단 |
| `error` | 500 | | 기타 | 공통 오류 |

### 3.2 `/api/distribution/media/upload/complete`
요청: `{ "grantId": "<uuid>", "nonce": "<grant 응답 값>", "expectedVersion": <grant.rowVersion, 정수 ≥1> }`
| status | HTTP | 추가 필드 | grant 소비? | 뜻 | 화면 / 재시도 |
|---|---|---|---|---|---|
| `ready` | 200 | `asset`(MediaAssetDto) | 예 | 변환 완료 | 권리 결정으로 안내(아직 게시 불가) |
| `failed` | 422 | `code`, `asset`(DTO 또는 `null`) | 예 | 검사·변환·저장 실패 | 새로 올리기 |
| `not_uploaded` | 409 | | 아니오 | intake에 객체 없음(PUT 전·실패) | PUT 성공을 확인한 뒤 **사용자 조작으로** 같은 요청 재전송 가능(앱 기한 전) |
| `storage_error` | 502 | | 아니오 | intake 읽기 실패(5xx·권한·네트워크·20MB 초과 객체) | 잠시 뒤 **사용자 조작으로** 재전송 가능 |
| `unavailable` | 503 | | 아니오(조회 단계) | grant 조회 응답 유실 | 잠시 뒤 **사용자 조작으로** 재전송 가능 |
| `grant_used` | 409 | | 이미 | 중복·동시 완료(또는 자산이 이미 pending_upload 아님) | 목록 새로고침 |
| `conflict_version` | 409 | | 아니오 | rowVersion 불일치 | 목록 새로고침 |
| `grant_expired` | 410 | | — | 앱 기한 지남 | 새로 올리기 |
| `grant_cancelled` | 410 | | — | 취소된 grant | 새로 올리기 |
| `grant_invalid` | 404 | | — | 없음·다른 actor·nonce 불일치(구분 안 함) | 새로 올리기 |
| `uncertain` | 503 | | **예(또는 불명)** | 소비 뒤 결과 불명: 응답 유실·DB 오류·응답 불신(RESUME-026: 소비 뒤 모든 DB 오류를 여기로 통일) | **자동 재시도 금지**(같은 grant 재완료는 `grant_used`), 목록에서 실제 상태 확인 |
| `invalid` | 400 | `field`: `grantId`·`nonce`·`expectedVersion` | 아니오 | 형식 오류 | 코드 결함 |
| `denied`/`not_ready`/`error` | 401/503/500 | | 아니오 | 공통 | 공통 |

`failed.code` 허용 목록: `EMPTY_INPUT · INPUT_TOO_LARGE · UNSUPPORTED_FORMAT · FORMAT_MISMATCH · DECODE_FAILED · PIXEL_LIMIT · ANIMATED_IMAGE · TOO_SMALL · ASPECT_OUT_OF_RANGE · OUTPUT_TOO_LARGE · PROCESSING_TIMEOUT · DECLARED_MISMATCH · STORAGE_UPLOAD_FAILED`. `asset:null`은 failed 기록을 확인하지 못한 경우(응답 유실·복구와의 경합으로 VERSION_CONFLICT 등) — 목록 확인. **RECOVERY-030부터 이때 intake 원본을 지우지 않는다**(실패 기록 확인 시에만 삭제, 보존분은 후속 sweep 대상).
자산 `failureCode`에는 위 목록 외에 서버 정리로 `UPLOAD_CANCELLED`·`UPLOAD_EXPIRED`·`UPLOAD_STALLED`(§7)가 올 수 있다(목록·상세 표시용, complete 응답 `code`로는 나오지 않음).

### 3.3 `/api/distribution/media/upload/cancel`
요청: `{ "grantId", "nonce" }`
| status | HTTP | 뜻 | 화면 |
|---|---|---|---|
| `cancelled` | 200 | grant cancelled, 자산 failed(`UPLOAD_CANCELLED`), intake 원본 삭제 시도. `asset`(DTO 또는 `null`) | 닫기 |
| `grant_cancelled` | 410 | 이미 취소됨(재취소) | **취소 성공과 동일 취급** |
| `grant_used` | 409 | 이미 완료 처리됨 | 목록 새로고침 |
| `grant_expired` | 410 | 앱 기한 지남(자산은 만료 정리 전까지 pending_upload일 수 있음) | 닫기 |
| `grant_invalid` | 404 | 없음·타 actor·nonce 불일치 | 닫기 |
| `unavailable` | 503 | 취소 응답 유실 — 취소됐을 수 있음 | 사용자가 다시 취소 가능(재취소는 `grant_cancelled`) |
| `uncertain` | 503 | 라우트 예외 | 목록 새로고침 |
| `invalid`/`denied`/`not_ready`/`error` | 400/401/503/500 | 공통 | 공통 |
- **취소해도 이미 발급된 서명 URL은 Storage에서 무효화되지 않는다**(§5). 취소 후 들어온 바이트는 완료되지 않고 intake 고아가 된다.

## 4. 준비도(`media/session.ts` `mediaReadiness()`, 후방호환)
`{ metadata, upload, directUpload, preview:false, storageVerified:false, missing: Array<"service_client"|"storage_adapter"|"intake_bucket"> }`
- **업로드 UI는 `directUpload === true`일 때만 켠다.** `upload`는 바이트를 server action으로 받는 경로(본문 1MB 한도)라 화면에 쓰지 않는다.
- `directUpload`는 설정 유무 판정일 뿐이다: `NEXT_PUBLIC_SUPABASE_URL`(https) + `SUPABASE_SECRET_KEY` 형식이 맞으면 true. bucket 실존·정책·CORS 검증이 **아니다**(`storageVerified`는 항상 false, 네트워크 호출 없음). 현재 구현에서 intake와 storage 어댑터는 같은 조건으로 함께 생기므로 `intake_bucket`만 단독으로 빠지는 경우는 없다.
- 기존 metadata export(`getMediaMetadataDeps`·`MediaAssetDto`·`listAssets` 등)는 변경 없음.

## 5. 토큰·만료·한계(숨기지 않음)
- **서명 업로드 URL(토큰)**: 공식 문서·설치된 storage-js 2.119.0 주석상 **2시간 유효, 개별 철회 불가**. 앱 grant 기한(`grantExpiresAt`, 900초, DB 허용 300~1800초)은 **완료 요청을 받는 기한일 뿐 Storage 토큰 수명을 줄이지 않는다.** 앱 기한·취소 뒤에도 2시간 안에는 그 경로로 업로드 가능 → 완료는 거부되고 intake 원본은 고아가 된다.
- upsert 없이 발급(createSignedUploadUrl을 `upsert` 옵션 없이 호출 → 토큰에 upsert 미포함). 같은 경로 덮어쓰기는 Storage가 거절할 것으로 **기대**(실검증 아님). 한 grant = 한 경로 = 한 자산.
- 서버 신뢰 조건: 서명 URL은 https + 설정 origin과 같은 origin + 경로 끝 `/object/upload/sign/distribution-media-intake/<DB 경로>` + `token` 쿼리일 때만 받는다(아니면 `signing_failed`).
- URL·토큰은 grant 응답 본문에만. DTO·목록·URL 쿼리·서버 로그·DB·감사 기록에 남기지 않는다(`SignedUrl` 래퍼는 toString/JSON/inspect에서 가려짐). 브라우저는 메모리에만 두고 저장·로그·재사용하지 않는다(Front 책임).
- nonce: 서버 생성 256bit(base64url 43자), DB에는 sha256만. Storage 토큰과 별개.
- 재시도: 서버는 어떤 단계도 자동 재요청하지 않는다. 사용자가 다시 보낼 수 있는 완료 응답은 `not_uploaded`·`storage_error`·`unavailable`뿐(모두 grant 미소비). `uncertain`은 목록 확인.

### 5.1 고아·정리 공백(미구현 — OPS-READY-024 전 결정 필요)
1. **DB 만료 정리 호출자 없음**: `distribution_expire_media_upload_grants(p_limit)`(issued+기한 지남 → expired, 자산 failed `UPLOAD_EXPIRED`)는 있으나 Cron 등 호출 주체 없음.
2. **소비 후 고착(RESUME-026 PGlite 재현)** → **RECOVERY-030에서 140000 복구 RPC로 로컬 해결(§7)**. 호출 주체는 여전히 없다.
3. **Storage 고아**: intake — 토큰 미철회로 앱 기한·취소 뒤 올라온 객체, 원본 삭제 실패분, `uncertain`으로 보존된 원본. 변형 — 업로드 후 DB 완료 실패분. 목록 조회 기반 sweep 미구현.
- 원문 버전 `media_asset_ids` 검사 없음은 별도 결함으로 유지.

## 6. 브라우저 전송(Front 참고) — 미검증 전제 명시
```js
const res = await fetch(grant.upload.url, { method: "PUT", headers: grant.upload.headers, body: file });
// res.ok(2xx) → complete 요청. 4xx(형식·크기·이미 있음)·네트워크 오류 → 완료 요청 전에 실패 안내(cancel 권장).
```
**실환경에서 확인해야 할 전제(소스로는 검증 불가):**
1. **raw body PUT 수용**: 설치된 storage-js 2.119.0 `uploadToSignedUrl`은 `File/Blob`·`FormData`를 받으면 **multipart FormData**로, 그 밖(Buffer 등)은 raw body + `content-type`·`cache-control` 헤더로 보낸다. 위 코드는 raw body(`File` 그대로) 방식이다 — Storage가 raw body를 지정 content-type으로 저장하는지 실측 필요. 실패하면 대안은 FormData(`cacheControl` + 빈 이름 필드에 file).
2. **`apikey`/`Authorization` 헤더 불요 여부**: SDK는 클라이언트 기본 헤더(apikey 등)를 함께 보낸다. 서명 토큰만으로 통과하는지 미검증 — 필요하면 publishable(anon) key를 `apikey` 헤더로 추가(비밀 아님, secret key 절대 금지).
3. **CORS**: 앱 origin → `<project>.supabase.co/storage/v1/object/upload/sign/...` PUT, `content-type`·`x-upsert` 헤더 preflight 허용 여부.
4. **`x-upsert: false`의 효과**: upsert는 토큰 발급 시 결정되는 것으로 보이며 헤더는 무해한 중복으로 추정 — 실측 필요.
5. **bucket `allowed_mime_types`·`file_size_limit`이 서명 업로드에도 적용**되어 4xx를 내는지.
6. **토큰 수명 2시간·철회 불가**의 실제 동작.
- `useNewHostname`(storage 전용 호스트) 옵션은 쓰지 않는다 — URL origin은 `NEXT_PUBLIC_SUPABASE_URL`과 같아야 서버가 신뢰한다.

## 7. 소비 후 고착 복구(BE-UPLOAD-RECOVERY-030) — 서버 내부 계약
migration `20261116140000_distribution_media_upload_stall_recovery.sql`. 로컬 PGlite만 검증, 실제 DB 미적용, 호출 주체(Cron) 없음.

- RPC `distribution_recover_stalled_media_uploads(p_limit integer 1..500, p_stall_seconds integer 600..86400) returns integer`(복구 건수). service_role 전용 SECURITY DEFINER, 범위 밖 인자 `22023`. actor 인자 없음(시스템 작업).
- 전이: 자산 `pending_upload|processing` → `failed`(`UPLOAD_STALLED`), `row_version+1`. grant는 `consumed` 그대로. Storage 원본·변형은 삭제하지 않음.
- 대상(잠근 최신 행 기준): grant `consumed` ∧ `consumed_at ≤ now()-stall` ∧ 자산 `updated_at ≤ now()-stall` ∧ `asset.owner_id = grant.actor_id` ∧ 미보관 ∧ `pending_upload|processing`. ready·failed·archived·issued/cancelled/expired grant·grant 없는 자산은 비대상.
- 잠금: 자산 행만 `FOR UPDATE OF a SKIP LOCKED`(대기 없음 → 정상 전이와 교착 없음), 갱신은 `id ∧ row_version=잠근 값 ∧ 상태` 이중 조건. 반복 실행 멱등.
- 경합: 복구 먼저 → 늦은 mark_received/complete/fail은 `VERSION_CONFLICT` → complete 응답 `uncertain`(ready 덮어쓰기 없음) 또는 `failed asset:null`(원본 보존). 정상 먼저 → 복구는 건너뜀. 늦게 올라간 변형 객체는 DB 기록 없는 Storage 고아(후속 sweep).
- **stall 근거와 실행 조건**: 하한 600초는 완료 라우트 `maxDuration = 60`이 **플랫폼에서 강제될 때**(Vercel)만 성립하는 10배 여유다. 권장 900초. 앱 래퍼 `media/recovery.ts` `recoverStalledUploads`는 `runtimeEnforcesMaxDuration`이 true일 때만 RPC를 부르고 아니면 `disabled`. 판정 헬퍼 `runtimeEnforcesMaxDuration(env)`는 `VERCEL === "1"`만 true. **자가 호스팅(`next start` 등)에서는 자동 호출 비활성** — 처리 시간 상한이 보장되지 않아 살아 있는 처리를 실패로 닫을 수 있다(데이터 덮어쓰기는 없음).
- 래퍼 결과: `recovered{count}` · `disabled` · `not_ready` · `invalid{field: limit|stallSeconds}` · `db_error` · `unavailable`(응답 유실 — 멱등이라 다음 주기 재호출 안전).
- Front 영향: 공개 API·DTO 변경 없음. 목록의 `failureCode: "UPLOAD_STALLED"`는 "처리가 끝나지 않아 닫힘 — 새로 올리기"로 표시 권장.
