# BE-UPLOAD-RESUME-026 — 업로드 서버 인수 및 최종 계약 확정 (결과)

담당: CC-BACKEND-01 Claude(Backend) / 현 terminal term_0dacb0de-23ca-43f4-a7d2-7bf514a82ae8
지시: 사용자 2026-11-17 → CX-MASTER-01 (task_f86b2cc1ebfc, dispatch ctx_bb18cd3beba7)
상태: **ready_review** (통합 수락·운영 완료 아님). 기준선 main 8f0691c.
착수 보고: msg_d9ef0278ac87 (작업ID·수정예정 파일·직접지시 충돌 없음).

## 1. 수정 파일 (허용 범위 내)
| 파일 | 변경 |
|---|---|
| `src/server/distribution/media/upload.ts` | grant 소비 **뒤** 처리 단계의 모든 비최종 결과(db_error 유실 아님 포함·bad_response·기타)를 `error`(500) 대신 `uncertain`(503)으로 통일. 주석에 계약 경로 갱신. 공개 export·타입 이름 변경 없음 |
| `tests/distribution-server/media-upload.test.ts` | 단위 1건 추가: 소비 뒤 DB 오류 3종 → `uncertain`, 원본 삭제 0·변형 0 |
| `tests/distribution-server/media-upload.pglite.test.ts` | PGlite 1건 추가: **소비 후 고착 공백 재현**(아래 §4-2). 실행 안내 경로 `web/` 접두 제거 |
| `scripts/distribution-local-verify/upload-run.mjs` | **신규**. 시험·130000 머리 주석이 참조하던 러너가 저장소에 없었다. media-run.mjs와 같은 형식(exit 0/1/3 NOT RUN) |
| `handoff/workspace/docs/contracts/MEDIA_UPLOAD_CONTRACT.md` | 잠정 → **로컬 기준 확정**. 코드와의 불일치 전부 정정, 미검증 전제 명시 |

수정하지 않음: route.ts 3개, upload-http.ts, storage*.ts, session.ts, policy.ts, SQL migration, Front UI/CSS/auth/package/lock/config/TEAM/공통이력. 작업 중 관찰된 Front 측 미커밋 변경(`src/app/admin/distribution/media/**`, `media-*` 컴포넌트, `tests/distribution-front/**`)과 Master 문서 변경은 건드리지 않고 보존했다.

## 2. 계약 ↔ 구현 대조 결과 (발견 → 조치)
| # | 불일치 | 조치 |
|---|---|---|
| 1 | 계약 grant 응답 `expiresAt` ↔ 코드 `grantExpiresAt` + `storageTokenDocumentedTtlSeconds` | 계약을 코드에 맞춤(코드·시험이 이미 사용, 의미가 더 명확) |
| 2 | complete/cancel `unavailable`(503, grant 미소비 조회·취소 응답 유실)이 계약에 없음 | 계약에 추가, 재전송 허용 조건 명시 |
| 3 | 소비 뒤 db_error(유실 아님)가 `error`(500)로 나가 Front가 재시도 가능 오류로 볼 수 있었음(재시도 시 `grant_used`) | **코드 수정** → `uncertain`. 시험 추가 |
| 4 | 계약 "supabase-js uploadToSignedUrl과 같은 요청 모양(raw body)" — 설치된 storage-js 2.119.0은 File/Blob이면 **multipart FormData** | 계약 §6에 사실대로 정정, raw PUT 수용은 미검증 전제로 명시 |
| 5 | `invalid_request`(400) 조건(Origin 필수·4KB·JSON 객체), 공통 보안 헤더, 라우트 예외 → `uncertain` 누락 | 계약 §3 공통에 명시 |
| 6 | cancel 재취소 `grant_cancelled`는 410인데 계약은 "200 취급 가능"만 | HTTP 410 명시 + 화면은 성공 취급 |
| 7 | `sourceNote` 제어문자 거부·공백만 null, `invalid.field` 값 목록, `failed.asset:null` 의미 누락 | 계약에 추가 |
| 8 | 준비도 `missing:"intake_bucket"` 단독 발생 가능처럼 기술 | 현재 구현상 storage와 함께만 생김을 명시 |
| 9 | 시험·SQL 주석이 참조한 `upload-run.mjs` 부재 | 신규 작성 |

