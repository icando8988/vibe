# AUTOPOST-M2-FIX-006 — D-1 / D-2 / D-2b 수정 (CC-ENG)

- task_12bb70f71901 / ctx_e2bc425ffa2e · 2026-11-17 · 상태: **ready_review**
- 새 forward migration: `web/supabase/migrations/20261116070000_distribution_evidence_recovery_fix.sql`(sha256 앞 12자리 be035e8424cb). **로컬 PGlite 대역에만 적용했고, 실제 Supabase에는 적용하지 않았다.**
- 검증 결과
  - M2: **334/334**(exit 0). D-1, D-2, D-2b는 "재현"에서 "수정 후 기대 동작"으로 바꿨다.
  - 사전 점검 독립 검증: **21/21**(exit 0)
  - M1 회귀: **206/206**(exit 0)
- 기존 000000~060000, `lib.mjs`, `token-run.mjs`, 앱은 수정하지 않았다. commit, 네트워크, 키 사용 없음.

## 1. D-1 수정 — 증거 URL canonical 충돌 경계

- **새 helper `public.distribution_canonical_url(text)`**(immutable, `search_path=''`, owner 외 EXECUTE 없음)
  - scheme과 authority(host와 포트)만 소문자로 바꾼다. **경로·쿼리·프래그먼트는 대소문자를 그대로 둔다.**
  - **포트는 지우거나 바꾸지 않는다.** 사용자정보(@)나 공백이 든 authority, https가 아닌 값은 손대지 않는다. 형식 판정은 기존 check와 허용 호스트 규칙이 그대로 맡으며, 이 함수 때문에 약해지지 않는다.
- **충돌 helper**: `distribution_evidence_conflicts`를 `CREATE OR REPLACE`(시그니처, 반환, ACL, search_path 동일)해 URL을 canonical끼리 비교한다. 이 helper를 쓰는 complete_attempt, manual 증거, 대사, 늦은 증거, 검토, 정정 경로 모두에 일괄 적용된다.
- **UNIQUE 경계**: raw 인덱스 `…_accepted_url_unique`를 지우고, 같은 helper를 쓰는 표현식 인덱스 `…_accepted_url_canonical_unique (channel, distribution_canonical_url(external_url))`로 바꿨다. raw가 같으면 canonical도 같으므로 기존보다 엄격하다.
- **원문 보존**: `external_url` 열과 불변 트리거, 기존 행은 건드리지 않는다. 열 추가, 테이블 재작성, UPDATE, 트리거 우회가 모두 없다. 저장되는 값은 입력 원문 그대로다.
- **사전 점검**: 기존 accepted 증거에 canonical 기준 중복이 있으면 `D1_CANONICAL_URL_DUPLICATES: n group(s) / m row(s)`(23505)로 **migration 전체가 실패**한다.
  - 자동 삭제, 재배정, 정규화 갱신은 하지 않는다.
  - 오류 메시지에는 건수만 넣고 URL 원문은 넣지 않는다. HINT에 점검 SQL을 넣었다.
  - 운영자가 `distribution_correct_evidence`로 정리한 뒤 다시 적용한다.

## 2. D-2 / D-2b 수정 — 리스 만료 회수

- **D-2 최소안 (a)**: dry_run이 publish 요청 이후 만료되면 `failed` + `retry_policy='operator_only'` + `last_error {code: LEASE_EXPIRED_AFTER_PUBLISH_REQUEST, retryable: true, autoRetry: false}`로 바꾸고, attempt `error_code`도 같은 값으로 남긴다.
  - 가드의 "publish 요청 후 auto 금지"와 complete_attempt 규칙은 바꾸지 않았다.
  - live는 기존대로 publish 요청 후 만료면 `unknown`, 컨테이너 전 만료면 `failed(auto)`다.
