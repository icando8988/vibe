# AUTOPOST-M1-WRITE-API-001 — 콘텐츠/초안/승인 영속 쓰기 RPC (CC-ENG)

- 작업 ID: AUTOPOST-M1-WRITE-API-001 · Run run_eaedc8d53618 · task_ee3e334f0b41 / ctx_ddb251de343e
- 작업자: CC-ENG (Claude Code, Orca dispatched worker) · 총괄 CX-MASTER-01 · 2026-11-16 (Asia/Seoul)
- 상태: **ready_review** (작성·정적 검토만)
- **실행하지 않은 것**: migration 적용, DB/PGlite, 테스트, build/lint/typecheck, network/production/auth/dashboard.
  SQL 구문, 트리거 상호작용, RLS, ACL, 해시 값은 **실제로 실행해 확인하지 않았다**.
- 읽지 않은 것: `API KEY.txt`, 비밀번호 파일, `.env*`.

## 1. 변경 파일

| 파일 | 종류 |
|---|---|
| `web/supabase/migrations/20261116050000_distribution_content_write_api.sql` | 신규 (1057줄) |
| `.ai/results/AUTOPOST-M1-WRITE-API-001-CC-ENG.md` | 신규 (이 보고서) |

M1/M2 migration, 앱, UI, 테스트, env, 공용 계약 문서는 수정하지 않았다.

정독한 근거: `AI_TEAM_RULES.md`, `.ai/PROJECT.md`, `.ai/TEAM.md`, `.ai/TRANSPORT.md`, `.ai/roles/CLAUDE_CODE.md`, `DEC-AUTOPOST-DATA-001.md`, `docs/AUTOPOST_INTEGRATION_PLAN.md`(관련 절), M0 일부(`010000` private 함수), M1 `030000` 전체, M2 `040000` 머리 주석·helper(500–830행)·`create_job`·grants/RLS 절, `AUTOPOST-DATA-001-CC-ENG.md` §3·§5, `web/src/lib/distribution/utm.ts`(UTM 형태).

## 2. API (모두 `SECURITY DEFINER`, `search_path=''`, service_role만 EXECUTE, 반환 jsonb)

| # | 함수(인자) | 반환 키 | 핵심 검사 |
|---|---|---|---|
| a | `distribution_create_content(p_actor_id uuid, p_title text, p_body text, p_story_slug text=null, p_target_path text=null, p_source_refs jsonb='[]', p_media_asset_ids uuid[]='{}', p_change_summary text=null)` | content_id, version_id, version_no(=1), content_hash | actor; 입력 크기·형식; contents INSERT 후 v1 INSERT(M1 트리거가 번호·포인터 처리) |
| b | `distribution_append_content_version(p_actor_id, p_content_id uuid, p_expected_version_no int, p_title, p_body, p_target_path=null, p_source_refs='[]', p_media_asset_ids='{}', p_change_summary=null)` | content_id, version_id, version_no, content_hash | contents FOR UPDATE, 보관 상태 아님, `current_version_no = expected` 아니면 `VERSION_CONFLICT` |
| c | `distribution_create_channel_draft(p_actor_id, p_content_id uuid, p_channel text)` | draft_id, content_id, channel | contents FOR SHARE, 보관 아님, (content, channel) 중복이면 `DUPLICATE` |
| d | `distribution_append_draft_revision(p_actor_id, p_draft_id uuid, p_expected_revision_no int, p_expected_content_version_id uuid, p_body text, p_link_url text=null, p_utm jsonb='{}', p_target_connection_id uuid=null, p_target_external_account_id text=null, p_validation jsonb='{}', p_media jsonb='[]')` | draft_id, revision_id, revision_no, content_version_id, revision_hash, media_count | contents FOR SHARE → drafts FOR UPDATE; 보관 아님; `REVISION_CONFLICT`; 원문 현재 버전 = expected 아니면 `STALE_CONTENT_VERSION`; 리비전 INSERT와 미디어 rows를 같은 트랜잭션에 기록 |
| e1 | `distribution_decide_approval(p_actor_id, p_subject_type text, p_subject_id uuid, p_decision text('approved'\|'rejected'), p_expected_subject_hash text, p_checklist jsonb='{}', p_reason text=null)` | approval_id, subject_type, subject_id, decision, subject_hash | 최신 대상만(`NOT_LATEST`), 리비전은 원문 최신 버전 기반만(`STALE_CONTENT_VERSION`), 보관 아님, 해시 재계산 = 저장값(`HASH_INTEGRITY`), = expected(`SUBJECT_CHANGED`), 트랜잭션당 결정 1개, 중복 승인 거부(`ALREADY_APPROVED`), 반려는 사유 필수, 승인은 체크리스트 전부 true |
| e2 | `distribution_revoke_approval(p_actor_id, p_approval_id uuid, p_reason text)` | approval_id, revokes_approval_id, subject_type, subject_id | 대상이 `approved`인지, 아직 철회되지 않았는지(`ALREADY_REVOKED`), 사유 필수. 최신/보관/해시 무결성과 관계없이 **항상 허용**(안전한 방향) |
| f1 | `distribution_archive_content(p_actor_id, p_content_id, p_reason)` | archive_event_id, content_id, archived_at | contents FOR UPDATE, `ALREADY_ARCHIVED`, 사유 필수, 이력 행 + archived_at |
| f2 | `distribution_archive_channel_draft(p_actor_id, p_draft_id, p_reason)` | archive_event_id, draft_id, content_id, archived_at | contents SHARE → drafts UPDATE, 이하 동일 |

