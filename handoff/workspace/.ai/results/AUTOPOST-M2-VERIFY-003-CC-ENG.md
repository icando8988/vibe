# AUTOPOST-M2-VERIFY-003 — M2 나머지 상태 전이 로컬 실행 검증 (CC-ENG)

- task_e74fa1a919af / ctx_1d0f2344dec6 · 2026-11-17 · 상태: **ready_review**
- 통신 오류로 한 번 중단됐다(msg_62ab57268a4f). 재개할 때 기존 파일(`lib.mjs`만 작성된 상태)을 확인하고 이어서 작성했으며, 덮어쓰거나 처음부터 반복하지 않았다.
- 판정: PGlite + Supabase 대역에서 **M2 기대 동작 304/304 일치(exit 0)**, **M1+050000 회귀 204/204(exit 0)**.
  **SQL 결함 2건 재현**(D-1, D-2/D-2b). SQL은 수정하지 않았다. **실제 Supabase 검증이 아니며 다중 연결 동시성은 검증하지 않았다.**

## 1. 실행

| 명령 | 종료 코드 | 결과 |
|---|---|---|
| `node web/scripts/distribution-local-verify/m2-run.mjs --pglite-project %TEMP%\autopost-local-db-verify-002 --json …\m2-result-final.json` | **0** | 304/304, 결함 재현 3항목(D-1, D-2, D-2b) |
| `node web/scripts/distribution-local-verify/run.mjs --pglite-project … --json …\result-regress.json` | **0** | 204/204(기존 203 + 추가 migration 060000 적용 1행) |
| `m2-run.mjs --pglite-project <없는 경로>` | **3** | NOT RUN |

- 기존 임시 설치(`@electric-sql/pglite@0.5.16`, PostgreSQL 18.6)를 그대로 썼다. 새로 설치한 것은 없고 네트워크도 쓰지 않았다.
- 실행 도중 다른 세션이 `20261116060000_distribution_extension_tokens.sql`과 `token-run.mjs`(BLOG-TOKEN-005)를 추가했다. 두 러너 모두 060000까지 포함해 순서대로 적용했고, M2 결과는 영향을 받지 않았다. `token-run.mjs`는 건드리지 않았다. 그 러너가 `lib.mjs`를 import하므로 lib의 export는 바꾸지 않았다.
- 1차 실행에서 나온 불일치 5건은 모두 **시험 기대값 오류**였고, SQL 동작이 명세와 일치함을 확인한 뒤 기대값을 고쳤다.
  - dry_run 단계를 건너뛴 시험 순서
  - 지난 단계로 돌아가면 22023이 아니라 단계 역행 23514가 먼저 난다
  - operator_manual 정정에 외부 ID만 있으면 방법 메모가 필수다
  - M1 트리거 함수의 EXECUTE는 관찰 O-1로 분리했다
  - migration 개수 가정을 고쳤다

## 2. 시험 전용 대역 조작 (일회성 DB 안에서만, SQL 파일 불변)

- **live 게이트 override**: migration의 `distribution_live_gate()`는 항상 false라 live 작업을 만들 수 없다. 그래서 그룹 0에서 원래 게이트가 닫혀 있음(`LIVE_GATE_CLOSED`)을 먼저 확인한 뒤 `select true`로 바꿨다. 그룹 5~7의 live 결과는 **게이트가 열렸다고 가정했을 때의 상태 기계 검증**이다. 연결, 권리, capability 같은 실제 게이트 조건은 검증하지 않았다.
- **리스 만료**: 시간을 조작하지 않고 실제 대기로 만들었다(lease 10초와 30초, 대기 11.5초 3회와 약 18초 1회).

## 3. 시나리오 결과 (그룹별)

