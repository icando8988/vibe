# AUTOPOST-M1-REVIEW-FIX-001 — migration 동시 트랜잭션 보장 보완

- 작업 ID: AUTOPOST-M1-REVIEW-FIX-001
- 담당: Claude Code 엔지니어
- Master: CX-MASTER-01
- 입력: `web/supabase/migrations/20261116030000_distribution_content.sql`, `.ai/decisions/DEC-AUTOPOST-DATA-001.md`
- 수정 범위: 기존 M1 migration 파일 1개만
- 상위 작업: `AUTOPOST-M1-CONTENT-001`

## Master 리뷰 지적

`distribution_draft_revision_media_before_insert()`가 부모 리비전의 `created_at = now()` 비교로 같은 트랜잭션에서만 미디어 추가를 증명하려 한다. PostgreSQL의 `now()`는 transaction timestamp이므로 서로 다른 트랜잭션이 같은 timestamp를 가질 수 있다. 이 값만으로 동일 트랜잭션을 엄밀히 보장한다고 주장할 수 없다.

## 요청

1. PostgreSQL/Supabase 지원 버전에서 안전하게 비교할 수 있는 트랜잭션 식별자 등으로 동일 트랜잭션 제약을 보완하거나, 더 단순하고 실제로 보장 가능한 데이터 모델로 바꾼다.
2. 트랜잭션 ID를 테이블에 저장한다면 사용자 API에 노출되지 않게 column grants를 조정한다. SQL 구조만으로 보장하기 어렵다면 보장 주장을 낮추고 검증을 M2 쓰기 함수로 옮긴다.
3. 불변식과 주석이 일치하도록 수정한다. 나머지 migration 범위와 파일 수는 유지한다.

## 제약

- SQL/DB/PGlite/테스트/빌드/설치/API 호출 실행 금지.
- 다른 파일, 기존 migration, 앱 코드, 문서는 수정하지 않는다.
- 비밀 파일/환경변수는 읽지 않는다.
- 완료 시 정적 근거와 미해결 한계를 간단히 보고하고 worker_done.