내부 helper(owner만 EXECUTE): `distribution_hash_field`, `distribution_compute_content_hash`, `distribution_compute_revision_hash`, `distribution_recompute_subject_hash`, `distribution_assert_content_input`, `distribution_assert_utm`, `distribution_assert_checklist`, `distribution_normalize_media`.

새 테이블: `public.distribution_archive_events`(subject_type content|channel_draft, content_id, draft_id(같은 content의 초안만 참조하는 복합 FK), reason 필수, actor_id, created_at). 행 변경 불가(M1 `distribution_reject_mutation` 재사용, UPDATE/DELETE/TRUNCATE 거부)이고 대상당 1행이다. 보관은 한 방향만 가능하며 해제 API는 없다. 읽기는 authenticated 명시 열 + RLS(`private.is_distribution_admin()`), service_role은 SELECT만 가진다.

## 3. actor / grant 경계

- 모든 API의 첫 문장은 `public.distribution_assert_admin_actor(p_actor_id)`(M2, D1 조건)다. 실패하면 `insufficient_privilege`로 끝나고 아무것도 쓰지 않는다(fail closed).
- 위의 8개 API는 함수마다 PUBLIC, anon, authenticated의 EXECUTE를 회수하고 service_role에만 GRANT한다. helper는 service_role까지 회수한다.
- **M1 grants 강화(Master 확인 요청)**: M1 6개 테이블에서 service_role의 직접 `INSERT/UPDATE/DELETE`를 회수하고 SELECT는 유지했다. 이유: 직접 INSERT가 남아 있으면 서버가 해시를 재계산한다는 보장을 우회할 수 있다(M2와 같은 "함수만이 쓰기 경로" 원칙). 앱 코드 검색 결과 M1 테이블 직접 쓰기 호출은 없다(`idempotency.ts`의 이름 언급뿐). 원치 않으면 4.1절 한 문장만 지우면 원래 상태로 돌아간다.
- client(anon/authenticated) 쓰기 경로: 없음(M1과 같음). 승인 기록과 원문 텍스트는 client가 직접 쓸 수 없다.
- 한계: DB는 actor가 승인된 admin인지까지만 확인한다. 서버가 actor를 위조하지 않는 것은 service_role 키를 서버에만 둔다는 전제에 의존한다. 호출 서버는 검증된 세션 사용자를 넘겨야 한다.

## 4. invariant 대응

| 불변조건 | 보장 위치 |
|---|---|
| append-only (버전·리비전·미디어·승인·보관 이력) | M1 트리거 + 새 테이블 트리거. 함수는 INSERT만 한다. 머리 행은 포인터 전진(M1 트리거)과 archived_at만 바뀐다 |
| version/revision 연속 번호 | M1 BEFORE INSERT 트리거(현재+1 강제). 함수는 잠금 아래 expected와 비교한 뒤 현재+1을 넣는다 |
| cross-content FK | M1 복합 FK(revision → (content_id, version), (draft, content)). 함수는 draft.content_id와 원문 현재 버전으로 값을 채운다. 보관 이력도 복합 FK를 쓴다 |
| 동일 트랜잭션 미디어 | `append_draft_revision`이 리비전과 미디어를 한 함수(=한 트랜잭션)에서 INSERT한다. M1 xid8 트리거가 최종 판정한다 |
| archived 금지 | 버전·초안·리비전 추가와 승인/반려는 보관 상태면 `ARCHIVED`로 거부한다. 철회는 허용. M2 claim/rerun은 `archived`로 hold한다 |
| 최신 버전만 승인 | 승인/반려 시 잠금 아래에서 현재 포인터와 비교한다. 리비전은 원문 최신 버전에 기반해야 한다 |
| subject_hash 일치 | 저장 해시를 재계산 값, expected 값과 각각 대조한 뒤 저장 해시를 기록한다. M1 트리거가 다시 대조한다 |
| 입력 해시 불신 | 해시를 입력으로 받지 않는다. expected hash는 비교에만 쓰고 저장하지 않는다 |
| 동시성 | 잠금 순서는 항상 contents → drafts. head를 FOR UPDATE로 잠그고 expected pointer/version/hash와 비교한다. M2 `create_job`(둘 다 FOR SHARE)과 교착이 생기지 않는다(정적 판단) |
| 결정 순서 모호성 | 같은 트랜잭션에서 같은 대상에 두 번째 승인/반려를 거부한다(M2 유효 승인 정렬 요구 이행) |