흐름 검토(이상 없음 확인): grant→PUT→complete/cancel 순서, actor/D1(모든 RPC `distribution_assert_admin_actor` + 세션 actor), nonce(서버 256bit, DB sha256만, 타 actor·불일치·없음 구분 없음), rowVersion 대조(조회 후·소비 시 이중), 앱 만료(조회·소비 모두 `expires_at <= now()` 판정), 중복·동시 완료(행 잠금 → 1건만 consumed), 취소 경합(취소 후 완료 → grant_cancelled, 완료 후 취소 → grant_used), not_uploaded/storage_error/unavailable는 grant 미소비라 사용자 재전송 가능, 서명 실패 시 grant 취소 시도·URL 미반환.

## 3. 명령 / exit / pass·skip (Node 24.22.3, `PGLITE_PROJECT=%TEMP%\vibe-resume-20261117`, PGlite 0.5.16)
| 명령 | exit | 결과 |
|---|---|---|
| `node scripts/distribution-local-verify/upload-run.mjs --pglite-project <tools>` | 0 | 11/11 통과(신규 1 포함), skip 0 |
| `npx vitest run tests/distribution-server/media-upload.test.ts` | 0 | 17/17 통과(신규 1 포함) |
| `npm test` (PGLITE_PROJECT 설정) | 0 | **37파일 631 통과, 실패·skip 0** |
| `npm run lint` | 0 | 오류 0, 기존 경고 3(background.js:105, sidepanel.js:26, m2-run.mjs:30) |
| `npm run build` | 0 | 성공 |
| `npm run typecheck` | 0 | 성공 |

631 = 기준선 622 + 내 시험 2 + 작업 트리의 Front 미커밋 시험 변경분(내 범위 아님). 기준선 시험 삭제·약화·skip 추가 없음.
**실/대역 구분**: DB는 PGlite 대역(단일 연결 — 동시성은 행 잠금 논리 확인일 뿐), Storage·intake는 메모리 mock, sharp는 실제. **실제 Supabase DB·Storage·서명 업로드 전송·CORS·토큰 수명은 미검증.**

## 4. 남은 결함·공백
1. **실제 Storage 미검증**(계약 §6의 6개 전제: raw body PUT 수용, apikey 헤더 필요 여부, CORS preflight, x-upsert 효과, bucket mime/크기 제한 적용, 토큰 2시간·철회 불가).
2. **소비 후 고착(SQL 공백, PGlite 재현)**: 소비 뒤 처리 결과 기록 실패 시 자산이 `pending_upload`/`processing`으로 남고 `distribution_expire_media_upload_grants`는 `status='issued'`만 처리 → 대기 상한 20을 계속 점유. **새 forward migration 제안**(130000 수정 아님): service_role RPC `distribution_close_stalled_media_uploads(p_limit, p_stall_seconds)` — consumed 후 N분 지난 grant의 자산이 pending_upload/processing이면 failed(`UPLOAD_STALLED`), row_version+1. **Master 범위 조정 전 미착수.**
3. 만료 정리 RPC 호출 주체(Cron 등) 없음.
4. Storage 고아 sweep 미구현(토큰 미철회 후 업로드분, 원본 삭제 실패분, uncertain 보존 원본, 변형 업로드 후 DB 실패분).
5. 원문 버전 `media_asset_ids` 검사 없음(기존 별도 결함).

