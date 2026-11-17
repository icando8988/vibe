# AUTOPOST-LOCAL-DB-VERIFY-002 — distribution M0~M2+050000 로컬 DB 실행 검증 (CC-ENG)

- task_1c7c7cd810c0 / ctx_6a721861de50 · 2026-11-16 · 상태: **ready_review**
- 판정: Supabase 대역 + PGlite 환경에서 **migration 6개 순차 적용 성공, 시나리오 203/203 통과(종료 코드 0)**.
  이 결과는 **실제 Supabase 검증과 같지 않다**. 다중 연결 동시성도 검증하지 않았다(§5).
- SQL 결함: 이번 범위에서 **실패 재현 0건**. 다만 설계 관찰 2건을 제안으로 올린다(§4). SQL·앱·공용 문서는 수정하지 않았다.

## 1. 실행기 확보 (차단 해소)

| 항목 | 값 |
|---|---|
| 설치 위치 | `C:\Users\Administrator\AppData\Local\Temp\autopost-local-db-verify-002` (OS 임시, 독립 package.json) |
| 패키지 | 공식 npm `@electric-sql/pglite@0.5.16`(latest, Apache-2.0, 의존성 0) |
| 설치 명령/결과 | `npm install --no-audit --no-fund --save-exact @electric-sql/pglite@0.5.16` → `added 1 package in 2s`, exit 0 |
| 엔진 | `PostgreSQL 18.6 (PGlite 0.5.16)` wasm32, 인메모리, 단일 연결 |
| web/ 영향 | 없음. `web/package.json`·lockfile·`web/node_modules` 변경 없음(`web/node_modules/@electric-sql` 없음 확인) |
| 접근하지 않은 것 | 키·env·비밀번호, 원격 Supabase, 운영 DB, 외부 게시. 네트워크는 npm 설치에만 썼다 |

## 2. 재현 가능한 스크립트 (허용 경로에만 추가)

- `web/scripts/distribution-local-verify/supabase-local-standin.sql`: Supabase 최소 로컬 대역
- `web/scripts/distribution-local-verify/run.mjs`: 대역과 migration을 적용하고 시나리오를 실행한다. `--json` 결과 출력. 종료 코드 0, 1(실패), 2(migration 실패), 3(PGlite 없음, NOT RUN)
- `web/scripts/distribution-local-verify/README.md`: 설치와 실행 절차

```powershell
node web/scripts/distribution-local-verify/run.mjs --pglite-project $env:TEMP\autopost-local-db-verify-002 --json $env:TEMP\autopost-local-db-verify-002\result-final.json
```

### 대역(stand-in)이 흉내 내는 최소 범위

| 대역 | 내용 |
|---|---|
| `anon`, `authenticated` | nologin noinherit (PostgREST가 SET ROLE로 전환하는 역할) |
| `service_role` | nologin noinherit **bypassrls** |
| `supa_owner` | migration 실행·객체 소유 역할. **superuser 아님**(Supabase `postgres` 대응). DB CREATE, public 스키마 소유, auth.users에 SELECT·REFERENCES·TRIGGER |
| `auth.users` | id, created_at만 |
| `auth.uid()` | GUC `request.jwt.claim.sub` |
| 기본 권한 | supa_owner가 만드는 public 테이블·시퀀스·함수에 anon/authenticated/service_role ALL. Supabase의 위험한 기본값을 재현했고, 대조군으로 실제 부여되는 것을 확인했다 |

흉내 내지 않는 것: GoTrue, JWT 서명, PostgREST 경로·`select=`, auth.users 전체 열과 소유자(supabase_auth_admin), supabase_admin 소유 객체, storage/vault/pgsodium, 이벤트 트리거, Supabase PG 버전(15/17), 다중 연결.

## 3. 실제 명령, 종료 코드, 결과

