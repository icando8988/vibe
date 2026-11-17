# MKT-003 — 배포 공통 계약·이식 준비

- 책임 CC-ENG-01 / Master 지시 msg_8efd6ef290bd (Orca task_b2907390e494 안에서 전환) / 2026-11-16
- 상태: **ready_review**
- 입력: .ai/tasks/MKT-003-CC-ENG-01.md, docs/MARKETING_DELIVERY_PLAN.md, DEC-MARKETING-001
- 선행 DEV-003은 상태를 보존하고 중단: .ai/results/DEV-003-CC-ENG-01.md, docs/DB_VERIFICATION.md (DB 실행 검증 미실행, 실행기 없음)

## 변경 (허용 범위만)

- `web/src/lib/distribution/` (기존 의존성만 사용, 외부 호출 없음)
  - `types.ts` — Channel(blog/threads/instagram), ContentItem, ChannelDraft(원문 버전 기록), PublishJob, PublishResult, AdapterCapabilities(supported/unsupported/unverified, limits null)
  - `result.ts` — 배포 전용 Result·오류 코드(판매 도메인과 분리)
  - `idempotency.ts` — 멱등키 `pub:{contentId}:v{version}:{channel}:{mode}`, 중복 판정(같은 키 비취소 작업, 이전 버전 게시 채널의 재게시는 명시 확인)
  - `jobs.ts` — 생성(승인·최신 버전·시간대 있는 미래 예약·UTC 저장), isDue/startDispatch, applyResult, retryFailed, reconcileUnknown, cancelJob, summarizeBatch
  - `utm.ts` — 기준 URL 미확정이면 거절, https·내부 경로·기존 UTM 충돌·값 형식 검증, 기본 캠페인명 없음
  - `adapters.ts` — UnconnectedAdapter(live 전부 NOT_CONNECTED), DryRunAdapter(dry_run만 미리보기), 모든 capability unverified, requireCapability
  - `index.ts`
- `web/tests/distribution/jobs.test.ts`, `adapters-utm.test.ts`
- `docs/AUTOPOST_IMPORT_ANALYSIS.md` — 분석 보고 양식(입력/버전/라이선스/실행환경/인증/API·브라우저 자동화/예약/중복/재시도/배포 호환성/시험/보안·이식 판정), 전부 미수령·미확인
- app/components/styles/DB/package/lockfile/공용 .ai 미변경

## 핵심 규칙(시험으로 고정)

- `published`는 live 모드 + 비어 있지 않은 외부 식별자일 때만. dry-run 결과는 `dry_run_succeeded`, 게시 수 집계에서 제외. live 작업에 모의 결과·모의 작업에 게시 결과 반영은 MODE_MISMATCH.
- 응답 유실 `unknown`은 바로 재시도·취소 불가(RECONCILE_REQUIRED). 대사 결과 found_published → published, confirmed_absent → 재시도 가능 failed, still_unknown → 유지.
- 사전 거절(미연결 등)은 retryable을 강제로 false. 실패 재시도는 어댑터가 retryable=true로 표시하고 최대 시도 횟수 안일 때만.
- 콘텐츠+버전+채널(+모드) 중복 요청 거절. 원문 버전이 바뀌면 옛 초안 거절(STALE_DRAFT).
- 부분 성공: partial / needs_reconcile / all_published / none_published / pending / dry_run_only.
- 예약: 시간대 없는 시각·과거 시각 거절, UTC로 정규화(+09:00 입력 → Z).

## 검증 (D:/Vibe/web)

| 명령 | 결과 |
|---|---|
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd test` | exit 0, 6 files / 86 tests (기존 57 + 배포 29) |
| `npx eslint src/lib tests` | exit 0 |

미실행: 실제 공급자 연동·게시(금지 범위), 앱 화면 연결(UI·Master 범위), DB 저장(배포 테이블 미설계 — 판매 DB와 분리 원칙에 따라 후속).

## 남은 입력 / 후속

1. 자동포스팅 프로그램(경로·버전·실행 환경·채널별 계정 유형) 수령 → 양식 작성 → 이식 방식 결정(Master).
2. 공개 사이트 주소 확정 전에는 UTM 링크 생성 불가(의도된 거절).
3. 채널별 capability는 공식 자료·프로그램 분석으로 확인한 항목만 supported로 변경.
4. 배포 작업 저장소(DB 테이블/큐) 설계는 프로그램 구조 결정 후. 관리자 화면 연결 시 ContentDistributionPreview(MKT-002)와 타입 계약 조정 필요.