| 그룹 | 통과 | 실행한 전이와 거부 |
|---|---|---|
| 0 적용·ACL·게이트 | 13/13 | migration 7개 순차 적용. SECURITY DEFINER distribution API **전부 service_role만** EXECUTE. 비DEFINER helper는 0개. M2 테이블에 대한 service_role 권한은 SELECT만. 원래 live 게이트는 닫혀 있음 |
| 1 Blog manual | 51/51 | manual_ready → awaiting_evidence → **증거 수락 published**(phase none, 캐시=증거, recorded_by=admin). 정지 admin·회원 actor, VERSION_CONFLICT, expected null, 잘못된 단계(INVALID_TRANSITION) 거부. **URL 허용 규칙**: example.com, `blog.naver.com.evil.com`, http, userinfo, ID·URL 둘 다 없음, 미래 observed_at 거부. **외부 ID 근거**: 방법 메모 없이 ID만 있으면 거부, 메모가 있으면 수락. **동일 게시물**: 같은 URL, 같은 계정+ID는 EVIDENCE_CONFLICT, 다른 계정의 같은 ID는 별개 게시물로 수락. **정정**: 사유 누락, 허용 외 호스트, 다른 작업 게시물, stale version, 정지 admin 거부. 정상 정정은 published 유지, 이전 증거 superseded, supersedes 연결. 재게시는 확인 플래그가 없으면 REPUBLISH_CONFIRMATION_REQUIRED |
| 2 abandoned 키 | 21/21 | 사유 누락이나 외부 잔존 미확인이면 거부. manual_ready → abandoned, awaiting_evidence → abandoned. **abandoned는 키를 점유**해 같은 리비전 manual 재생성이 DUPLICATE. cancelled는 키를 해제. abandoned 작업은 취소·선언 불가. 늦은 증거는 플래그만 세우고, 수락은 불가, 반려하면 해제 |
| 3 unknown·대사·operator_only | 34/34 | awaiting_evidence → unknown(MANUAL_OUTCOME_UNCERTAIN). worker의 confirmed_absent, operator_manual, container_status 기반 found_published, actor id 지정 거부. admin의 범위(period)·관찰 근거 누락 거부. still_unknown 기록. **confirmed_absent → failed(operator_only, CONFIRMED_ABSENT)**. 자동 재시도 거부. **재실행은 confirmed_absent 대사 ID를 인용해야만** 가능(ID 없음, 다른 대사 ID, 정지 admin, stale version 모두 거부). 재실행 → manual_ready, 이벤트에 대사 ID 기록. manual found_published(허용 URL)도 확인 |
| 4 dry_run·retry·취소 | 53/53 | 다른 워커는 LEASE_NOT_HELD, 잘못된 worker id·단계 건너뛰기·dry_run 컨테이너 ID와 상태·잘못된 attempt 거부(**모두 롤백 확인**). dry_run의 published는 MODE_MISMATCH, unknown은 거부. **dry_run_ok → dry_run_succeeded/done**. **auto**: error 형식, policy 누락, auto+autoRetry=false 불일치 거부. requeue → attempt 2. 한도에 닿으면 RETRY_NOT_ALLOWED, operator 재실행 거부. **never**: 두 경로 모두 거부. 예약과 재예약(VERSION_CONFLICT, 과거 시각 거부), 회원 취소 거부, 취소 후 키 해제. **dispatching 취소 요청**은 version을 한 번만 올리고, 이후 publish 요청은 CANCEL_REQUESTED, 워커가 취소를 존중 |
| 5 live | 78/78 | **컨테이너 ID 기록과 publish 요청을 한 트랜잭션에서 하면 거부되고 전체 롤백**(ID도 남지 않음). container_created에 ID가 없으면 거부. processing+FINISHED, ready+IN_PROGRESS, 미지원 상태, ERROR(CONTAINER_FAILED), PUBLISHED, 단계 역행, CONTAINER_NOT_READY 건너뛰기, 다른 단계에서 ID 전달 거부. publish 요청 전 published/unknown은 PUBLISH_NOT_REQUESTED. publish 요청 후 failed(auto) 거부, 외부 ID 없으면 NO_EVIDENCE. **published/done/has_issues**. 같은 컨테이너 ID는 다른 작업에서도, 같은 작업의 새 attempt에서도 23505. **같은 게시물 결과 → unknown + reconciliation_required + conflict 증거**. 미해결 상태의 confirmed_absent 거부, conflict 수락 거부, 반려하면 해제. worker found_published(ID 필수, 충돌 거부) → published/done. **publish 후 unknown → confirmed_absent → 재실행 → 새 attempt 2**. 늦은 증거: attempt 미지정이면 수락 시 PUBLISH_NOT_REQUESTED, attempt 1 귀속이면 unknown → published/done, failed(operator_only) → published도 가능. published 작업의 늦은 증거는 수락 불가, 반려 가능. live 정정은 ID와 메모가 필요하고 attempt·issues를 승계 |
| 6 리스 만료 | 29/29 | 만료 전 recover는 0건. 만료 후 소유 워커와 다른 워커 모두 LEASE_NOT_HELD. **publish 요청 후 만료 → unknown(LEASE_EXPIRED_AFTER_PUBLISH_REQUEST, phase 유지)**. 컨테이너 전 만료는 failed(auto). dry_run 단계 없음은 failed. **container_created 만료는 recover 대상이 아니고 claim이 같은 attempt로 재개**(resumed, 원래 워커 거부, 같은 컨테이너로 진행). unknown 작업은 claim 대상 아님. 결함 D-2 재현 |
| 7 철회 | 12/12 | 승인 철회 → claim 시 hold approval_revoked. hold 상태 재예약 거부, 취소 가능. 새 원문 버전이 나온 뒤 operator 재실행은 basis 실패로 거부(롤백). **admin 역할 회수 actor는 게시 선언·취소 거부**, 다른 admin은 처리 가능 |
| 8 우회·불변식 | 10/10 | service_role 직접 UPDATE 42501. superuser도 컨텍스트 없이 바꾸면 거부. admin 컨텍스트를 위조해도 증거 없는 published는 거부. jobs DELETE, events UPDATE, reconciliations DELETE, evidence의 상태 외 열 변경 거부. **모든 작업에서 이벤트 수 = max(seq) = version**, published ⇔ accepted 증거 1개 |