| 실행 | 종료 코드 | 결과 |
|---|---|---|
| 1차(대조군 추가 전) | 0 | 199/199 |
| 2·3차(대조군과 판정기 자기 점검 추가, 2회 반복) | 0, 0 | 201/201, 201/201 |
| `--pglite-project <없는 경로>` | **3** | `NOT RUN` 출력. 처음엔 상위 node_modules로 해석되는 문제가 있어 지정 디렉터리 안의 설치만 인정하도록 고쳤다 |
| 최종(미디어 오류 문장 확인과 관찰 P-1 추가) | **0** | **203/203** |

migration 적용(owner `supa_owner`, 비superuser): 000000 39ms, 010000 1ms, 020000 1ms, 030000 35ms, 040000 55ms, 050000 9ms. 모두 오류 없음.

| 그룹 | 통과 | 핵심 확인 |
|---|---|---|
| 0 대역 + 적용 | 13/13 | 파일 6개 순서, M1 owner=supa_owner, 기본 권한 대조군(새 객체에 anon 권한이 실제로 생김), 가입 트리거로 profiles(pending) 7행 |
| 1 D1 actor | 21/21 | admin+pending, admin+suspended, admin+rejected, 역할 없는 승인 회원, seller, 없는 uuid, null → 42501, 행 0. 정지 actor는 8개 API와 M2 create_job 모두 42501. 승인 → 정지 → 재승인 → 역할 회수 순으로 즉시 거부·허용이 반영됨 |
| 2 ACL | 41/41 | API 8개 EXECUTE는 service_role만(PUBLIC/anon/authenticated 없음), helper 10개는 owner만. 실제 호출: anon, authenticated(admin JWT) 42501, service_role의 helper 호출 42501. service_role 직접 INSERT/UPDATE/DELETE/TRUNCATE 42501, SELECT 허용. authenticated: 승인 admin만 행이 보이고 pending·suspended·일반 회원은 0행, anon 42501, `created_xact_id` 열과 `select *` 42501 |
| 3 버전 충돌 | 24/24 | 같은 expected 재요청, null, 미래 값 → `VERSION_CONFLICT`. 이전 버전 기준 리비전 → `STALE_CONTENT_VERSION`. 리비전 → `REVISION_CONFLICT`. 실패 뒤 부분 쓰기 없음. superuser 포인터 되감기와 버전 UPDATE는 트리거가 23514로 거부 |
| 4 초안·미디어 원자성 | 22/22 | 미디어 3개 position 1..3, 대문자 uuid는 소문자로 정규화. 잘못된 미디어 7종과 utm·link 오류는 거부되고 리비전·포인터·미디어 수 불변. 다음 트랜잭션의 미디어 사후 추가는 23514. 같은 트랜잭션에서 리비전 성공 뒤 오류가 나면 전체 롤백. 스칼라 원소는 VERIFY-001에서 고친 의도한 문장("media items must be json objects")으로 거부됨 |
| 5 해시 | 11/11 | **DB content_hash와 revision_hash가 node:crypto로 명세를 독립 구현한 값과 일치**(미디어 3, utm 2). 결정성 확인. NULL과 '' 구분, 본문·미디어 순서 변경 시 해시가 달라짐. 길이 접두로 경계 혼동 없음. jsonb 키 순서는 무관. 1과 1.0은 다른 해시(명세대로) |
| 6 승인·반려·철회 | 31/31 | `CHECKLIST_INCOMPLETE`(빈 객체, false), `SUBJECT_CHANGED`, `NOT_LATEST`, `ALREADY_APPROVED`, `DECISION_IN_SAME_TRANSACTION`(롤백 후 0건). 반려 → 승인, 철회 → 유효 승인 null, `ALREADY_REVOKED`. 반려와 철회 행은 철회 불가. approvals UPDATE/DELETE 거부. 새 버전으로 승인이 옮겨 가지 않고, 이전 버전 기준 리비전 결정은 `STALE_CONTENT_VERSION` |
| 7 M2 연결 | 20/20 | 승인 전 `NOT_APPROVED`, live → `LIVE_GATE_CLOSED`(0A000), threads manual 거부, dry_run 생성, `DUPLICATE`, 이벤트 seq=1. 새 버전 뒤 claim → hold `stale`, 승인 철회 뒤 → hold `approval_revoked`, 근거가 정상인 작업은 attempt 1로 claim |
| 8 보관 | 14/14 | 초안과 원문 보관 뒤 리비전·버전·초안 추가와 결정 → `ARCHIVED`, 재보관 → `ALREADY_ARCHIVED`. 보관 뒤에도 철회는 허용. 이력 2행, 이력 UPDATE 거부 |
| 9 변조 탐지 | 6/6 | superuser가 append-only 트리거를 끄고 원문 본문·리비전 utm을 바꾸거나 미디어를 지우거나 순서를 바꾸면 결정 시 `HASH_INTEGRITY`(XX001), 승인 0건. 관찰 P-1 1건(§4) |

