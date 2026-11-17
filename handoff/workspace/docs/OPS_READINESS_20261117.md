# 운영 반영 사전 점검 — OPS-READY-033

2026-11-17 · CX-MASTER-01 · 로컬 준비 문서. 실제 Supabase/Storage 접속·적용·배포는 수행하지 않았다. 기준 HEAD 8f0691c, 미커밋 Front/Backend 변경 포함. 최종 반영 대상 SHA는 담당 결과 통합 후 확정한다.

## 현재 판정과 담당

| 구간 | 확인된 상태 | 다음 증거/담당 |
|---|---|---|
| Front metadata/권리/보관 | Front029 결과 644 pass/skip 0 보고, Design031 소스 검토 | Front032 안내 2건, 승인 관리자 브라우저 실측 |
| Front032 | 시작 실패 agent-hooks-review-prompt, liveness unverifiable | hooks 검토 해소 및 기존 Task 복구 가능 여부 확인 / Master |
| Backend030 | 소비 후 고착 복구 SQL·래퍼·시험 작성 중 | 담당 최종 결과 및 통합 검토 / Backend→Master |
| 운영 DB | 적용 이력·객체 대조 미실행 | 아래 읽기전용 SQL 결과 / 운영 접근 권한 보유자 |
| private Storage | 실제 bucket·정책·브라우저 전송 미검증 | 아래 실측 목록 / Backend·Front |
| 자동 정리 | 만료·고착 RPC는 코드에 존재, 호출 주체 없음 | 운영 주기·실행 제한·경보 설계 / Master·Backend |

담당 시험 수치는 해당 보고의 결과다. 이 문서 작성 과정에서 전체 시험을 다시 실행한 결과가 아니다. 업로드 UI 비활성 및 live 게시 gate 닫힘 상태를 유지한다.

## DB 대조와 반영 묶음

저장소 루트의 `supabase/migrations`에 000000~140000까지 15개 파일이 있다. 기존 SQL Editor 적용 가능성이 있으므로 누락 버전만 보고 일괄 재적용하지 않는다. 우선 `scripts/distribution-local-verify/ops-readiness.sql`을 권한 있는 운영자가 대상 프로젝트 확인 후 실행한다. 이 스크립트는 읽기전용 트랜잭션이며 사용자 행·토큰·객체 경로를 조회하지 않는다. migration 이력 테이블이 없으면 트랜잭션 전체가 실패하므로, 이력을 별도 확인한 뒤 나머지 조회를 실행한다.

| 범위 | 코드 파일의 역할 | 운영 대조 |
|---|---|---|
| 000000~020000 | 기반·권한·프로필 | 기존 회원/승인 경계와 적용 이력 |
| 030000~080000 | 원문·작업·쓰기·확장 토큰·증거/복구·Blog 인계 | 기존 원문/작업 보존, RLS/RPC 및 Blog 확장 계약 |
| 090000~110000 | 채널 연결·OAuth state·모의 실행 | 기존 참조 정합성, 암호화 키 준비, live gate 닫힘 |
| 120000 | 미디어 자산·변형·권리 | 실제 테이블·함수·제약·private bucket 설정 |
| 130000 | 직접 업로드 grant | 발급/소비/취소/만료 함수, actor/nonce/버전 검증 |
| 140000 | 소비 후 고착 복구(진행 중) | 최종 Backend030 수락 전 반영 대상 확정 보류 |

반영 전 최종 SHA, 각 SQL 파일 SHA-256, 대상 프로젝트 식별자, 현재 DB 버전, 백업 시점·복구 담당을 기록한다. 새 SQL은 기존 파일 수정 대신 forward migration으로 다룬다. 실패 시 전체 앱을 바로 되돌리기보다 업로드 진입을 닫고 부분 적용/자산 상태를 먼저 확인한다. DB downgrade SQL과 Storage 자동 삭제는 준비되지 않았다.

## 설정 이름과 Storage