## 4. 재현된 SQL 결함 (Master 후속 배정용. SQL 미수정)

### D-1 URL 증거 충돌 검사가 원문 문자열 비교라 호스트 대소문자로 우회된다 (중간)
- 위치: `20261116040000_distribution_jobs.sql:742` `distribution_evidence_conflicts`의 `e.external_url = p_external_url`. 같은 성격의 unique index는 `:420` `distribution_publication_evidence_accepted_url_unique (channel, external_url)`이다. `distribution_insert_evidence`(`:768`)는 URL을 원문 그대로 저장한다(`url_host`만 소문자).
- 최소 재현(m2-run 그룹 1 "D-1"): 작업 A에 `https://blog.naver.com/u/1001`을 수락해 둔다. 작업 B에서 `distribution_record_manual_evidence(..., 'https://BLOG.NAVER.COM/u/1001', ...)`를 호출하면 성공해, 같은 글이 두 작업에 accepted로 남는다(정상이면 EVIDENCE_CONFLICT). 호스트 허용 검사는 `lower()`를 쓰므로 통과한다.
- 수정 제안(새 forward migration):
  - `distribution_insert_evidence`에서 저장 전에 URL의 scheme과 host를 소문자로 정규화한다. 기본 포트 `:443`과 빈 경로/`/`를 통일하는 것도 고려한다.
  - conflict 함수와 unique index는 정규화된 값을 비교한다. 또는 `(channel, url_host, 경로)` 표현식 index로 바꾼다.
  - 이미 저장된 행에는 정규화 재검사(중복 리포트)가 필요하다. 아직 적용한 DB가 없으므로 지금은 영향이 없다.