## 5. Front 전달 계약 (확정 — 로컬 기준, UI 활성화는 Master 인수 후)
정본: `handoff/workspace/docs/contracts/MEDIA_UPLOAD_CONTRACT.md` §3~§6. 요약:
- **활성 조건**: `mediaReadiness().directUpload === true`일 때만 업로드 UI. `storageVerified`는 항상 false(실검증 아님 문구 유지).
- **요청**: 모두 `POST`, `Content-Type: application/json`, 같은 origin(브라우저 fetch 기본 Origin 헤더). 위반 → `400 invalid_request`.
- **grant** `{source, sourceNote?, contentType, byteSize}` → `200 issued {grant:{grantId, assetId, rowVersion, nonce, grantExpiresAt, upload:{url, method:"PUT", headers:{content-type, x-upsert:"false"}, storageTokenDocumentedTtlSeconds}}}` | `invalid{field}` 400 | `denied` 401 | `limit{reason: grant_limit|pending_limit}` 409 | `signing_failed` 502 | `not_ready`/`uncertain` 503 | `error` 500.
- **PUT**: `fetch(upload.url, {method:"PUT", headers: upload.headers, body: file})`. url/nonce는 메모리에만, 로그·저장 금지. 2xx면 complete, 아니면 실패 안내 + cancel 권장.
- **complete** `{grantId, nonce, expectedVersion: rowVersion}` → `ready{asset}` 200 | `failed{code, asset|null}` 422 | `not_uploaded` 409 | `grant_used` 409 | `conflict_version` 409 | `grant_expired`/`grant_cancelled` 410 | `grant_invalid` 404 | `storage_error` 502 | `unavailable` 503 | `uncertain` 503 | 공통.
- **cancel** `{grantId, nonce}` → `cancelled{asset|null}` 200 | `grant_cancelled` 410(성공 취급) | `grant_used` 409 | `grant_expired` 410 | `grant_invalid` 404 | `unavailable` 503 | 공통.
- **재시도 규칙**: 자동 재시도 전면 금지. 사용자 조작 재전송 허용은 complete의 `not_uploaded`·`storage_error`·`unavailable`(grant 미소비, 앱 기한 전), cancel의 `unavailable`뿐. `uncertain`·`grant_used`·`conflict_version` → 목록 새로고침. `failed`·`grant_expired`·`grant_cancelled`·`grant_invalid` → 새로 올리기. `limit` → 진행 중 업로드 정리 안내.
- **상태 문구**: 업로드됨 ≠ ready ≠ 권리 승인. ready 후에도 권리 결정 전 게시 불가.

## 6. OPS-READY-024 준비 (실서비스 쓰기 없음, 비밀값 미열람)
- **migration**: 실제 프로젝트 적용 이력 확인 필요(미확인). 업로드에는 `20261116120000_distribution_media_assets.sql`, `20261116130000_distribution_media_upload_grants.sql`과 그 선행 000000~110000 필요. §4-2 forward migration은 조정 후 추가 예정.
- **bucket**(운영 승인 작업): `distribution-media-intake`(private, 20971520, jpeg/png/webp), `distribution-media`(private, 8388608, jpeg). storage.objects 정책 추가 금지.
- **환경변수 이름**(값은 읽지 않음): 서버 `NEXT_PUBLIC_SUPABASE_URL`(https origin — 서명 URL origin 신뢰 기준), `SUPABASE_SECRET_KEY`(서버 전용). 브라우저 PUT에 apikey가 필요하다고 판명되면 기존 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 사용 검토(secret 금지). 그 밖 `NEXT_PUBLIC_SITE_URL`.
- **검증 순서 제안**: ① migration 이력 대조(read-only) → ② 스테이징/승인된 환경에 120000·130000 적용 → ③ bucket 2개 생성·정책 0 확인 → ④ `mediaReadiness()` directUpload=true 확인 → ⑤ 소형 PNG로 grant→PUT(raw)→complete 1회, 실패 시 FormData 대안·apikey 헤더 실험 → ⑥ upsert 거절·만료/취소 후 PUT 동작·CORS 확인 → ⑦ 정리 RPC 수동 1회 → ⑧ 결과로 계약 §6 전제 갱신 후 UI 활성화.
- **고아 정리 공백**: §4-2~4.

## 7. 최종 diff / hash
- 내 변경 diff: `src/server/distribution/media/upload.ts`(+5/−9 상당), `tests/distribution-server/media-upload.test.ts`(+16), `tests/distribution-server/media-upload.pglite.test.ts`(+27/−1), 계약 문서 전면 갱신, `upload-run.mjs` 신규.
- 위 5개 파일 `git diff`(신규 파일 제외) sha256: `efbb2da3f96fcba6d3cfc589b429149ee460c90d0105b6fb381297d3ef3a7ce9`
- 파일 sha256:
  - upload.ts `3f8fea11d9d3c6eabafcd624959fb6b9d08d13f3a5b6aa3e6b0b00f59c2f88e7`
  - media-upload.test.ts `77e161b695aad89da5c54ef7dd742d4998c7990499772621d2edf93c5dc71440`
  - media-upload.pglite.test.ts `8e2641f1ceb8671c32e1afeb86195a2a256a3dbdfa059e341bb3fbf4faf5687f`
  - MEDIA_UPLOAD_CONTRACT.md `107898ca1a8a32e04b360e52ff6a45ce6fa260a7d8c5b0680ec4615fce76a30a`
  - upload-run.mjs `f4d6c65f905589bed88b58cc625c8c668943960c058c175bef2fa5447d9911b1`
- 커밋·배포·실DB 적용·bucket 생성·외부 게시 없음.
