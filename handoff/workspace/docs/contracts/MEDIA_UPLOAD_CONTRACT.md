# 미디어 직접 업로드(private intake) 계약

작성: 2026-11-17 / BE-UPLOAD-025 / Claude(Backend) CC-BACKEND-01 / 상태: **잠정(구현 중 — 이름·입출력은 이대로 구현, 완료 시 "확정"으로 갱신)**
채택: MEDIA_FRONT_CONTRACT §9 권장 A. 실제 bucket 생성·Storage 실호출·실DB 적용은 이번 범위가 아니다(코드·mock·PGlite만).

## 1. 흐름
```
브라우저 ──(1) POST /api/distribution/media/upload/grant  {메타데이터만, 바이트 없음}──▶ 서버
   서버: 세션 actor·D1 → 입력 검사 → DB에 자산(pending_upload)+grant(nonce 해시·만료) 원자 기록 → intake 서명 업로드 URL 발급(upsert:false)
브라우저 ◀── {grantId, assetId, rowVersion, nonce, expiresAt, upload:{url, method:"PUT", headers}}  (이 응답에만 URL/토큰)
브라우저 ──(2) PUT upload.url  (원본 바이트, Supabase Storage로 직접 — Vercel·Next 본문 한도 무관)
브라우저 ──(3) POST /api/distribution/media/upload/complete {grantId, nonce, expectedVersion}──▶ 서버
   서버: grant 조회(actor·nonce·만료·상태) → intake에서 원본 다운로드(≤20MB) → grant 1회 소비(원자) → M4 검사·sharp 변환
         → 변형을 distribution-media(jpeg)에 저장 → ready/failed → intake 원본 삭제
브라우저 ◀── {status:"ready", asset} 등
(취소) POST /api/distribution/media/upload/cancel {grantId, nonce}
```
상태 구분: **업로드됨 ≠ ready ≠ 권리 approved.** (2)가 성공해도 (3)의 서버 검사를 통과해야 ready이고, 게시에는 별도 권리 승인이 필요하다.

## 2. bucket 계약(운영 생성은 별도 승인 작업, 이번엔 DDL 주석만)
| bucket | 용도 | public | 허용 형식 | 크기 상한 | 경로 |
|---|---|---|---|---|---|
| `distribution-media-intake` | 원본 임시 보관 | false | image/jpeg, image/png, image/webp | 20MB(20971520) | `uploads/<owner_id>/<asset_id>/original` (DB 생성 열) |
| `distribution-media` | 서버 변형 | false | image/jpeg | 8MB | `variants/<asset_id>/feed_jpeg.jpg` |
- 두 bucket 모두 storage.objects 정책 없음(anon/authenticated 직접 접근 0). intake 쓰기는 서버 발급 서명 업로드 URL로만, 읽기·삭제·변형 쓰기는 service_role 서버만.
- 경로·파일명은 클라이언트가 정하지 않는다(DB 생성 열만). 업로드 파일명은 무시된다.

## 3. Endpoint (모두 POST, `Content-Type: application/json`, 같은 origin만)
공통: 세션 쿠키 인증(D1 승인 admin). `Origin` 헤더가 요청 origin과 다르거나 JSON이 아니면 `400 invalid_request`. 응답은 항상 `Cache-Control: no-store`. 응답 본문은 아래 허용 목록 `status`만.

### 3.1 `/api/distribution/media/upload/grant`
요청: `{ "source": "own_creation"|"licensed"|"public_domain"|"other", "sourceNote"?: string(≤500), "contentType": "image/jpeg"|"image/png"|"image/webp", "byteSize": 1..20971520 }`
성공 `200`:
```json
{ "status": "issued",
  "grant": { "grantId": "<uuid>", "assetId": "<uuid>", "rowVersion": 1, "nonce": "<43자 base64url>",
             "expiresAt": "<ISO, 앱 만료>",
             "upload": { "url": "<서명 업로드 URL — 비밀>", "method": "PUT",
                         "headers": { "content-type": "<요청한 contentType>", "x-upsert": "false" } } } }
```
- `byteSize`·`contentType`은 신고값이다. 실제 크기·형식은 (3)에서 바이트로 다시 검사한다(신고와 다르면 실패).
- 실패: `denied`(401) · `not_ready`(503, 서버 client·Storage·intake 미구성) · `invalid`(400, `field`) · `limit`(409, `reason`: `pending_limit`(대기 자산 20) | `grant_limit`(열린 grant 5)) · `signing_failed`(502 — URL 발급 실패, 서버가 grant 취소·자산 failed 처리 시도, URL 없음) · `uncertain`(503 — DB 응답 유실: grant·자산이 생겼을 수 있음, 자동 재요청 금지, 목록 새로고침 후 판단) · `error`(500).

