# AUTOPOST-M4-MEDIA-022 — 결과 (작성: Claude(Front) CC-FRONT-01, 과거 CC-ENG-01 이력 세션)

- task_be355426e026 / dispatch ctx_60403bf9cd04 / 2026-11-17
- 등록 변경(msg_3f86bea29d43) 이전에 받은 작업을 이 세션이 완료 지점까지 마무리했다. 아래 파일은 이 세션 점유로 남기며, 이후 서버 핵심(SQL·RPC·처리)은 Claude(Backend)로 인계할 경계를 Master가 정한다.
- 금지 준수: UI·Instagram OAuth·live gate·실업로드·실게시 활성화 없음. 실제 Storage bucket 생성·실DB·실계정·키/env 열람·외부 API·commit/push 없음. 네트워크는 npm 설치만(공식 문서는 021 근거 재사용, 이번 추가 조회 없음).
- **구분: 구현·로컬 검증 완료(코드 + PGlite + 실제 sharp). 운영 미완료(실제 Supabase migration 미적용, Storage bucket·정책 미생성, 실 Storage 어댑터 미등록, UI 없음).**

## 0. 같은 턴의 사용자 직접 지시(우선 처리)
- "한글출력 지침 깨졌어 원인확인하고 모든 대화는 한글대화야 지침에 추가해" → 원인: 기존 메모리 지침이 '답변·진행 알림'만 다뤄 도구 설명·중간 문구가 영어로 나갔고, 긴 대화 요약·영문 브리프 뒤 영어로 회귀. 조치: 메모리 `reply-in-korean.md`·색인 갱신, `D:\Vibe\CLAUDE.md`에 "언어" 절 추가(모든 대화·도구 설명·보고 한국어).
- "너의 이름은 뭐지?" → 답변. 이후 Master 등록 변경(CC-FRONT-01 Claude(Front))을 메모리 `role-coding-worker.md`에 반영 — 같은 파일에 다른 세션이 오늘 04:40 "Claude(Backend)"로 적은 기록이 있어 덮어쓰지 않고 세션별 구분을 덧붙였다(충돌 보고 대상).

## 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `web/supabase/migrations/20261116120000_distribution_media_assets.sql` | 자산·변형·권리 결정 이력·서명 승인 기록 4테이블, RPC 8개, 리비전 미디어 FK·검사 |
| `web/src/server/distribution/media/policy.ts` | 플랫폼 상한 vs 앱 상한, TTL 정책, bucket 이름 |
| `web/src/server/distribution/media/process.ts` | sharp 검사·정제(키트 instagramJpeg.ts 참고 출처 고지) |
| `web/src/server/distribution/media/storage.ts` | Storage 주입 계약, SignedUrl 가림, 경로 형식 |
| `web/src/server/distribution/media/service.ts` | 업로드→처리, 통제 업로드 처리, 권리·보관·목록, 게시용 서명, PinnedMediaRef |
| `web/tests/distribution-server/media.test.ts` · `media.pglite.test.ts` | 단위 11 · PGlite 5 |
| `web/scripts/distribution-local-verify/media-run.mjs` | 러너(대상 없으면 NOT RUN exit 3) |
| `web/package.json` · `package-lock.json` | `sharp` **0.35.5 정확 고정**(이미 lock에 next의 optional로 있던 같은 버전 — lock 변화는 optional 표식 4줄 제거뿐, 다른 패키지 버전 변경 없음) |