값은 기록하지 않는다. 현재 소스의 설정 이름은 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`다. Threads OAuth에는 `THREADS_APP_ID`, `THREADS_APP_SECRET`, `DISTRIBUTION_TOKEN_KEY`, `NEXT_PUBLIC_SITE_URL`이 추가된다. Instagram OAuth는 아직 연결 구현 완료로 판정하지 않으며, 추정한 변수만 등록해 준비 완료로 처리하지 않는다.

| bucket | 공개 여부 | 최대 바이트 | MIME |
|---|---|---|---|
| distribution-media-intake | private | 20971520 | image/jpeg, image/png, image/webp |
| distribution-media | private | 8388608 | image/jpeg |

설정 표는 `media/policy.ts`, `storage-supabase.ts` 및 120000/130000 계약 기준이다. 실제 bucket 값이 이와 일치하는지는 미검증이다. `mediaReadiness().directUpload`는 의존성 설정 준비도이고 `storageVerified`는 항상 false이므로 Storage 실측을 대체하지 않는다.

## 업로드 활성화 전 실측

1. 명시적인 테스트 프로젝트와 승인 admin 세션을 확보한다. 익명·일반 회원·다른 소유자의 목록/상세/쓰기 거부를 실제 HTTP 경로에서 확인한다.
2. grant→브라우저 PUT→complete 왕복을 실행한다. raw body 저장 MIME, CORS preflight, publishable apikey 필요 여부, MIME/크기 제한과 같은 경로 덮어쓰기 거부를 확인한다. secret key는 브라우저로 전달하지 않는다.
3. 완성 자산의 상태와 권리 승인을 따로 확인한다. 신고 형식 불일치·잘못된 이미지·기한 경과·이중 complete·cancel 경합·응답 유실을 확인한다. `uncertain`은 목록 확인으로 안내하고 자동 재전송하지 않는다.
4. intake 원본 삭제 시도와 실패 시 잔존을 확인한다. 앱 grant 900초와 Storage 서명 토큰 참고 수명 7200초를 구분한다. 취소 뒤 지연 업로드·변형 업로드 뒤 DB 실패에 생기는 고아를 시험한다. 토큰 수명/철회 동작은 계약의 미실측 전제다.
5. 미디어 목록/상세와 권리/보관 폼을 320/700/960px, 키보드, 확대, 충돌 후 새 탭 복귀로 확인한다. Front032 query notice와 참조 중 자산 거절 안내가 완료됐는지 대조한다.

근거는 시나리오·성공/실패·정제된 오류 코드·확인 시각·대상 버전으로 남긴다. 서명 URL·nonce·토큰·쿠키·개인정보는 증거 문서에 넣지 않는다.

## 만료·고착 복구와 다음 순서

`distribution_expire_media_upload_grants`와 `distribution_recover_stalled_media_uploads`는 서로 다른 대상(issued 만료 / consumed 고착)을 처리한다. 둘 다 운영 호출 주체가 없다. 140000은 service_role 전용, limit 1~500, stall 600~86400초이며 권장 stall은 900초다. 이 값은 진행 중 Backend030 계약 기준이고 최종 결과 검토 후 확정한다.

고착 복구는 완료 요청의 실행 상한이 강제되는 런타임을 전제로 한다. 현재 래퍼는 `runtimeEnforcesMaxDuration`이 false면 disabled다. `VERCEL=1` 표시만으로 실제 배포 설정 검증을 대신하지 않는다. 자체 호스팅에서는 자동 호출을 켜지 않으며 최소 lease/처리 소유권 같은 추가 보호가 필요하다. Storage 고아 sweep·실제 Cron·경보/실행 이력은 후속 작업이다. 단일 연결 PGlite의 순서 재현은 실동시성 검증이 아니다.

진행 순서: Backend030 반환/검토 → Front032 차단 해소/반환 → 변경된 최종 스냅샷 검증 → 운영 DB/Storage 대조 → Blog 실제 1건 추적 → 채널별 OAuth/live 검증. 메타데이터 관리 인수와 업로드/게시 운영 인수는 각각 증거를 남긴다.
