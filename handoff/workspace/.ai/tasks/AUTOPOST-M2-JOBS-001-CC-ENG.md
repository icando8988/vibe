# AUTOPOST-M2-JOBS-001 — 게시 작업·시도·증거 migration 구현

- 작업 ID: AUTOPOST-M2-JOBS-001
- 담당: Claude Code 엔지니어
- Master: CX-MASTER-01
- 결정: `.ai/decisions/DEC-AUTOPOST-DATA-001.md`
- 입력: `.ai/results/AUTOPOST-DATA-001-CC-ENG.md` §§3.3–5, 7–9, `docs/AUTOPOST_INTEGRATION_PLAN.md` §2.2, M1 migration `web/supabase/migrations/20261116030000_distribution_content.sql`
- 변경 범위: `web/supabase/migrations/`에 새 M2 migration 한 파일만 (`20261116040000_distribution_jobs.sql` 예정)

## 목표

M1 콘텐츠/승인 계약 위에 게시 작업, 단계별 시도, 불변 이벤트, 게시 증거, 대사 기록의 데이터 경계와 server-only DB mutation API를 추가한다. 예약 스케줄러, OAuth/연결/비밀, 미디어 파일 보관, UI와 provider HTTP 호출은 포함하지 않는다.

## 필수 불변조건

1. `live`, `dry_run`, `manual` 모드를 분리한다. Blog는 MVP에서 manual/dry-run만 허용한다. 상태에는 `manual_ready`, `awaiting_evidence`, `abandoned`를 추가한다.
2. job은 M1의 content version/draft revision/approval에 FK로 고정하고, 승인·버전·채널·실행 모드가 생성 후 바뀌지 않도록 한다. live 생성 시 최신 승인·해시·권리/validation 조건을 확인할 수 있는 인터페이스와 TODO/gate를 명시한다(연결/미디어 테이블은 아직 없으므로 필요한 검증을 후속 단계로 분리).
3. 같은 idempotency key 및 동일 콘텐츠/채널의 열린 작업이 중복 생성되지 않게 partial unique 제약을 구성한다. 기존 순수 함수 `makeIdempotencyKey`/`checkDuplicate`와 키·열린 상태 정의를 비교한다.
4. Attempt는 별도 행이며 provider container ID를 publish 요청 전에 커밋하는 단계 구조를 보존한다. 동일 컨테이너 ID를 다른 시도에서 재사용하지 않는다. API idempotency key가 지원된다고 가정하지 않는다.
5. 작업 상태·단계 전이는 허용 목록으로 가드하고, 이벤트를 같은 트랜잭션에서 append-only로 기록한다. published는 accepted evidence + 외부 식별자/URL이 있을 때만 허용한다. 경고는 `has_issues/issues`로 성공 사실과 별도 보존한다.
6. `unknown`에서는 자동 전이/재시도를 모두 금지한다. `confirmed_absent` 대사는 admin 확인자·검증 방법/범위·관찰 시각·근거가 있어야 한다. 부재 확인 후에도 자동 재게시 금지: 별도 admin rerun approval 이벤트와 새 attempt 필요.
7. Vercel/Supabase scheduler를 이 migration에 선택·구현하지 않는다. 작업 claim 함수의 원자적 인터페이스만 제안하고 scheduler 호출 주체는 D3 결정까지 비워 둔다.
8. anon/authenticated 쓰기 권한 없음. 배포 admin은 explicit column SELECT만. 데이터 변경은 service-role 전용 DB 함수/역할 경계. 함수가 actor ID를 입력받으면 admin 승인 상태/역할을 재검증한다. 모든 함수 `search_path=''`, 고정된 schema-qualified 이름, 최소 EXECUTE grant.
9. 기존 `private.is_admin`, `orders` 계약, `public.set_updated_at`, M1 migration을 변경/재정의하지 않는다.

## 검토 체크

- 실제 M1 열/제약명과 FK를 확인한 뒤 작성한다.
- FK 삭제 정책은 기존 감사 보존 계약과 일치시킨다.
- 함수/트리거 이름, SQL 보안 속성, service_role 권한 회수를 검토한다. SECURITY DEFINER가 필요하면 owner/search_path/EXECUTE grant를 주석으로 설명한다.
- `confirmed_absent`와 자동 retry 동작은 DEC-AUTOPOST-DATA-001을 따른다.
- `published_with_issues`는 상위 status `published` + issues 보조 정보로 구현한다.

## 제약

- SQL을 로컬/원격 Supabase에 적용하지 않는다.
- 테스트 파일 추가/수정 또는 테스트·PGlite·빌드 실행 금지.
- 앱 코드/UI, API/Meta 연결, scheduler cron, M3+ schema, secrets, 환경 파일을 다루지 않는다.
- 한 개 신규 migration 외 파일을 수정하지 않는다. 비밀 파일/환경변수는 읽지 않는다.
- 완료 보고에는 변경 파일, 핵심 권한/전이·중복 제약, 정적 검토 한계, DB 적용 전 필요한 별도 검증을 적는다. worker_done으로 보고한다.