## 2. 설계 요점
- **테이블**(RLS·정책 없음·모든 공개 역할 직접 권한 회수): `distribution_media_assets`(소유·상태 pending_upload→processing→ready|failed·출처·원본 형식/바이트/폭/높이/sha256·권리 캐시·허용 채널·유효기한·보관·row_version), `distribution_media_variants`(feed_jpeg, 바이트 ≤8MB·폭 320~1440·sRGB·sha256, 불변), `distribution_media_rights_decisions`(approved/rejected/revoked 불변 이력), `distribution_media_signing_grants`(채널·변형·sha256·TTL·만료만 — **URL·토큰 없음**).
- **경로는 생성 열**: `uploads/<owner>/<asset>/original`, `variants/<asset>/feed_jpeg.jpg` — 서버 uuid로만 구성, 사용자 파일명·경로 불신, 변경 불가.
- **원본 바이트는 저장하지 않음**(EXIF·GPS 등 개인 metadata 보호). 통제 업로드 경로로 받은 경우도 처리 후 삭제.
- **RPC 8개(service_role 전용 DEFINER, search_path='')**: create / mark_received / complete / fail / decide_rights / archive / list(경로 없는 metadata) / authorize_signing. 매번 D1 + 소유권 + expected row_version.
- **서명 승인**: 미보관·ready·권리 approved·`rights_valid_until > now()+TTL`·허용 채널·변형 소속·**고정 sha256 일치**·D1 재검사 → 승인 기록(URL 없음) → 앱이 Storage 서명(TTL 앱 정책 600초, 최대 900초). 서명 실패면 `signing_failed`(URL 없음). Meta 결과와 무관하며 공급자 성공을 주장하지 않는다.
- **공급자 실행기 계약**: `PinnedMediaRef {assetId, variantId, sha256, width, height, byteSize}` — 작업·시도에 고정해 두고 서명 때 sha256 대조(다른 변형으로 바뀌면 VARIANT_MISMATCH).
- **리비전 미디어 호환**: 마이그레이션 시 고아 참조 수 NOTICE(자동 삭제 없음) → FK `NOT VALID`(asset·variant) → 새 INSERT 트리거(ready·미보관 자산, 같은 자산 변형만). 참조된 자산은 보관 거부(ASSET_REFERENCED), 자산·변형·결정 삭제는 항상 금지.
- **Storage bucket 계약(실행 안 함, migration 머리 주석)**: `distribution-media`, public=false, 8MB, `image/jpeg`만, storage.objects 정책 없음(서버 service_role만).

## 3. 이미지 처리(서버 Node sharp 0.35.5 / libvips 8.18.7)
- 입력은 **바이트만**(외부 URL fetch 없음 → SSRF 없음). magic으로 JPEG·PNG·WEBP 판정(확장자·Content-Type·파일명 불신), sharp 실제 형식과 불일치 거부.
- 앱 상한(보수적): 입력 ≤20MB, 픽셀 ≤4천만(`limitInputPixels`+명시 검사, 압축 폭탄 방지), 애니메이션 거부(pages>1), `failOn: error`(손상 거부), 처리 timeout 10초, 출력 ≤7MB, 폭 1440으로 축소·320 미만 거부, 비율 0.8~1.91 밖은 자동 자르기 없이 거부.
- 플랫폼 상한(021 공식 근거): JPEG·≤8MB·4:5~1.91:1·폭 320~1440·sRGB — DB check는 플랫폼 상한, 앱 정책은 그보다 좁게.
- 변환: EXIF 방향 적용(`rotate()`) → 축소 → 흰 배경 평탄화 → sRGB → JPEG q88. JPEG 입력도 항상 재인코딩(키트는 JPEG를 그대로 통과시켜 metadata가 남았음) → EXIF·ICC·XMP 제거, 출력 재검사(형식·폭·metadata 없음), sha256·바이트·폭·높이 기록.

## 4. 검증
| 항목 | 결과 |
|---|---|
| media-run.mjs (PGlite, 000000~120000 13개) | 5/5 |
| 단위 media.test.ts(실제 합성 fixture) | 11/11 |
| dry-run-exec 7 · oauth 6 · connections 5 · threads-connect 3 · blog-flow 5 · content-connect 2 | 통과 |
| m2-run 334/334 · token-run 78/78 · handoff-run 91/91 · handoff-review-run 105/105 | 통과 |
| **run.mjs** | **실패(그룹 4에서 중단)** — 아래 |
| vitest 전체 | 25 files · 522 passed · 33 skipped(PGlite 전용) |
| tsc / lint / build | 0 / 0 error(범위 밖 기존 경고 3) / 성공 |