### 3.2 `/api/distribution/media/upload/complete`
요청: `{ "grantId": "<uuid>", "nonce": "<grant 응답 값>", "expectedVersion": <grant의 rowVersion> }`
| status | HTTP | 뜻 | 화면 |
|---|---|---|---|
| `ready` + `asset`(MediaAssetDto) | 200 | 변환 완료 | 권리 결정으로 안내(아직 게시 불가) |
| `failed` + `code` + `asset?` | 422 | 검사·변환·저장 실패(`EMPTY_INPUT·INPUT_TOO_LARGE·UNSUPPORTED_FORMAT·FORMAT_MISMATCH·DECODE_FAILED·PIXEL_LIMIT·ANIMATED_IMAGE·TOO_SMALL·ASPECT_OUT_OF_RANGE·OUTPUT_TOO_LARGE·PROCESSING_TIMEOUT·DECLARED_MISMATCH·STORAGE_UPLOAD_FAILED`) | 새로 올리기 |
| `not_uploaded` | 409 | intake에 객체 없음(PUT 전·실패) — grant 그대로 | PUT 성공 확인 후 **사용자가** 다시 완료 가능(만료 전) |
| `grant_used` | 409 | 이미 완료 처리됨(중복 완료) | 목록 새로고침 |
| `grant_expired` | 410 | 앱 만료 지남 | 새로 올리기 |
| `grant_cancelled` | 410 | 취소된 grant | 새로 올리기 |
| `grant_invalid` | 404 | 없음·다른 actor·nonce 불일치(구분하지 않음) | 새로 올리기 |
| `conflict_version` | 409 | 자산 rowVersion 불일치 | 목록 새로고침 |
| `uncertain` | 503 | grant 소비 후 처리 결과 불명(응답 유실 등) | 자동 재시도 금지, 목록에서 실제 상태 확인 |
| `storage_error` | 502 | intake 읽기 실패(유실·권한·5xx) — grant 미소비 | 잠시 뒤 사용자가 다시 완료 |
| `denied` / `not_ready` / `invalid` / `error` | 401/503/400/500 | 공통 | 공통 |

### 3.3 `/api/distribution/media/upload/cancel`
요청: `{ "grantId", "nonce" }` → `cancelled`(200, 자산 failed `UPLOAD_CANCELLED`) · `grant_used` · `grant_expired` · `grant_cancelled`(재취소, 200 취급 가능) · `grant_invalid` · 공통 실패.
- **취소해도 이미 발급된 서명 URL은 Storage에서 무효화되지 않는다**(아래 §5). 취소 후 들어온 바이트는 완료되지 않고 intake 고아가 된다.

## 4. 준비도(`media/session.ts`, 후방호환 추가)
`mediaReadiness()`에 필드 추가: `directUpload: boolean` — service client + Storage 어댑터 + intake 구성. 기존 `metadata`·`upload`·`preview:false`·`storageVerified:false`·`missing`은 그대로(`missing`에 `"intake_bucket"`이 들어갈 수 있음). **업로드 UI는 `directUpload`로만 켠다**(`upload`는 바이트를 server action으로 받는 경로 — 1MB 한도라 화면에 쓰지 않음). `directUpload=true`도 bucket 실존·정책 검증이 아니다.

## 5. 토큰·만료·한계(숨기지 않음)
- **서명 업로드 URL(토큰)**: Supabase 공식 문서상 **2시간 유효, 개별 철회 불가**(서명 키 교체로만 무효화). 앱의 grant 만료(`expiresAt`, 기본 15분, 300~1800초)는 **완료 요청을 받는 기한일 뿐 Storage 토큰 수명을 줄이지 않는다.** 앱 만료·취소 뒤에도 2시간 안에는 그 경로로 바이트 업로드가 가능하다 → 완료는 거부되고 intake 원본은 고아가 된다.
- upsert:false로 발급 → 같은 경로 덮어쓰기 불가(이미 있으면 Storage가 거절). 한 grant = 한 경로 = 한 자산.
- URL·토큰은 grant 응답 본문에만. 일반 DTO·목록·URL 쿼리·서버 로그·DB·감사 기록에 남기지 않는다. 브라우저는 메모리에만 두고 저장·로그하지 않는다(Front 책임).
- nonce: 서버 생성 256bit, DB에는 sha256만. 완료·취소 요청이 같은 grant 응답을 받은 쪽에서 왔음을 확인하는 값(Storage 토큰과 별개).
- 재시도: 서버는 어떤 단계도 자동 재요청하지 않는다. 사용자가 다시 시도할 수 있는 것은 `not_uploaded`·`storage_error`의 완료뿐. `uncertain`은 목록 확인.
- **고아 sweep 계획(미구현)**: ① DB — 만료된 issued grant를 expired로 바꾸고 자산을 failed(`UPLOAD_EXPIRED`)로 닫는 RPC `distribution_expire_media_upload_grants`는 130000에 포함, 호출 주체(Cron 등)는 없음. ② Storage — intake에서 생성 후 2시간 넘었고 소비되지 않은 grant의 객체, 그리고 원본 삭제 실패분을 지우는 작업은 미구현(Storage 목록 조회 필요, 별도 작업). ③ 변형 업로드 후 DB 완료 실패 고아도 같은 작업에서.
- 원문 버전 `media_asset_ids` 검사 없음은 별도 결함으로 유지.

## 6. 브라우저 전송(Front 참고)
`fetch(upload.url, { method: "PUT", headers: upload.headers, body: file })` — 응답 2xx면 (3) 완료 요청. 4xx(형식·크기·이미 있음)·네트워크 오류면 완료 요청 전에 사용자에게 실패 안내(취소 요청 권장). supabase-js `uploadToSignedUrl`과 같은 요청 모양(`/object/upload/sign/<bucket>/<path>?token=…`, raw body, `x-upsert`)이다(SDK는 `apikey` 헤더도 함께 보낸다 — 서명 토큰만으로 충분한지는 **미검증**, 필요하면 publishable key를 헤더로 추가하는 방식을 실환경에서 확인). **실제 Storage 동작은 미검증.**