- **D-2b 격리**: 작업별 처리를 `BEGIN … EXCEPTION WHEN OTHERS` 서브트랜잭션으로 감쌌다. 실패한 작업은 자기 변경만 롤백되고 루프는 다음 작업으로 넘어간다.
- **진단(침묵 은폐 없음)**
  - 실패한 작업도 결과 행으로 돌려준다: `recovered_job_id=<작업 ID>`, `recovered_status='recovery_failed:<SQLSTATE>'`. 오류 메시지 본문은 넣지 않는다.
  - 같은 내용을 `RAISE WARNING 'job <id> recovery failed (SQLSTATE <code>)'`로도 남긴다. 실패 시 이벤트 컨텍스트 잔여물도 지운다.
  - 실패 작업은 dispatching에 남으므로 다음 호출에서도 다시 보고된다.
  - **호출 서버는 `recovery_failed:` 접두어를 경보로 처리해야 한다.** 이는 앱 계약에 추가할 사항이다.
- **호환**: 이름, 인자(`p_limit integer`), 반환 `TABLE(recovered_job_id uuid, recovered_status text)`, SECURITY DEFINER, `search_path=""`, EXECUTE(service_role만)를 유지했고 검증으로 확인했다.
- **한계**: 한 호출의 `p_limit` 범위가 전부 실패 작업이면 그 호출에서는 뒤 작업까지 닿지 않는다. 실패 행이 그만큼 반환되므로 숨겨지지는 않는다. 실패 작업을 순서에서 건너뛰는 표시는 별도 설계가 필요해 넣지 않았다.

## 3. 검증 (실제 명령, 종료 코드)

| 명령(`--pglite-project %TEMP%\autopost-local-db-verify-002`, 기존 임시 설치) | exit | 결과 |
|---|---|---|
| `node web/scripts/distribution-local-verify/m2-run.mjs` | 0 | 334/334 |
| `node web/scripts/distribution-local-verify/fix006-precheck-run.mjs`(신규) | 0 | 21/21 |
| `node web/scripts/distribution-local-verify/run.mjs`(M1+050000 회귀) | 0 | 206/206 |
| `node web/scripts/distribution-local-verify/token-run.mjs`(다른 세션 소유, 실행만) | 1 | 72/73. 실패 1건은 그 러너의 "060000이 마지막으로 적용됨" 단언이다. 070000과 다른 세션의 080000이 생기면서 깨졌고, 나머지 72건은 통과했다(§5) |

수정 후 기대 동작을 통과 조건으로 둔 핵심 항목:

- **D-1**
  - 호스트 대문자, 혼합 대소문자로 쓴 같은 URL → `EVIDENCE_CONFLICT`. 거부 후 롤백도 확인했다.
  - 경로 대소문자가 다르면(`/U/1001`) 별개 게시물로 수락된다.
  - 저장값과 작업 캐시는 입력 원문 그대로다(`https://Blog.Naver.com/U/1001`).
  - canonical 단위 검사 6개: 경로·쿼리·프래그먼트 보존, 포트 보존, 사용자정보와 http는 변경 없음, null.
  - helper EXECUTE 없음. 인덱스는 canonical 하나만 있다.
  - **helper를 거치지 않은 superuser 직접 INSERT도 canonical UNIQUE가 23505로 거부**한다.
- **사전 점검**(fix006-precheck-run)
  - 070000 이전 상태에서 D-1 중복 accepted 2행을 만든 뒤 070000을 적용하면 `D1_CANONICAL_URL_DUPLICATES`(23505)로 실패한다.
  - 실패 후 증거 행과 원문 URL, raw 인덱스, recover/conflicts 함수 본문(md5)이 그대로이고, canonical helper도 생성되지 않는다(같은 트랜잭션 롤백).
  - `correct_evidence`로 정리한 뒤 재적용하면 성공하고, 정정 이력(superseded 원문)이 보존되며, 이후 대문자 호스트 우회는 거부된다.
- **D-2**
  - recover가 성공하고, dry_run E4는 failed / operator_only / 위 last_error(키 3개) / attempt error_code가 된다.
  - 자동 재시도는 계속 `RETRY_NOT_ALLOWED`다. 이벤트는 `lease_expired_after_publish_request`(system)로 남고, operator 재실행 승인으로만 재개된다.