## 5. 해시 canonicalization v1 (migration 머리 주석에 고정)

- `hex(SHA-256(UTF-8(canonical)))`, 소문자 64자. **`pg_catalog.sha256(bytea)`(PG11+ 내장)** + `convert_to(…,'UTF8')` + `encode(…,'hex')`.
  기존 migration 어디에도 pgcrypto 생성이나 `digest()` 사용이 없어서 확장 설치와 스키마(`extensions.` 등)를 가정하지 않았다. M1이 이미 PG13+(xid8)를 전제하므로 내장 함수를 쓸 수 있다고 판단했다. **DB에서 확인하지는 않았다.**
- canonical = 헤더 줄(`distribution.content_version.v1\n` / `distribution.draft_revision.v1\n`) + 고정 순서의 필드 줄 `name=<UTF-8 바이트 수>:<값>\n`(NULL이면 `name=-\n`).
  길이 접두 덕분에 필드 경계가 모호하지 않고 NULL과 빈 문자열도 구분된다. 텍스트는 trim, NFC, 줄바꿈 정규화 없이 그대로 쓴다. uuid는 `uuid::text`(소문자), 정수는 10진이다.
- content_version.v1: content_id, title, body, target_path, source_refs(**jsonb::text** 정규 출력), media_asset_ids.count, media_asset_ids[1..n](순서 유지).
  제외: change_summary, story_slug, created_*.
- draft_revision.v1: draft_id, content_id, channel, content_version_id, content_hash(고정된 원문 버전), body, link_url, utm.count, (utm.key, utm.value)를 COLLATE "C" 키 순으로, target_connection_id, target_external_account_id, media.count, media[i].(asset_id, variant_id, alt_text)를 position 1..n 순으로.
  제외: validation(검증 메타), revision_no, created_*, created_xact_id. 대상 계정을 넣었으므로 계정이 바뀌면 재승인이 필요하다(D13 권고).
- 미디어 position은 배열 순서로 부여한다. 재계산 때 연속성(count = max)을 검사하고 아니면 `HASH_INTEGRITY`.
- 규칙을 바꿀 때는 v2 헤더로 새 함수를 만든다. 기존 해시를 재계산하지 않는다.

## 6. M1/M2 연결 지점

- M1 트리거가 번호, 포인터, 미디어 xid8, approvals subject_hash, 철회 대상 일치를 계속 강제한다. 이 파일은 M1 객체를 재정의하지 않는다.
- M2 재사용: `distribution_assert_admin_actor`, `distribution_effective_approval_id`(owner 권한으로 DEFINER 안에서 호출).
- 흐름: create_content → create_channel_draft → append_draft_revision → decide_approval(content_version) + decide_approval(draft_revision) → **M2 `distribution_create_job(p_actor_id, revision_id, mode…)`**이 유효 승인을 선택한다. 원문이 새 버전으로 바뀌거나 철회·보관되면 M2 `distribution_job_basis_problem()`이 claim/rerun 시점에 stale/approval_revoked/archived를 판정한다. 이 파일은 jobs를 바꾸지 않는다.

## 7. 미확정·한계 (정적 검토)

1. **실행 미검증**: 구문, `convert_to`/`sha256` 가용성, `collate pg_catalog."C"` 해석, 트리거 연쇄, RLS, ACL, 잠금/교착은 모두 실행하지 않았다. PGlite나 로컬 Supabase에서 M0~M2와 이 파일을 순차 적용하고 해시 고정 벡터, 동시성, ACL 매트릭스를 시험해야 한다(migration 말미 목록).
2. M1 service_role 직접 쓰기 회수는 M1 grants 계약을 강화한다. Master 승인이 필요하다.
3. 체크리스트 필수 키 목록은 미결정이다. 지금은 승인 시 "1개 이상, 전부 true"만 검사한다. 자기 승인 제한(작성자 ≠ 승인자)도 미결정이라 강제하지 않는다.
4. 원문 승인과 리비전 승인의 순서는 강제하지 않는다(M2 create_job이 둘 다 요구한다).
5. `(content_id, channel)` unique 때문에 보관된 초안이 있는 채널에는 새 초안을 만들 수 없다(M1 제약). 보관 해제 API는 없다.
6. source_refs 해시는 PostgreSQL jsonb 텍스트 출력에 의존한다(1과 1.0이 다른 해시). DB 밖에서 재현하지 말고 DB 값을 기준으로 삼는다.
7. 입력 한도(source_refs 100개/64KiB, media_asset_ids 50, revision media 20, utm 10키, validation 64KiB)는 보수적인 임시값이다. 채널별 규칙은 validation 계약의 책임이다.
8. 앱 서버 호출 코드, 오류 접두어 매핑, TS 타입은 이 작업 범위 밖이다(후속 작업).
