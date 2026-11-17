# BE-MEDIA-024 — 미디어 세션 배선·Storage 어댑터·오류 계약 결과

- 작업자: Claude(Backend) CC-BACKEND-01 / 지시 msg_a79288612d64 (CX-MASTER-01) / 2026-11-17 / 상태 `ready_review`
- 사용자 직접지시와 충돌: 없음.
- 금지 준수: 기존 SQL·process/policy·service.ts·Front app/components·package/lock·next.config·write-notice/action-form 미수정. 키/env 파일 열람 없음(코드에서 기존 factory·parseServiceConfig로만 참조, 시험은 가짜 값 stub). 실제 Storage·계정·DB·외부 게시·commit/push 없음. 네트워크는 공식 문서 읽기만.

## 1. 수정 파일과 기준 hash(SHA256 앞 16자리)
| 파일 | 변경 | hash |
|---|---|---|
| `web/src/server/distribution/media/session.ts` | 신규(server-only): `getMediaMetadataDeps`, `getMediaDeps`, `mediaReadiness`, `mediaReadinessOf`, `MediaReadiness` | 5AA3B3F9C9128A16 |
| `web/src/server/distribution/media/storage-supabase.ts` | 신규: `createSupabaseMediaStorage`, `sanitizeStorageError`, `VARIANT_MAX_BYTES`, SDK 최소 타입 | D58C446AE52C6ED2 |
| `web/src/server/distribution/media/storage.ts` | 인터페이스 최소: `StorageFailCode`에 `already_exists` 추가(기존 호출부 호환) | AD3E6E6081B747C6 |
| `web/src/server/distribution/errors.ts` | M4 토큰 7개 TOKEN_MAP 명시(`invalid_input` 유지) + `mediaErrorReason`, `MEDIA_ERROR_REASONS`, `MediaErrorReason` | 271B7FE61E86E07E |
| `web/tests/distribution-server/media-runtime.test.ts` | 신규 15개 | CB6ACC7D38EA77D5 |
| `docs/contracts/MEDIA_FRONT_CONTRACT.md` | §0-A 확정, Storage 통제, 오류 사유, §9 업로드 동선 제안 | 1A968979C9BADF5F |

## 2. 설계 판단
- **새 ConsoleErrorCode를 만들지 않음**: 공용 `write-notice`가 모르는 code를 `uncertain`(결과 불명)으로 바꾸므로, 확정 거절인 M4 오류가 불명으로 오안내된다. code는 `invalid_input` 유지, 세부 사유는 허용 목록 함수로 분리 → write-notice 수정 불필요.
- **token 전역 정제는 하지 않음**: OAuth·connections·token-service가 기존 token 원문(OAUTH_STATE_USED 등)에 의존. M4는 `mediaErrorReason`(허용 목록 + SQLSTATE 23514)으로만 노출.
- **metadata/upload 분리**: list·rights·archive는 storage 없이 동작(service는 이미 `Omit<MediaDeps,"storage">`). 준비도는 설정 유무일 뿐 검증이 아님(`storageVerified:false` 고정, 네트워크 호출 없음).
- **issuePublishUrl은 Front 비노출**: 계약에 실행기 전용 명시, readiness `preview:false` 고정.
- 매 호출 새 client(모듈 전역 캐시 없음). RPC·Storage는 같은 service client 인스턴스.

## 3. 검증(Windows, Node, PGlite `%TEMP%\autopost-local-db-verify-002`, Front 동시 작업 중)
| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run tests/distribution-server/media-runtime.test.ts` | 0 | 15/15 |
| `npx vitest run` (PGLITE_PROJECT 지정) | 0 | 34 files · 583 passed · skip 0 (Front `tests/distribution-front/media-ui.test.ts` 포함) |
| `npx tsc --noEmit` | 0 | — |
| `npx eslint src/server/distribution tests/distribution-server` | 0 | — |
| `npm run lint` | 0 | 0 error, 기존 경고 3 |
| `npm run build` | 0 | 성공 |
- 기준 snapshot: 위 hash. 같은 시각 Front가 수정 중이던 파일(이번 실행에 포함됨, 통과): `app/admin/distribution/media/{page,[assetId]/page}.tsx`, `components/distribution-console/{media-asset-detail,media-asset-list,media-forms}.tsx·media-labels.ts·media.module.css·console-shell.tsx·states.tsx`, `tests/distribution-front/media-ui.test.ts`. 이후 Front 변경으로 생기는 실패는 이 snapshot과 구분 필요.
- 시험 범위(mock): 오류 정제(404/409/403/5xx/상태 없음, 메시지·경로·토큰 비반영), upload 통제(bucket·경로·contentType·크기, upsert:false, already_exists, 5xx·예외 → 결과 불명, 재시도 0), download(경로·크기 상한·not_found), remove(원본 경로만·빈 결과 not_found), createSignedUrl(경로·TTL·origin/https 검사), M4 사유 7개 + write-notice `invalid` 유지 + 허용 밖·다른 SQLSTATE·유실 null, 서비스 왕복(업로드 성공·이미 있음 → failed·complete 0, 원본 읽기 실패 → STORAGE_READ_FAILED·RPC 0·원본 미삭제, 원본 삭제 실패해도 ready, list/rights는 storage 없이 ok, 서명은 storage 없으면 not_ready), session 배선(client 없음/있음/origin 형식 오류 → storage만 빠짐, 준비도에 비밀·URL 없음).
- 실제 Supabase Storage·bucket·서명 URL 동작은 미검증.

## 4. Front 공유
- 잠정 계약: msg_4a30b39d1794(Front 터미널), msg_844e7dd34e50(Master). Front 회신 msg_8e955e1bb511: 확정 전 import 안 함, metadata/upload 분리 반영.
- 확정 알림: 이 결과와 함께 Front·Master에 전송.

## 5. 남은 문제·제안
1. **업로드 동선 미결(계약 §9)**: Server Action 기본 1MB·Vercel 4.5MB ↔ 앱 입력 20MB, 그리고 120000 bucket 계약(jpeg만·8MB)이 PNG/WEBP·대용량 원본의 통제 업로드를 막는다. 권장: 원본 전용 private intake bucket + 서버 발급 서명 업로드 URL(upsert:false). Master 결정 필요. 그 전까지 업로드 UI 비활성.
2. Storage 고아 객체(변형 업로드 후 DB 완료 실패, 원본 삭제 실패) 정리 없음 — 후속.
3. 원문 버전 `media_asset_ids` 존재·ready 검사 없음 — 별도 결함 유지(SQL 미수정).
4. 실제 bucket 생성·정책, 실 Supabase 왕복 검증은 별도 승인 작업.