- **D-2b**(시험 전용으로 E7의 attempt 갱신만 실패시키는 트리거를 일회성 DB에 잠시 설치)
  - 만료 순서상 E7이 E6보다 앞이다.
  - recover 호출은 성공하고, E7은 `recovery_failed:P0001`로 보고되며, **뒤에 만료된 live E6은 unknown으로 전환**된다.
  - E7은 자기 변경만 롤백된다(dispatching, attempt pending, 이벤트 증가 없음). 결과 행에 메시지 본문은 없다.
  - 다음 호출에서도 E7이 다시 보고되고, 트리거를 제거하면 E7도 unknown으로 정상 회수된다.

## 4. 미검증과 한계

- 다중 연결 동시성(PGlite 단일 연결): SKIP LOCKED 상태에서 서브트랜잭션 롤백과 잠금의 상호작용은 단일 연결에서만 확인했다.
- `RAISE WARNING`이 클라이언트나 로그에 실제로 전달되는지는 PGlite에서 확인하지 않았다. 결과 행 경로만 단언했다.
- canonical 범위에 넣지 않은 것: 끝 점이 붙은 호스트(`blog.naver.com.`), IDN/punycode, 퍼센트 인코딩 호스트, 기본 포트(`:443`) 동일시. 포트 규칙을 바꾸지 말라는 지시에 따라 `:443`도 별개로 취급한다. 수동 증거 허용 호스트 규칙(`blog.naver.com`/`m.blog.naver.com`)은 그대로다.
- 실제 Supabase(PostgREST, JWT, PG 15/17)는 검증하지 않았다. 표현식 인덱스와 `get stacked diagnostics`는 PG 13 이상에서 지원된다.

## 5. 협조 사항 (Master 조정 필요)

- 작업 도중 다른 세션이 `20261116080000_distribution_extension_handoffs.sql`과 `handoff-run.mjs`를 추가했다. 080000은 070000이 바꾼 객체(recover, conflicts, evidence)를 참조하지 않는다(grep 확인). 두 migration은 순서대로 함께 적용되며 M1·M2 회귀를 통과했다.
- **`token-run.mjs:53`이 "060000이 마지막 migration"이라고 단언**한다. 그래서 070000과 080000이 생긴 뒤로 그 러너는 exit 1이다. 지시대로 그 파일은 건드리지 않았다. 이 단언을 "060000 포함" 같은 방식으로 바꾸는 일은 토큰 작업 담당에게 배정이 필요하다. 070000의 적용 시점을 060000과 080000 사이에서 옮길 필요는 없다(서로 독립).
- 참고: 080000의 SECURITY DEFINER helper 4개(`distribution_handoff_expire`, `distribution_handoff_lock_run`, `distribution_handoff_problem`, `distribution_handoff_token_owner`)는 service_role에도 EXECUTE가 없는 owner 전용이다. 의도된 설계일 수 있다. m2-run은 이 함수들을 범위 밖으로 분리하고 anon/authenticated EXECUTE가 없다는 것만 확인한다.
- 앱 계약: recover 호출부는 `recovery_failed:` 상태를 경보로 처리해야 한다. dry_run의 publish 후 만료가 이제 operator_only이므로 운영 UI에 재실행 승인 경로가 필요하다.

## 6. 변경 파일

- 추가: `web/supabase/migrations/20261116070000_distribution_evidence_recovery_fix.sql`, `web/scripts/distribution-local-verify/fix006-precheck-run.mjs`, 이 결과 파일
- 수정: `web/scripts/distribution-local-verify/m2-run.mjs`(D-1/D-2/D-2b 기대값을 수정 후 동작으로 변경, 070000 함수 호환 검사 추가, 다른 세션 함수를 ACL 검사 범위에서 분리)
- 수정 없음: 000000~060000, 080000, `lib.mjs`, `run.mjs`, `token-run.mjs`, `handoff-run.mjs`, README, 앱