## 4. SQL 관찰과 수정 제안 (결함 실패는 재현되지 않음. Master가 후속 배정 여부 판단)

- **P-1 (설계 관찰, 중간)**: 해시 재계산은 `distribution_decide_approval`에서만 한다. 그래서 승인이 끝난 뒤 트리거를 우회해 변조하면(superuser/owner만 가능) `distribution_create_job`과 `distribution_claim_jobs`가 저장 해시끼리만 비교하는 `distribution_job_basis_problem`(040000 §2)을 통과한다.
  - 재현: run.mjs 그룹 9 마지막 "관찰" 항목. 승인 → 리비전 body 변조 → create_job(dry_run)이 성공한다.
  - 제안: create_job과 claim(최소한 live claim)에서 `distribution_recompute_subject_hash`로 리비전과 원문 버전을 재계산해 불일치하면 hold나 거부로 처리한다(새 forward migration으로 basis_problem에 `hash_integrity` 코드 추가). 비용은 작업 1건당 해시 2회다.
- **P-2 (이론적, 낮음)**: `DECISION_IN_SAME_TRANSACTION` 판정은 `a.created_at = now()`를 쓴다(050000 decide_approval). 서로 다른 트랜잭션의 시작 시각이 µs까지 같으면 오탐할 수 있다. 단일 연결 환경이라 재현하지 못했다.
  - 제안: `distribution_approvals`에 `created_xact_id xid8`(M1 리비전 패턴)를 추가해 xid로 비교한다.
- 확인된 문서화 한계(동작이 주석과 일치): 보관된 초안이 있으면 같은 채널 새 초안은 `DUPLICATE`, 보관 뒤 철회 허용(fail-safe).

## 5. 미검증 범위

1. **다중 연결 동시성**(PGlite 한계): FOR UPDATE/FOR SHARE 직렬화, 같은 expected 동시 요청 중 하나만 성공, 승인 도중 새 버전 경합, claim `SKIP LOCKED` 중복 방지, 교착 부재. 충돌 검사는 순차 재요청으로만 확인했다. 실제 PostgreSQL에서 두 세션 시험이 필요하다.
2. **실제 Supabase**: PostgREST /rpc 노출과 `select=`, JWT 역할 전환, 실제 `postgres` 역할 속성, supabase_admin 기본 권한, Supabase PG 15/17에서의 xid8·sha256·collate "C" 동작. 이번 엔진은 PG 18.6이다.
3. M2의 나머지 상태 전이(advance_phase, complete_attempt, 수동 증거, 대사, rerun, 증거 정정)는 이번 범위(M1 쓰기 API와 연결 지점) 밖이라 create_job과 claim만 실행했다.
4. 앱 서버 코드와의 연동, 자기 승인 정책, 필수 체크리스트 키(미결정).

## 6. 변경 파일

- 추가: `web/scripts/distribution-local-verify/{run.mjs, supabase-local-standin.sql, README.md}`, 이 결과 파일.
- 수정 없음: migration SQL 6개(sha256 앞 8자리: 000000 ff0f51e5, 010000 83f38a93, 020000 95e341c3, 030000 352639dc, 040000 afa98965, 050000 02f9ffb0), 앱, 공용 문서, web/package.json, lockfile, node_modules.
- 임시(저장소 밖): 위 임시 프로젝트, `run-*.log`, `result-*.json`.
