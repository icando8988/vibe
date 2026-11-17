# AUTOPOST-M3-CONNECTION-017 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_ba2f35437d84 / dispatch ctx_66fc854d200f / 2026-11-17
- 금지 준수: 기존 migration·러너·UI·확장·package·키트 원본 미수정. 실DB·실계정·API·키/env 열람·외부 게시·commit/push 없음. 공식 문서도 이번에는 조회하지 않음(저장 경계는 API 규격과 무관하게 설계).
- **운영 상태: OAuth start/callback·실제 토큰 교환 미구현, 실제 Supabase 미적용, `DISTRIBUTION_TOKEN_KEY` 미등록 → 실제 연결 불가. 이번 작업은 저장 경계(서버 내부 함수 + SQL)와 mock 데이터 검증까지.**
- 진행 중 파일 없음(모든 변경 저장·검증 완료). UI에 연결하지 않았으므로 프론트 배포 화면 변화 없음.

## 1. 변경 파일
- `web/supabase/migrations/20261116090000_distribution_channel_connections.sql` (신규)
- `web/src/server/distribution/connections/crypto.ts`, `types.ts`, `service.ts` (신규)
- `web/tests/distribution-server/connections-crypto.test.ts`, `connections.pglite.test.ts` (신규), `pglite-harness.ts`(문자열 배열 → text[] 캐스트 추가)
- `web/scripts/distribution-local-verify/connections-run.mjs` (신규)

## 2. 설계
**테이블(둘 다 RLS·정책 없음, PUBLIC/anon/authenticated/service_role 직접 권한 회수)**
- `distribution_channel_connections`(metadata): owner_id, channel(threads|instagram), provider_account_id(보수적 문자 집합 1~128 — 공급자 규격 미확정), account_label, scopes text[](1~20개 소문자 식별자·중복 없음), status(connected|reauth_required|revoked), reauth_reason, expires_at(필수·미래·400일 이내), key_version, row_version(모든 변경 +1), revoked_at/by/reason. 미철회 (owner, channel, account) 유일. 트리거: owner·channel·account·created_at 불변, 철회는 최종, 삭제 금지, row_version +1 강제.
- `distribution_channel_credentials`(봉투만): key_version, aad_version(=1), ciphertext(base64), nonce(12B), auth_tag(16B). 평문·앱 secret 열 없음.

**RPC(service_role 전용 SECURITY DEFINER, search_path='')**
- create(새 계정) / reconnect(같은 계정, expected row_version, 다른 계정이면 `ACCOUNT_MISMATCH`) / revoke(expected version, credential 삭제) / mark_reauth(expected version, 사유 허용 목록) / list(소유자만, credential 열 없음, has_credential만) — 모두 p_actor_id D1 재검사 + 자기 소유(타인 연결은 not found).
- read_channel_credential(worker 내부): 소유자 현재 D1 + connected + 미만료 + 미철회 + credential 존재·키 버전 일치. 실패 토큰 `CONNECTION_REVOKED`/`REAUTH_REQUIRED`/`CREDENTIAL_EXPIRED`.
- 내부 helper·트리거 함수는 모든 공개 역할 EXECUTE 회수.

**재연결 의미**: 같은 계정 = 같은 행·같은 id에서 credential 교체(대상 리비전·작업 유지). 다른 계정 = 새 행(기존 행 계정 불변). 철회 후 재연결 = 새 id(그 연결을 가리킨 리비전은 재저장·재승인).

**기존 target_connection_id 호환(정적 대조 + 최소 연결)**
- M1 `distribution_draft_revisions.target_connection_id`, M2 `distribution_jobs.target_connection_id`: FK(on delete restrict) **NOT VALID** 추가 — 기존 행 미검사, 이후 쓰기부터 강제.
- 리비전 INSERT 트리거(invoker): 대상 연결이 존재·미철회·같은 채널·`target_external_account_id = provider_account_id`가 아니면 `TARGET_CONNECTION_MISMATCH`. 작업은 리비전 스냅샷 복사라 별도 검사 불필요. 리비전 해시(050000)가 대상 id·계정을 포함하므로 대상 변경은 재승인 필요.
- 기존 M2 함수·`distribution_live_gate`(false)·job_basis_problem 미변경. 연결 소유자·상태·capability 재검사는 live gate 교체 작업 몫.

