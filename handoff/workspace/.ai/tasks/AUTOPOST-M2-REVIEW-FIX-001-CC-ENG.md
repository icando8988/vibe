# AUTOPOST-M2-REVIEW-FIX-001 — provider publish 전이 가드 보완

- 작업 ID: AUTOPOST-M2-REVIEW-FIX-001
- 담당: Claude Code 엔지니어
- Master: CX-MASTER-01
- 입력: `web/supabase/migrations/20261116040000_distribution_jobs.sql`, `.ai/decisions/DEC-AUTOPOST-DATA-001.md`
- 수정 범위: 기존 M2 migration 파일 한 개만

## Master 리뷰 지적

1. `distribution_complete_attempt()`의 `published`/`unknown` 처리에서 현재 attempt의 `publish_requested_at`가 설정됐는지 확인하지 않는다. publish 요청이 없었는데 worker API가 결과를 확정할 수 있다.
2. `distribution_advance_phase()`가 실제 저장된 컨테이너 상태가 `FINISHED`인지 확인하지 않고 `ready` 또는 `publish_requested`로 갈 수 있다. live 게시 전 외부 컨테이너 준비 완료 확인을 강제해야 한다.
3. live 게시가 reconciliation 또는 늦은 evidence로 `published`가 될 때 `phase=done`으로 종결되는지 확인하고, 모든 live published 진입 경로에서 일관되게 강제한다. manual published는 phase none 유지 가능.

## 요청

- 함수와 DB guard 둘 다 필요한 필수 불변조건을 적용한다. service_role API만 신뢰하는 검사는 충분하지 않다.
- 컨테이너 상태 조회를 다음과 같이 제한한다: IN_PROGRESS는 processing, FINISHED는 ready, ERROR/EXPIRED는 실패 후 새 attempt. 지원되지 않은 상태/역순/준비 미완료 publish는 거부한다.
- 게시 결과/unknown은 실제 publish 요청 시각 기록 이후에만 허용한다. 게시 요청 전 컨테이너 생성의 불확실성은 재게시 unknown으로 취급하지 않는다.
- 해당 상태 전이를 수행하는 reconciliation/late evidence 함수에서도 phase 제약을 일관되게 유지한다.
- 주석과 함수 인자 계약을 맞추고, 나머지 migration이나 DB 계약은 변경하지 않는다.

## 제약

- migration 파일 하나 외 수정 금지.
- SQL/DB/PGlite/테스트/빌드 실행 금지.
- app/API/계정/외부 호출/배포/secret 접근 금지.
- 완료 보고에 보강한 불변식과 남은 정적 한계를 적고 worker_done.
