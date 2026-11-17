# AUTOPOST-M1-VERIFY-001 — M0~M2+050000 로컬 검증 (CC-ENG)

- task_66e9d8bd42b7 / ctx_eca237cdaa31 · 2026-11-16 · 상태: **미완료 (실행 검증 0건)**
- 사용량 한도에 도달해 작업을 중간에 멈췄다. 검증 스크립트 `web/scripts/distribution-m1-verify.*`는 **작성하지 않았다**.

## 1. 환경 확인 (실제 실행한 명령, secrets/env 읽지 않음)

| 확인 | 결과 |
|---|---|
| `which psql postgres pg_ctl initdb docker` | 모두 없음 |
| `C:\Program Files\PostgreSQL` | 없음 |
| `wsl.exe -l -q` | 설치된 배포판 없음(설치 안내만 출력) |
| `web/node_modules`의 `@electric-sql/pglite`, pg-mem, embedded-postgres | 없음 |
| npm-cache, pnpm, bun, Programs, D:\ 최대 깊이 10 검색(`*pglite*`, `postgres.exe`, `pg_ctl.exe`) | 없음 |
| npm `_cacache` 색인에서 pglite, embedded-postgres 검색 | 없음 |
| node | v26.13.0 사용 가능 |

결론: 사용할 수 있는 로컬 PostgreSQL이나 PGlite 실행기가 없다. 패키지 설치는 금지되어 있으므로 **migration 적용과 시나리오는 하나도 실행하지 않았다.**

## 2. 결함 및 수정 (정적 재검토)

- `distribution_normalize_media`: 원소가 객체인지 확인하는 조건과 `jsonb_object_keys(m.e)`가 같은 WHERE의 OR로 묶여 있었다. SQL의 OR는 평가 순서를 보장하지 않으므로, 스칼라 원소가 들어오면 의도한 `invalid_parameter_value` 대신 다른 22023 오류가 날 수 있다.
  비객체 검사를 앞선 별도 문장으로 분리해 수정했다(050000 migration, 주석 포함). 이 수정도 실행으로 확인하지는 않았다.

## 3. 남은 일 (다음 세션)

1. 격리 검증 스크립트를 작성한다. 계획한 설계:
   - `.sql`에 Supabase 스텁을 둔다: anon, authenticated, service_role(BYPASSRLS) 역할, 비superuser migration owner, `auth.users`, `auth.uid()`, 기본 권한 에뮬레이션.
   - `\ir`로 M0~M2+050000을 읽고, `verify.expect_error`(서브트랜잭션 롤백) 기반 시나리오를 실행한다. 대상 시나리오: actor 유효/비승인/정지, ACL, 버전 충돌, stale, 초안+미디어 원자성, 승인/반려/철회, 보관 차단, 해시 변조(트리거 비활성화 후 HASH_INTEGRITY), M2 dry_run create_job 연결.
   - `.mjs` 러너는 pglite가 없으면 `NOT RUN`을 출력하고 exit 3으로 끝난다. 설치는 하지 않는다.
2. 실행기를 확보하는 방법은 사용자나 Master가 결정해야 한다(PGlite 설치 승인, 또는 로컬 PostgreSQL 제공).
3. 동시성은 단일 연결 검증으로 통과를 선언할 수 없다. 다중 연결 시험이 별도로 필요하다.
4. 체크리스트 필수 키와 자기 승인 정책은 확정하지 않았다(지시대로).
