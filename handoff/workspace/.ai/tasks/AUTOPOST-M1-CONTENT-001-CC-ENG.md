# AUTOPOST-M1-CONTENT-001 — 배포 콘텐츠·승인 migration 구현

- 작업 ID: AUTOPOST-M1-CONTENT-001
- 담당: Claude Code 엔지니어
- Master: CX-MASTER-01
- 결정: `.ai/decisions/DEC-AUTOPOST-DATA-001.md`
- 요구사항: `docs/AUTOPOST_INTEGRATION_PLAN.md` §2.2, `.ai/results/AUTOPOST-DATA-001-CC-ENG.md` §3.1, §7, §9 M1
- 변경 범위: `web/supabase/migrations/`에 M1 migration 파일 하나만 추가
- 제외: 웹 UI/서버 TS 코드, 이후 M2 jobs·attempts·secrets·provider integrations, 기존 migration 수정, root docs 변경

## 목적

배포 전용 admin 권한 경계를 포함한 배포 원문 버전, 채널 초안 리비전, 승인 기록의 추가 전용 DB migration을 구현한다. 이 migration은 콘텐츠/승인 저장 기반만 만든다. 실제 게시 및 사용자가 누르는 화면은 이 작업에 포함하지 않는다.

## M1 포함 범위

- 새 `private.is_distribution_admin()` 판정: 기존 admin 역할 + 승인 상태 approved. 기존 `private.is_admin()` 및 공용 role 함수는 변경하지 않는다.
- `public.distribution_contents`, `distribution_content_versions`, `distribution_channel_drafts`, `distribution_draft_revisions`, `distribution_draft_revision_media`, `distribution_approvals`.
- 기존 `public.set_updated_at()` 재사용. 기존 `profiles`, `role_assignments`, `audit_events` 열/check/함수를 수정하지 않는다.
- 모든 신규 테이블에서 RLS 활성화. anon/비관리자 접근 금지. 승인된 distribution_admin에게 필요한 `SELECT`만 명시 열로 부여하고 정책에 같은 전용 권한 함수를 적용한다.
- anon/authenticated에는 클라이언트 `INSERT/UPDATE/DELETE` 권한을 주지 않는다. M1에는 아직 서버 쓰기 API/function이 없으므로 모든 쓰기는 추후 migration에서 추가한다.
- 불변 버전·리비전·승인에는 UPDATE/DELETE를 거부하는 보호를 추가한다. content/draft head는 포인터/메타데이터만 저장하고 승인 불변 기록을 고쳐 쓰지 않는다.
- `content_hash`/`revision_hash` 검증을 DB에서 가능한 범위와 서버 측 요구사항을 분리한다. DB가 신뢰 검증을 못 하는 해시 계약은 앱이 보낸 값만 믿지 말고 후속 server function에서 재계산하도록 명시한다.
- 키트/일반 테이블과 충돌 없는 이름. 배포 공용 `set_updated_at`을 덮어쓰지 않는다. Migration은 additive이며 기존 기능 동작을 바꾸지 않는다.

## 구현 전 필수 절차

- `web/AGENTS.md`의 요구에 따라 migration 작성에 필요한 기존 Supabase migration/role 함수 패턴을 확인한다. Next.js TS 코드를 수정하게 되면 `web/node_modules/next/dist/docs/`의 해당 가이드를 먼저 읽고 보고한다.
- 현재 Git 변경사항을 확인하고 다른 사람의 파일은 건드리지 않는다. 변경 파일 하나로 범위를 제한한다.
- 프로젝트 migration timestamp/파일명 규칙 및 실제 `profiles.approval_status`, 역할 함수 시그니처, grants/RLS를 근거 파일과 대조한다.

## 금지

- SQL을 Supabase 원격/로컬 DB에 적용하지 않는다.
- 테스트, DB 검증(PGlite 포함), 빌드, 설치, deploy, secret 조회, API 호출을 실행하지 않는다.
- 기존 migration 수정/정리, code generator, SQL 테스트 파일 추가 금지.
- D1 이외의 미결정(D3-D14)을 임의로 결정하지 않는다. service-role 함수는 M1에 만들지 않는다.
- `API KEY.txt`, 비밀번호 파일, `.env*` 값을 읽거나 보고서에 넣지 않는다.

## 완료 조건/보고

- 새 migration 한 파일만 변경하고 UTF-8 텍스트로 제출.
- 권한 매트릭스, immutable data, FK/index/check/grants/RLS, 기존 함수와의 호환을 정적 검토해 완료 보고서에 요약한다.
- SQL/테스트/DB를 실행하지 않았음을 명시하고, 실행 전 남은 위험/가정/필요한 별도 테스트를 적는다.
- 코드를 push/deploy하지 않는다. 완료 후 worker_done으로 Master에게 알린다.