### D-2 dry_run이 publish_requested 이후 리스 만료되면 recover_expired_leases가 전체 실패한다 (높음, 운영 차단)
- 위치: `20261116040000_distribution_jobs.sql:2098-2106`. recover가 dry_run(publish 요청 후)을 `status='failed', retry_policy='auto'`로 바꾸는데, jobs 가드 `:1128-1134`가 "publish 요청 후 auto 금지"로 거부한다(`complete_attempt :2013-2014`도 같은 규칙). 즉 두 규칙이 서로 모순된다.
- 최소 재현(그룹 6 "D-2"): dry_run 작업을 claim(lease 30)한 뒤 container_requested → container_created → ready → publish_requested까지 진행하고 만료를 기다린다. `distribution_recover_expired_leases()` → **ERR 23514 "automatic retry is not allowed after a publish request"**, 작업은 dispatching 그대로 남는다. claim 재개 대상(container_created~ready)도 아니어서 **어떤 경로로도 회수되지 않는다**.
- **D-2b(배치 차단)**: 이 작업은 `order by lease_expires_at`에서 계속 맨 앞에 있다. 그래서 뒤에 만료된 정상 live 작업 E6(publish 요청 후)도 `recover(100)`이 다시 23514로 실패하면서 **unknown으로 전환되지 못한다**(E6=dispatching/publish_requested). 이것도 재현했다.
- 수정 제안(택1 + 방어):
  - (a) recover의 dry_run publish 후 분기를 `retry_policy='operator_only'`, `last_error {retryable:true, autoRetry:false}`로 바꾼다. 규칙을 바꾸지 않아 가장 작은 변경이다.
  - (b) dry_run은 외부 게시가 없다는 정책을 명시하고, 가드 `:1128`과 `complete_attempt :2013`의 auto 금지를 `mode='live'`에만 적용한다.
  - 방어: recover 루프에서 작업별로 `begin … exception when others then` 블록으로 감싸 실패한 작업은 건너뛰고 기록한다. 그러면 독 작업 하나가 배치 전체를 막지 않는다.
  - 권고: (a) + 방어.

### 관찰 (결함 아님)
- **O-1**: M1(030000) 트리거 함수 9개는 service_role EXECUTE를 회수하지 않았다(M2는 회수함). 트리거 함수는 직접 호출하면 0A000으로 거부되므로(그룹 0에서 확인) 실해는 없다. 정리할 때 M2와 일관되게 맞추면 된다.
- 이전 보고의 P-1(승인 후 트리거 우회 변조)과 P-2는 Master 지시대로 그대로 두었다.

## 5. 검증하지 못한 범위와 그 이유

1. **다중 연결 동시성**: PGlite는 연결이 하나뿐이라 claim `FOR UPDATE SKIP LOCKED`의 중복 방지, 리스 경합, 동시 expected_version 충돌, 교착은 실행하지 못했다. 통과를 주장하지 않는다.
2. **실제 live 게이트 조건**: M3 연결, M4 권리, capability, runtime_controls 테이블이 아직 없다. live 전이는 게이트 override 상태에서만 검증했다.
3. **공급자 HTTP와 실제 컨테이너 상태 조회**: DB 밖이다. 상태값은 워커 입력으로 대체했다.
4. **`awaiting_operator`, `paused`, `reauth_required` 등의 hold 설정 경로**: 이 hold를 설정하는 함수가 현재 없어(M3, M5 예정) 해제·재예약 경로만 코드로 확인했다.
5. **실제 Supabase(PostgREST /rpc, JWT, PG 15/17)**: 대역 한계로 검증하지 못했다.
6. **scheduled_at 미래 작업의 실제 도래 후 claim**: 시간 조작을 하지 않았다. 미도래 작업이 claim에서 제외되는 것만 확인했다.

## 6. 변경 파일

- 추가: `web/scripts/distribution-local-verify/lib.mjs`, `web/scripts/distribution-local-verify/m2-run.mjs`, 이 결과 파일
- 수정:
  - `web/scripts/distribution-local-verify/run.mjs`: migration 목록 검사를 "앞 6개 일치"로 바꿨다. 060000 추가로 회귀가 깨지지 않게 하려는 변경이고, 시나리오는 바꾸지 않았다.
  - `web/scripts/distribution-local-verify/README.md`
- 수정 없음: SQL migration, 앱, env/키, 공용 문서, web/package.json, lockfile, node_modules, `token-run.mjs`(다른 세션 소유). commit하지 않았다.
- 임시(저장소 밖): `%TEMP%\autopost-local-db-verify-002\m2-run-*.log`, `m2-result-*.json`, `run-regress.log`