**암호화(앱, Node crypto)**
- AES-256-GCM, nonce 12B CSPRNG(매번), tag 16B, 평문 v1 = `{"access_token": ...}`.
- AAD v1 = JSON `["autopost.distribution.credential", 1, owner_id, channel, provider_account_id, key_version]`.
- 키: 런타임 이름 `DISTRIBUTION_TOKEN_KEY` = `v<버전>:<base64 32B>` 쉼표 1~5개, 첫 항목이 현재 키(나머지 복호화 전용). 모듈은 env를 읽지 않고 호출자가 값을 넘긴다(`loadKeyring(source)`). 형식·길이·중복·0키면 전체 거부.
- fail closed: 키 없음·형식 오류 → not_ready(RPC 0회), 키 버전 없음 → reauth_required(key_rotated), 복호화·AAD 실패 → reauth_required(decrypt_failed).
- 키 회전 지원 범위: 새 키 앞에 추가 → 이후 저장분부터 새 버전, 옛 키 유지 시 기존 복호화. 일괄 재암호화(rewrap)는 미구현.
- SecretToken/Keyring: toString·toJSON·inspect 가림, 비교는 상수 시간 equals. 테스트는 토큰을 단언 값으로 쓰지 않음.

## 3. 검증(로컬 PGlite 대역 · mock — 실제 Supabase 아님)
| 항목 | 결과 |
|---|---|
| connections-run.mjs (000000~090000 10개 적용) | 5/5 |
| 회귀: run.mjs 207/207 · m2-run 334/334 · token-run 75/75 · handoff-run 91/91 · handoff-review-run 102/102 | 통과 |
| 회귀: threads-connect 3/3 · blog-flow 5/5 · content-connect 2/2 | 통과 |
| vitest 전체 | 21 files · 467 passed · 15 skipped(PGlite 전용) |
| tsc / lint / build | 0 오류 / 0 오류(범위 밖 기존 경고 3) / 성공 |

- PGlite: anon·authenticated·service_role 두 테이블 SELECT/INSERT 42501, anon·authenticated RPC 42501, helper 42501, RPC 6개만 service_role EXECUTE. 비승인 actor denied, 키 없음 not_ready, 목록 소유자만·원시 응답에 credential 열 없음, DB 전체에 평문 없음, 같은 계정 중복 duplicate, worker 복호화 성공·타 소유자 not_found·잘못된 키 decrypt_failed·회전 key_rotated, **다른 연결 봉투 복사(DB 조작) → AAD로 복호화 실패**, 재연결 version 충돌·성공(id 유지·새 토큰), 다른 계정 ACCOUNT_MISMATCH(행 불변), 타인 재연결 not_found, 만료 → expired, 재인증 표시 → 읽기 차단, 철회 → credential 삭제·revoked·재철회/재연결 already_revoked·같은 계정 새 id, 연결 삭제 23001, 소유자 D1 상실 → worker denied, 리비전 대상 불일치·없는 연결·다른 채널·철회 연결 거절, 정상 대상 → dry_run 작업 스냅샷 복사, 재연결·철회 후 작업 스냅샷 불변, live gate false, FK 2개 NOT VALID.
- 단위(13): 키링 파싱 거부 사례, 가림, 왕복·nonce 무작위, 암호문·tag·nonce 변조, AAD 4요소 변경, 다른 키, 회전, 서비스 RPC 0회 조건·인자에 평문 없음·AAD 세션 actor 바인딩·입력 검증·비밀 키 응답 bad_response·worker 결과 분기.
- 수정한 결함: 리비전 트리거를 처음 SECURITY DEFINER로 만들어 m2-run의 "definer API는 service_role만" 검사에 걸림 → invoker로 변경(INSERT는 소유자 DEFINER 경로뿐이라 동작 동일, 타 역할은 fail closed).

## 4. 측정 못한 것 / 실제 Supabase 필요사항
- 실제 Supabase·PostgREST(text[]·timestamptz 인자 해석은 대역 캐스트), 실제 키 관리·회전 운영, OAuth·Meta 응답 형식(계정 ID·scope·만료).
- 적용: migration 000000~090000(특히 090000은 기존 리비전·작업 행에 FK NOT VALID — 기존 데이터에 고아 target이 있으면 이후 갱신 시 오류 가능, 사전 조회 권장), `SUPABASE_SECRET_KEY`, `DISTRIBUTION_TOKEN_KEY`(32B 랜덤, 서버 전용, 백업·회전 절차), 승인 admin.

## 5. 다음 단계(Master 지시 대기)
1. OAuth 최소: 키트 authorize URL·코드 교환·장기 토큰 이식(state·redirect 고정) → `saveNewConnection`/`reconnectSameAccount`로만 저장, 계정 불일치는 새 연결 분기.
2. 연결 관리 화면(목록·철회·재인증 안내, DTO만), rewrap RPC, live gate M3 조건(연결 connected·계정 일치·소유자 D1).