- **run.mjs 회귀(정확히 보고)**: 다른 담당의 기존 러너 그룹 4가 실제 자산 없이 임의 asset_id로 리비전 미디어 3개를 넣는데, M4가 의도적으로 추가한 검사(존재·ready 자산만, FK)에 걸려 `23514 MEDIA_NOT_READY` → 러너가 이후 그룹을 실행하지 못하고 중단. 120000만 뺀 임시 복사본에서는 209/209 통과를 확인(원인 = M4 검사 확정). 이번 범위상 run.mjs는 수정하지 않았다. 해결 선택지(Master/Backend 결정): ① run.mjs 픽스처를 ready 자산 생성 뒤 참조로 갱신(권장) ② M4 리비전 검사를 완화(비권장 — FK 호환 목표와 충돌).
- PGlite 확인: 테이블 4개 anon/authenticated/service_role 42501, RPC 8개만 service_role·helper 회수, 비승인 denied, 업로드→processing→ready·경로 DB 생성·목록에 경로/서명 없음·타 소유자 비노출, 생성 열 변경 불가, 손상 → failed(DECODE_FAILED)·비율 → failed(ASPECT_OUT_OF_RANGE), 권리: 타 소유자 not_found·버전 충돌·권리 없으면 서명 거부(서명 호출 0)·승인 후 서명 1회·승인 기록에 URL/토큰 없음·TTL ≤600초·채널 밖 CHANNEL_NOT_ALLOWED·sha256 변조 VARIANT_MISMATCH·유효기한 < TTL RIGHTS_EXPIRED·철회 후 거부·이력 불변·자산 삭제 거부·실패 자산 승인 거부, 리비전 미디어: 다른 자산 변형 VARIANT_MISMATCH·failed/없는 자산 MEDIA_NOT_READY·ready 자산 성공·참조 자산 보관 ASSET_REFERENCED·미참조 보관 후 서명 ARCHIVED·FK 2개 NOT VALID.
- 단위 확인: magic 판정(GIF·SVG 거부), 투명 PNG → 흰 배경 sRGB JPEG·metadata 없음, EXIF 방향 6 적용(900×800 → 800×900)·EXIF 개인 문자열 제거, 3000×2000 → 1440×960, 거부 10종(빈·과대·미지원·손상 JPEG·손상 WEBP·애니메이션 WEBP·7000×7000 픽셀·200×200·1000×300·600×1000), 서비스 호출 순서·원본 미저장·실패 시 fail RPC·업로드 실패·완료 유실 uncertain·D1/준비 전 RPC 0회·통제 경로 외 거부·서명 순서/가림/서명 실패 URL 없음/이상 경로 bad_response/TTL 상한.

## 5. 한계·미검증
- Storage는 메모리 mock: 실제 Supabase Storage 업로드·bucket 정책·서명 URL 만료·크기 제한 동작 미검증. 실 어댑터(`MediaStorage` 구현) 미등록.
- 고아 객체: 변형 업로드 후 DB 완료 응답 유실 시 `uncertain` — 고아 객체 정리 작업 미구현. 업로드 취소(요청 중단) 처리 없음(현재 서버 함수 단위 처리).
- 고아 참조 사전 점검은 NOTICE만(빈 PGlite라 실제 고아 사례 시험 못함). 실제 DB 적용 전 `distribution_draft_revision_media` 고아 조회 권장.
- sharp 실행 제한은 처리 timeout·픽셀 상한뿐(동시 처리 수·메모리 상한·워커 격리 없음). Vercel 함수 메모리·시간 안에서의 실측 없음.
- 게시 한도·Meta가 서명 URL을 가져가는 시간 등 공급자 측 동작 미검증. 권리 결정은 사람이 기록하는 사실이며 법적 판단이 아니다.

## 6. 남은 일(인계 대상)
- **Backend**: run.mjs 픽스처 갱신 조정, 실 Storage 어댑터(service_role 클라이언트)·bucket 생성 운영 절차, 고아 객체 정리, live gate 미디어 조건(연결·권리·변형 고정), Instagram 실행기에서 PinnedMediaRef 고정·서명.
- **Front(이 세션)**: 미디어 화면(업로드 폼·상태·권리 결정·보관)은 Master 지시 후 — 지금 UI 없음.
- **Instagram OAuth**: Threads OAuth-019 구조 재사용(oauth_states channel 확장 SQL, 공식 문서 재대조, env `INSTAGRAM_APP_ID`·`INSTAGRAM_APP_SECRET`) — Backend 범위.
- 공개 release: `media/process.ts`는 키트 파일 참고 고지가 있어 저장소 private 전 커밋 제외 권장. 나머지 media 파일·SQL은 자체 코드.
