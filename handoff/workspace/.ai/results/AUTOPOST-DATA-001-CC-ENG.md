# AUTOPOST-DATA-001 결과 — 통합 배포 데이터·상태 계약 제안

- 작업 ID: AUTOPOST-DATA-001 · 담당: CC-ENG-06 (Claude Code, Orca task_5287dd892a66 / dispatch ctx_be887be6cf16 / term_a24fc5bf-0bfd-4c67-a96a-d9025531fbf1)
- Master: CX-MASTER-01 · 작성: 2026-11-16 (Asia/Seoul) · 상태: **ready_review**
- 산출물: 이 문서 1개. SQL·앱 코드·테스트·seed·secret·외부 계정/API·DB는 만들거나 건드리지 않았고, 코드/테스트도 실행하지 않았다.
- 표기: **[관찰]** 실제 파일에서 읽은 사실 / **[제안]** 이 문서의 설계안 / **[게이트]** 공급자·플랜·정책 미확인으로 결정 전 진행 금지 / **[결정]** Master·사용자 결정 필요.

---

## 0. 입력과 읽은 범위

| 구분 | 실제 읽은 경로 | 용도 |
|---|---|---|
| 공통 지침 | `AI_TEAM_RULES.md`, `.ai/PROJECT.md`, `.ai/TEAM.md`, `.ai/TRANSPORT.md`, `.ai/roles/CLAUDE_CODE.md` | 역할·보고 형식 |
| 제품 요구 | `docs/AUTOPOST_INTEGRATION_PLAN.md`, `.ai/results/AUTOPOST-UX-001-CX-DESIGN.md`, `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md` | 요구사항으로만 사용 |
| 기존 결정 | `.ai/decisions/DEC-DISTRIBUTION-002.md` | 시도번호·늦은 증거·URL·작업 ID·요약 범위 |
| migration | `web/supabase/migrations/20261116000000_initial_foundation.sql`, `…010000_private_role_functions.sql`, `…020000_profile_on_signup.sql` | 기존 스키마·권한 패턴 |
| 배포 계약 | `web/src/lib/distribution/{types,jobs,idempotency,adapters,late-evidence,result,utm,index}.ts` | 상태·멱등·대사 계약 |
| 인증/권한 | `web/src/lib/auth/{viewer,email-login}.ts`, `web/src/app/admin/page.tsx`, `web/src/lib/supabase/{config,server}.ts`, `web/src/lib/env.ts` | admin 진입·클라이언트 키 경계 |
| 콘텐츠 | `web/src/lib/content/{types,visibility}.ts` (일부), `docs/CONTENT_WORKFLOW.md`, `docs/DEVELOPMENT_CONTRACT.md`, `docs/DB_VERIFICATION.md` 앞부분 | 원문↔배포 원문 관계, DB 검증 상태 |

열지 않은 것: `Blog_Posting_Kit*`, `Insta_Auto_Posting_Kit*`, `Threads_Auto_Posting_Kit*` 전체, 키트 분석 보고서(`AUTOPOST-*-ANALYSIS-*`), `docs/AUTOPOST_IMPORT_ANALYSIS.md`(키트 분석 양식일 가능성이 있어 제외), `API KEY.txt`, `SUPABASS DB 비번.txt`, `.env*`.

---

## 1. 현재 계약 관찰과 충돌 지점

### 1.1 기존 migration 패턴 [관찰]

1. 상태값은 enum 대신 `text + check`. 시각은 `timestamptz`(UTC). `public.set_updated_at()` 공용 트리거 함수가 이미 있다.
2. 열 보호: 새 테이블마다 `revoke all … from public, anon, authenticated` 후 노출 열만 `grant select (…)`. 클라이언트는 `select *` 불가.
3. 행 보호: 모든 테이블 RLS 활성. 관리자 읽기는 `using ((select private.is_admin()))`. **클라이언트 쓰기 권한·정책은 없음**. 내부 열/쓰기는 "DEV-007 서버(역할 재확인 후 service_role)" 경로로 한정.
4. 역할 함수는 `private` 스키마(API 비노출), `security definer`, `search_path=''`. **`authenticated`에 `private` 스키마 USAGE가 부여되어 있다**(RLS 정책 내 호출용). `alter default privileges in schema private revoke all on functions …`.
5. `public.audit_events`(append-only 의도, 클라이언트 권한 없음, `actor_kind in ('member','admin','system')`)가 이미 있다.
6. `orders_guard_update` 트리거로 종료 상태 역전·스냅샷 열 변경을 DB에서 막는다(service_role 포함). 같은 패턴을 배포 작업에 쓴다.
7. migration은 아직 어떤 Supabase에도 적용되지 않았고, DB 실행 검증(PGlite)은 미실행(`docs/DB_VERIFICATION.md`).

### 1.2 기존 배포 코드 계약 [관찰]

- `JobStatus` = scheduled · dispatching · published · dry_run_succeeded · failed · unknown · cancelled. `PublishMode` = live · dry_run.
- 멱등키 `pub:{contentId}:v{version}:{channel}:{mode}`. `checkDuplicate`: 같은 키의 비취소 작업, 같은 콘텐츠·채널의 열린 live 작업(scheduled/dispatching/unknown/failed), 이미 published된 live 작업(재게시 명시 확인 필요)을 중복으로 거절.
- `applyResult`는 live에 시도번호 필수(DEC-DISTRIBUTION-002 #1), `published`는 외부 ID 필수 + URL은 null 또는 자격정보 없는 HTTPS.
- `reconcileUnknown(confirmed_absent)` → `failed` + `retryable: true`. `retryFailed`는 retryable일 때 같은 작업을 `scheduled`로 되돌린다(같은 작업, attempts 누적).
- `preserveLateEvidence`는 늦은 증거를 버리지 않고 `requiresReconciliation`을 반환하지만 **저장 계층이 없어 보장이 아님**(주석 명시).
- `AdapterCapabilities`는 전부 `unverified`이며 `lookupByIdempotencyKey`만 대사 capability로 존재.
- `ContentItem`·`ChannelDraft`는 **영속 저장소가 없다**. `StoryRecord`(공개 원문)는 코드 내 빈 저장소이며 `distributionContentId`로 단방향 느슨한 연결.

### 1.3 충돌·공백 목록

| # | 관찰 | 영향 | 제안 |
|---|---|---|---|
| C1 | `private.is_admin()`과 `decideAccess(viewer,"admin")` 모두 **profiles.approval_status를 보지 않는다**. suspended/rejected 사용자도 admin 역할 행이 있으면 admin. | 정지된 관리자가 게시 콘솔·외부 게시 실행 가능 | 기존 함수 의미는 바꾸지 않고 `private.is_distribution_admin()`(admin 역할 AND approved) 신설, 서버 판정에 `need: "distribution_admin"` 추가. 기존 `is_admin` 보강 여부는 [결정] D1. |
| C2 | `authenticated`가 `private` 스키마 USAGE 보유. | 토큰/OAuth state를 `private`에 두면 테이블 grant 실수 한 번으로 노출 | 비밀 전용 스키마 `distribution_secrets`를 별도 생성, anon/authenticated USAGE 없음. |
| C3 | `ContentItem`·초안·작업 저장소 없음, `StoryRecord`도 DB 없음. | 승인/stale/대사 불변식을 DB에서 지킬 근거 없음 | 배포 원문·버전·채널 초안 리비전을 배포 도메인 테이블로 신설. `StoryRecord`와는 `story_slug` 텍스트 참조(FK 없음). |
| C4 | `PublishMode`에 수동 게시 없음, `JobStatus`에 manual_ready/awaiting_evidence/abandoned 없음. 플랜 §3의 수동 흐름 미반영. | 블로그 수동 게시가 live 상태기계와 섞임 | `mode='manual'`, 상태 3개 추가(§4). |
| C5 | Threads/Instagram은 컨테이너 생성→처리→게시 다단계(API readiness). 현재 `publish()` 단일 호출 + `dispatching` 한 상태. | 컨테이너 ID 선커밋·단계별 lease 복구 불가 | 상위 `status`는 유지하고 `phase` 보조축 + 시도(attempt) 테이블 추가. |
| C6 | `confirmed_absent` → `retryable:true`. `retryFailed`를 워커가 부르면 **사람 승인 없이 자동 재게시** 가능. UX S7은 "absence는 자동 재시도 허가가 아님". | 중복 게시 위험 | `retry_policy`를 `auto`/`operator_only`/`never`로 분리, `confirmed_absent`는 `operator_only`. `PublishError`에 `autoRetry` 추가(§8). **기존 동작 변경**이므로 [결정] D2. |
| C7 | `audit_events.actor_kind`에 worker/scheduler 없음. | 배포 이벤트 actor 표현 부족 | 배포 이벤트는 별도 append-only 테이블. `audit_events`는 보안 민감 관리 행위(연결·중지 스위치·권한)만 미러, 기존 `system` 값 사용. 기존 check 변경 없음. |
| C8 | 공급자 idempotency 없음(API readiness 확인). `lookupByIdempotencyKey`만 존재. | 응답 유실 대사 수단 부족 | capability `lookupByContainerStatus`, `lookupRecentPosts` 추가, `lookupByIdempotencyKey`는 세 채널 모두 `unsupported`. |
| C9 | Supabase 서버 클라이언트는 publishable key + 쿠키 세션만. service/secret key 모듈 없음(`config.ts`는 `sb_secret_` 거절). | 워커·토큰 저장 경로 미정 | 서버 전용 service 모듈은 별도 구현 작업에서 `server-only`로 신설(§7.4). |

---

## 2. 설계 원칙 (전체에 일관 적용)

1. **별도 도메인 경계**: 모든 신규 테이블은 `public.distribution_*` 접두사(데이터 API 노출 스키마), 비밀은 `distribution_secrets` 스키마(비노출). 기존 9개 테이블·함수·check는 수정하지 않는다. `public.set_updated_at()`은 **재정의하지 않고 재사용**한다.
2. **불변 스냅샷 + 가변 머리(head)**: 원문 버전·초안 리비전·승인·이벤트·증거·대사·권리 판정은 append-only. 가변 행은 "현재 포인터"와 상태 캐시뿐이다.
3. **승인은 해시에 묶인다**: 승인은 `(대상 리비전 ID, content_hash)`에 대한 기록이다. 새 버전/리비전은 새 해시이므로 이전 승인이 **부활할 수 없다**.
4. **unknown은 `confirmed_absent` 전 재전송 금지**: DB 전이 가드가 `unknown → scheduled`를 거부하고, 재실행은 `confirmed_absent` 대사 기록 + 운영자 재실행 승인 이벤트가 있어야 한다.
5. **원격 호출 전 선커밋(write-ahead)**: 컨테이너 생성 요청 전 `phase='container_requested'`, 게시 요청 전 `phase='publish_requested'`를 **커밋한 뒤** HTTP를 보낸다. 커밋 이후 결과를 모르면 그 단계의 규칙(§4.4)으로 분류한다.
6. **`published`는 증거 행이 있을 때만**: 작업의 `external_id/url`은 수락된 증거 행의 캐시다. 수동 채널은 운영자 증거 등록 필수.
7. **클라이언트 쓰기 없음**: anon/authenticated는 배포 테이블에 INSERT/UPDATE/DELETE 권한이 없다. 모든 쓰기는 서버(관리자 재확인 후) → service_role 전용 DB 함수.
8. **비밀은 로그·이벤트·증거에 들어가지 않는다**: 토큰, OAuth 응답 원문, 서명 URL 원문, 전체 원격 응답, 생성 프롬프트 금지. 요약 코드와 길이 제한 텍스트만.
9. **미디어는 권리 승인 없이 live job 불가, 기본 자동 파기 없음.**
10. **미확인 공급자 동작은 `unverified` capability로 차단**하고 [게이트]로 표시.

---

## 3. 엔티티 제안

엔티티 관계 요약:

```
distribution_contents ─1:N─ distribution_content_versions (불변)
        │                               │
        └─1:N─ distribution_channel_drafts ─1:N─ distribution_draft_revisions (불변, content_version 고정)
                                                     │
distribution_approvals (불변, 대상=content_version | draft_revision, hash 고정)
                                                     │
distribution_channel_connections ─────────────┐      │
        └─1:1─ distribution_secrets.credentials│      │
                                               ▼      ▼
                                       distribution_jobs ─1:N─ distribution_job_attempts (컨테이너 ID)
                                           │   │   └─1:N─ distribution_job_events (불변)
                                           │   └─1:N─ distribution_publication_evidence (불변, 정정은 새 행)
                                           └─1:N─ distribution_reconciliations (불변)
distribution_media_assets ─1:N─ distribution_media_rights_reviews (불변)
        └─1:N─ distribution_media_variants ─1:N─ distribution_media_exposures (서명 URL 발급 기록)
distribution_draft_revision_media (리비전↔variant/asset 순서)
distribution_capability_verifications (불변) · distribution_runtime_controls · distribution_scheduler_runs
distribution_secrets.oauth_states
```

공통 열 규약: `id uuid default gen_random_uuid()`(이벤트류는 `bigint identity`), `created_at timestamptz default now()`, 가변 테이블만 `updated_at` + `set_updated_at` 트리거. actor 열은 `auth.users(id)` FK, `on delete restrict`(기존 `audit_events`·orders와 동일; 사용자 삭제 절차는 [결정] D9).

표의 "변경 actor" 약어: **SA**=서버 액션(관리자 재확인 후 service_role 함수), **W**=dispatch 워커(service_role), **SYS**=DB 트리거/함수, **—**=변경 불가.

### 3.1 원문·초안·승인

| 엔티티 | 목적 | 핵심 필드 | 불변조건 | 인덱스/unique | 관계 | 보존 | 조회 / 변경 |
|---|---|---|---|---|---|---|---|
| `distribution_contents` | 배포 원문 머리 | id, owner_id(MVP=생성 관리자), story_slug(nullable, slug check), current_version_no, archived_at | current_version_no = 버전 테이블 최대값(SYS 갱신). 삭제 대신 archive | pk; `(owner_id, updated_at desc)` | 1:N versions, drafts | 영구(작업/증거가 참조) | admin / SA |
| `distribution_content_versions` | 원문 불변 스냅샷 | content_id, version_no(≥1), title, body, target_path(`/`시작, `//`금지), source_refs jsonb, media_asset_ids uuid[], content_hash(sha256 hex), change_summary(≤500), created_by | **UPDATE/DELETE 금지(트리거)**. version_no 연속 증가는 함수가 잠금(`for update` on content) 후 부여 | unique(content_id, version_no); unique(content_id, content_hash)는 두지 않음(되돌림=새 버전 허용) | N:1 contents | 영구 | admin / SA(insert만) |
| `distribution_channel_drafts` | 채널별 초안 머리 | content_id, channel(blog/threads/instagram), current_revision_id, target_connection_id(nullable; blog는 null 가능) | channel check. 머리는 포인터만 | unique(content_id, channel) | 1:N revisions | 영구 | admin / SA |
| `distribution_draft_revisions` | 채널 초안 불변 스냅샷 | draft_id, revision_no, **content_version_id(고정)**, text, link_url(nullable https), utm jsonb, target_connection_id, target_external_account_id(스냅샷), validation jsonb(규칙별 pass/fix/unverified + 근거 출처·시각), revision_hash, created_by | UPDATE/DELETE 금지. revision_hash = hash(text, link, utm, media 순서·variant, 대상 계정, content_version_id) | unique(draft_id, revision_no) | N:1 drafts, content_versions; 1:N revision_media | 영구 | admin / SA(insert만) |
| `distribution_draft_revision_media` | 리비전의 미디어 순서 | revision_id, position, asset_id, variant_id(nullable), alt_text | 리비전과 같이 불변 | pk(revision_id, position) | → assets/variants | 리비전과 동일 | admin / SA |
| `distribution_approvals` | 승인·철회·반려 불변 기록 | subject_type(`content_version`/`draft_revision`), subject_id, subject_hash, decision(`approved`/`rejected`/`revoked`), reason, actor_id, checklist jsonb(사실·출처·권리·협찬 표기 확인 항목) | UPDATE/DELETE 금지. subject_hash = 대상 행의 hash와 일치(함수가 검증). `revoked`는 직전 approved를 가리킴 | `(subject_type, subject_id, created_at desc)` | → versions/revisions | 영구 | admin / SA(insert만) |

**파생 판정(뷰 또는 서버 함수, 저장 안 함)** [제안]:
- 원문 검토 상태: 최신 버전에 유효(철회 안 된) approved가 있으면 `approved`, 없으면 `needs_review`.
- 초안 stale: `revision.content_version_id ≠ 최신 content_version` → `stale`. 리비전 승인: 최신 리비전 + 유효 approved + 원문 버전도 approved일 때만 `approved`.
- UX 상태축 ①(콘텐츠 승인/stale)은 이 파생값으로만 표시한다.

### 3.2 연결·자격증명·readiness

| 엔티티 | 목적 | 핵심 필드 | 불변조건 | 인덱스/unique | 관계 | 보존 | 조회 / 변경 |
|---|---|---|---|---|---|---|---|
| `distribution_channel_connections` | 외부 계정 연결 상태(비밀 없음) | channel(threads/instagram; blog는 선택적 "대상 블로그" 레코드 `kind='manual_target'`), kind(`oauth`/`manual_target`), external_account_id, display_name, login_path(instagram: `instagram_login`…), status(§4.3), account_visibility(`public`/`private`/`unknown`, Threads), scopes_granted text[], token_issued_at, token_expires_at, authorization_expires_at(Threads 90일), last_refreshed_at, last_checked_at, last_error_code, connected_by, disconnected_at | external_account_id는 연결 후 **변경 금지**(계정 바뀌면 새 행). 만료 시각은 공급자 응답 값만, 추정 금지(없으면 null) | unique(channel, external_account_id) where status ≠ 'disconnected'; **MVP: unique(channel) where status in 활성집합**(단일 운영자) | 1:1 secrets.credentials; 1:N jobs | 해제 후 메타데이터 영구(작업 참조), 비밀은 즉시 삭제 | admin(비밀 없는 열) / SA, W(갱신·상태) |
| `distribution_secrets.credentials` | 토큰 암호문 | connection_id(pk), storage_kind(`envelope_v1`/`vault`), ciphertext bytea 또는 vault_secret_id uuid, key_version int, token_fingerprint(앞뒤 일부 해시, 원문 아님), rotated_at | anon/authenticated 접근 불가(스키마 USAGE 없음). 원문 토큰 열 없음 | pk | → connections | 해제·폐기 즉시 행 삭제 | service_role 전용 함수만 |
| `distribution_secrets.oauth_states` | OAuth state nonce | state_hash(sha256), user_id, channel, redirect_uri, return_path(내부 경로), code_verifier 암호문(PKCE 지원 시, [게이트]), expires_at(≤10분), consumed_at | 1회용: `consumed_at is null and expires_at > now()`일 때만 원자적 소비(`update … returning`). 다른 user_id 세션의 콜백 거부 | unique(state_hash); `(expires_at)` | — | 소비/만료 후 24h 내 정리 가능(업무 가치 없음) | service_role 전용 |
| `distribution_capability_verifications` | capability 확인 근거 | channel, connection_id(nullable=채널 공통), capability(§8 목록), state(`supported`/`unsupported`/`unverified`), basis(`official_doc`/`tester_live`/`dry_run`), source_ref(문서 URL·검증 작업 ID), scope_note, verified_by, approved_by(Master 승인 기록자), verified_at | 불변. `supported`는 basis=`tester_live` + approved_by 필수(문서만으로 supported 금지, types.ts 원칙) | `(channel, capability, verified_at desc)` | → connections | 영구 | admin / SA |

### 3.3 작업·시도·이벤트·증거·대사

| 엔티티 | 목적 | 핵심 필드 | 불변조건 | 인덱스/unique | 관계 | 보존 | 조회 / 변경 |
|---|---|---|---|---|---|---|---|
| `distribution_jobs` | 채널별 실행 단위 | id(기존 `isValidJobId` 호환 텍스트 또는 uuid, [결정] D6), idempotency_key, content_id, content_version_id, draft_revision_id, approval_id(실행 근거 승인), channel, mode(`live`/`dry_run`/`manual`), connection_id(nullable: manual/dry_run), status(§4.1), phase(§4.2), hold_reason(§4.5, nullable), scheduled_at(UTC), schedule_tz(IANA, 표시용), attempts, max_attempts(1~10), retry_policy(`auto`/`operator_only`/`never`), lease_owner, lease_expires_at, last_attempt_at, external_id, external_url, has_issues bool, issues jsonb(코드 목록), last_error jsonb(code/message≤500/retryable/autoRetry), reconciliation_required bool, cancel_requested_at, created_by, version int | **스냅샷 열 불변**: idempotency_key, content_id, content_version_id, draft_revision_id, approval_id, channel, mode, connection_id, created_by. 종료 상태(published, dry_run_succeeded, cancelled, abandoned) 역전 금지. `status='published'` ⇒ 수락 증거 행 존재 + external_id not null(live/manual). `mode='dry_run'` ⇒ status ≠ published. `mode='manual'` ⇒ channel='blog'(MVP), phase='none'. channel='blog' ⇒ mode in (manual, dry_run). `status='unknown'` → 대사 함수만 변경. attempts ≤ max_attempts. 갱신마다 version+1 | **partial unique(idempotency_key) where status ≠ 'cancelled'** (기존 checkDuplicate 의미). **partial unique(content_id, channel) where mode in (live, manual) and status in (scheduled, dispatching, unknown, failed, manual_ready, awaiting_evidence)** (열린 작업 1개). due: `(scheduled_at) where status='scheduled' and hold_reason is null`; lease 회수: `(lease_expires_at) where status='dispatching'`; 대사 큐: `(updated_at) where status='unknown' or reconciliation_required`; 목록: `(content_id, channel, created_at desc)` | → versions, revisions, approvals, connections; 1:N attempts/events/evidence/reconciliations | 영구(dry_run은 [결정] D10에 따라 정리 가능) | admin(전 열; lease 열 포함 운영 열) / SA(생성·취소·대사·재실행 승인), W(claim·전이) |
| `distribution_job_attempts` | 시도별 원격 단계 기록 | job_id, attempt_no, phase_reached, provider_container_id, container_status(`IN_PROGRESS`/`FINISHED`/`PUBLISHED`/`ERROR`/`EXPIRED`/null), container_created_at, publish_requested_at, publish_response_at, outcome(`published`/`failed`/`unknown`/`pending`), error_code, media_exposure_id | **provider_container_id는 publish 요청 전에 커밋**(함수 순서로 강제: `publish_requested_at` 설정은 container_id not null일 때만). 컨테이너 ID 1회 기록 후 변경 금지. 다른 시도의 컨테이너 재사용 금지([게이트] G-T3) | unique(job_id, attempt_no); **unique(channel, provider_container_id) where not null** | N:1 jobs | 영구 | admin / W |
| `distribution_job_events` | 상태 전이 감사(불변) | id bigint identity, job_id, seq, from_status, to_status, from_phase, to_phase, hold_from/hold_to, actor_kind(`admin`/`worker`/`scheduler`/`system`), actor_id(admin일 때), attempt_no, reason_code, summary(≤500, 비밀 금지), scheduler_run_id, created_at | UPDATE/DELETE 금지(트리거, service_role 포함). 작업 상태 변경 트리거가 **같은 트랜잭션에서 자동 기록**(앱이 빠뜨릴 수 없음) | unique(job_id, seq); `(job_id, created_at)` | N:1 jobs | 영구 | admin / SYS(insert만) |
| `distribution_publication_evidence` | 게시 증거(자동·수동·늦은 도착) | job_id, attempt_no(nullable), source(`provider_response`/`provider_lookup`/`operator_manual`/`late_arrival`), external_post_id, external_url(https, 자격정보 없음), url_host, external_account_id, observed_at, recorded_by(수동), method_note(≤1000; ID만일 때 확인 위치·방법 권고), status(`accepted`/`conflict`/`pending_review`/`superseded`/`rejected`), supersedes_id, correction_reason, issues jsonb(Instagram config_issue) | 불변(정정은 새 행 + 이전 행을 `superseded`로 표시하는 **상태 열만** 함수가 변경). job당 accepted 1개. 수동 URL은 호스트 허용목록([결정] D7: blog.naver.com, m.blog.naver.com 등). 서버 크롤링 없음. late_arrival·conflict는 job.reconciliation_required=true 설정 | partial unique(job_id) where status='accepted'; **partial unique(channel, external_account_id, external_post_id) where status='accepted'**(다른 작업이 같은 게시물 주장 시 accept 거부 → conflict 행으로 보존); `(external_url)` | N:1 jobs | 영구 | admin / SA(수동), W(자동) |
| `distribution_reconciliations` | unknown·충돌 대사 기록(불변) | job_id, attempt_no, method(`provider_container_status`/`provider_recent_posts`/`operator_manual`), finding(`found_published`/`confirmed_absent`/`still_unknown`/`absence_candidate`), checked_scope(조회 계정·기간·필터), observed_at, observation(≤1000), evidence_id(found_published일 때), decided_by, next_check_at, next_check_owner | 불변. `confirmed_absent`는 **admin actor + method + checked_scope + observed_at + observation 필수**. 워커는 `absence_candidate`까지만 기록 가능(자동 confirmed_absent 금지). timeout·조회 실패·검색 0건 단독으로는 confirmed_absent 불가(필수 필드로 강제, 판단 근거 텍스트 요구) | `(job_id, created_at desc)` | N:1 jobs, evidence | 영구 | admin / SA, W(candidate·still_unknown만) |

### 3.4 미디어·권리

| 엔티티 | 목적 | 핵심 필드 | 불변조건 | 인덱스/unique | 관계 | 보존 | 조회 / 변경 |
|---|---|---|---|---|---|---|---|
| `distribution_media_assets` | 업로드 원본 | storage_bucket(비공개), storage_path, mime, bytes, width, height, sha256, uploaded_by, origin(`own`/`licensed`/`third_party`/`ai_generated`), rights_status(캐시: `pending`/`approved`/`rejected`/`revoked`/`expired`), retention_hold bool, delete_requested_at, deleted_at | sha256·크기·경로 불변. 권리 캐시는 최신 rights review로만 갱신(SYS). **삭제 조건**: 비종료 작업 참조 0, retention_hold=false, 보존 기간 경과([결정] D8), admin 명시 요청 — 자동 일괄 파기 없음 | unique(storage_bucket, storage_path); `(sha256)` | 1:N rights/variants | 정책 기간([결정]), 기본 무기한 | admin / SA |
| `distribution_media_rights_reviews` | 권리·동의 판정(불변) | asset_id, decision(`approved`/`rejected`/`revoked`), creator, license_type, license_ref(증빙 파일 비공개 경로 + sha256), portrait_consent(`not_applicable`/`obtained`/`missing`) + consent_ref, allowed_channels text[], valid_until(nullable), ai_generated bool, restrictions(≤1000), reviewer_id | 불변. approved ⇒ license_ref 또는 origin='own' 근거 필수; 인물 포함 시 consent obtained 필수. 증빙 파일은 권리 판정보다 오래 보존 | `(asset_id, created_at desc)` | N:1 assets | 자산보다 길게(분쟁 대비, [결정] D8) | admin / SA |
| `distribution_media_variants` | 채널 규격 변환본(예: Instagram JPEG) | asset_id, purpose(`instagram_feed`…), mime, width, height, bytes, sha256, storage_path, transform_note | 권리는 원본을 따름. Instagram 변환본: JPEG·sRGB·폭 320~1440·비율 4:5~1.91:1·≤8MB(문서 기준, 실검증 전 validation=unverified 병기) | unique(asset_id, purpose, sha256) | N:1 assets | 원본과 동일 | admin / SA, W |
| `distribution_media_exposures` | 공급자가 내려받을 임시 공개 URL 발급 기록 | variant_id, attempt_id, issued_at, expires_at, url_sha256(서명 URL 원문 저장 금지), method(`signed_url`/`temp_public_path`), withdrawn_at | expires_at ≥ 컨테이너 처리 상한 + 여유([게이트] G-I5). 서명 URL은 만료 전 취소가 어렵다는 전제로 TTL을 짧게 | `(attempt_id)`; `(expires_at)` | → variants, attempts | 90일 등 운영 기간([결정]) | admin / W |

**live job 생성/claim 시 미디어 검사** [제안]: 리비전의 모든 미디어 원본 rights_status='approved', valid_until 미경과, allowed_channels에 해당 채널 포함, 필요한 variant 존재. 권리 철회/만료 시 해당 미디어를 참조하는 scheduled 작업에 `hold_reason='rights_blocked'`(SYS). 이미 게시된 외부 게시물은 남는다는 사실만 기록하고 삭제를 약속하지 않는다.

### 3.5 운영 제어

| 엔티티 | 목적 | 핵심 필드 | 불변조건 | 조회 / 변경 |
|---|---|---|---|---|
| `distribution_runtime_controls` | 전역/채널 실행 중지 스위치 | scope(`global`/`threads`/`instagram`/`blog`), live_paused bool, reason, changed_by, changed_at | scope pk. 변경 시 `audit_events` 미러(`action='distribution.pause'/'resume'`). 재개는 reason 필수, 밀린 작업은 자동 일괄 실행 안 함(§5.3) | admin / SA |
| `distribution_scheduler_runs` | tick 호출 기록(중복·누락 감시) | run_id(스케줄러 제공 또는 서버 생성), source(`vercel_cron`/`pg_cron`/`manual`), received_at, finished_at, claimed_count, outcome, duplicate_of | unique(source, run_id) — 같은 run 중복 호출 감지(처리 자체는 claim이 보호) | admin / W |
| 코드 상수 `DISTRIBUTION_LIVE_ENABLED = false` | 기존 `TRANSACTIONS_ENABLED`와 같은 코드 스위치 | — | 환경변수로 켤 수 없음. 켜려면 결정 기록 + 코드 리뷰 | 코드 리뷰 |

---

## 4. 상태 모델 — UX 독립 상태축과의 대응

UX S1~S8의 세 독립 축을 데이터에서 다음처럼 분리한다. 서로의 값을 덮지 않는다.

| 축 | 저장 위치 | 값 |
|---|---|---|
| ① 콘텐츠 승인/stale | 파생(§3.1) | needs_review · approved · stale (+ 리비전별 approved/needs_review) |
| ② 연결/readiness | connections.status + capability_verifications | §4.3 + capability state |
| ③ 작업 결과 | jobs.status (+phase, has_issues) | §4.1 |
| 보조 표시 | jobs.hold_reason, 파생 지연 여부 | §4.5 (결과값 아님) |

### 4.1 작업 상위 상태 (`JobStatus` 확장)

| status | 의미 | mode | 종료? |
|---|---|---|---|
| scheduled | 예약/즉시 대기 | live, dry_run | 아니오 |
| dispatching | 워커가 단계 진행 중(phase로 세분) | live, dry_run | 아니오 |
| published | 수락 증거 있음. `has_issues=true`이면 UX "게시됨 · 확인 필요"(= Instagram `published_with_issues`) | live, manual | **예** |
| dry_run_succeeded | 모의 성공, 외부 게시 없음 | dry_run | 예 |
| failed | 실패. 재시도는 retry_policy·last_error에 따름 | live, dry_run | 아니오 |
| unknown | 게시 여부 불명. 대사 전 재전송 금지 | live, manual | 아니오 |
| cancelled | 실행 전 취소 | 전부 | 예 |
| **manual_ready** | 수동 게시 자료 준비(내보내기 가능) | manual | 아니오 |
| **awaiting_evidence** | 운영자가 "게시 마침" 선언, 증거 대기 | manual | 아니오 |
| **abandoned** | 수동 작업 중단(외부에 남았을 수 있음 고지) | manual | 예 |

`published_with_issues`를 별도 status로 두지 않는 이유: 상위 집계(성공/실패/unknown)가 깨지지 않고, "게시됨"이라는 외부 사실과 "경고"를 분리해 보존할 수 있다. 집계 함수는 published 수 + issues 수를 함께 반환한다(§8).

### 4.2 API 단계 보조축 `phase` (status='dispatching' 또는 'unknown'에서 의미)

`none → container_requested → container_created → processing → ready → publish_requested → confirming → done`

- Threads 텍스트: `container_requested → container_created → (약 30초 대기 권장, 다음 tick) → ready → publish_requested → confirming`. 상태 조회로 `FINISHED` 확인 후 ready.
- Instagram 단일 이미지: `container_requested → container_created → processing(tick마다 1회 status_code 조회, 5분 상한) → ready → publish_requested → confirming(permalink 조회)`.
- 한 tick은 한 단계만 수행하고 lease를 놓는다(Vercel 함수 시간 한도 내, API readiness §5).
- `reauth_required`·`manual_ready`·`awaiting_evidence`는 phase가 아니다: 앞은 연결 축(§4.3), 뒤 둘은 manual 상위 상태.

### 4.3 연결 상태

`not_connected → connecting → connected ⇄ refresh_due → connected` / `connected|refresh_due → reauth_required → connecting → connected` / `* → revoked`(공급자 철회 감지) / `* → disconnected`(운영자 해제, 비밀 삭제) / `connecting → error`.

- `reauth_required` 진입 근거: refresh 실패, 토큰 만료, 권한 부여 만료(Threads 비공개 프로필 90일), 필요 scope 누락, 공급자 인증 오류 코드. 진입 시 해당 connection의 scheduled 작업에 `hold_reason='reauth_required'`(SYS).
- 재인증 콜백이 **다른 external_account_id**를 반환하면 기존 행을 바꾸지 않고 거부(또는 새 연결 행 생성 후 기존 작업은 재승인 필요). 작업의 connection_id는 불변.
- `refresh_due`: token_issued_at+24h 경과 AND expires_at까지 남은 기간 ≤ 사이트 정책값([결정] D11, 예: 7~14일). 워커가 연결 갱신 단계를 작업 단계와 별도로 실행.

### 4.4 작업 전이표 (누가 · 근거 · 자동 재시도)

| # | 전이 | actor | 필수 근거/검사 | 자동? |
|---|---|---|---|---|
| T1 | (생성) → scheduled | SA(admin) | 최신 원문 버전 approved, 최신 리비전 approved(해시 일치), 권리 통과, validation에 `fix` 없음·`unverified` 규칙 차단, capability supported(live), connection connected, 전역/채널 미중지, partial unique 통과, 예약 시각 미래·시간대 포함 | — |
| T2 | (생성) → manual_ready | SA | T1에서 연결·capability 대신 blog 대상 지정 | — |
| T3 | scheduled → dispatching | W(claim) | due, hold 없음, lease 원자 획득(`for update skip locked`), attempts<max, **claim 시점 재검사**(승인·권리·연결·중지). attempts+1, 새 attempt 행 | 예(스케줄러) |
| T4 | dispatching: phase 진행 | W | write-ahead 커밋 후 HTTP. container_id는 받는 즉시 커밋 | 예 |
| T5 | dispatching(phase ≤ container_requested, 컨테이너 ID 미수신) → failed(retry_policy=auto) | W | 게시 요청 미발송 → 공개 게시물 생성 불가. 고아 컨테이너는 24h 후 EXPIRED(400/24h 한도 소모만) | **예**(백오프, max_attempts 내) |
| T6 | dispatching(container_created~ready) lease 만료 → dispatching 재개 | W | publish_requested_at 없음 확인 → 컨테이너 상태 조회부터 재개(같은 컨테이너, 같은 attempt) | 예 |
| T7 | dispatching(phase=publish_requested/confirming) 응답 유실·lease 만료 → **unknown** | W | publish 요청이 나갔을 수 있음 | 아니오(재전송 금지) |
| T8 | dispatching → published | W | 공급자 응답 미디어 ID → evidence(provider_response) accepted. Instagram config_issue → has_issues | — |
| T9 | dispatching → failed | W | 확정적 오류(컨테이너 ERROR/EXPIRED, 검증 거절). EXPIRED/ERROR 컨테이너는 publish 미성공 → retry_policy=operator_only(새 컨테이너 = 새 attempt) | 아니오(기본). 공급자 4xx 사전 거절은 never |
| T10 | unknown → unknown (still_unknown / absence_candidate) | W 또는 SA | 대사 행 기록, next_check_at | — |
| T11 | unknown → published | W(provider_lookup: 컨테이너 PUBLISHED + 최근 게시물 목록에서 시각·본문 매칭) 또는 SA(operator_manual) | evidence accepted(계정·버전 일치). Instagram Login caption 조회 [게이트] G-I4 → 매칭은 시각·media_type·permalink + 운영자 확인 | — |
| T12 | unknown → failed(retry_policy=operator_only, reason=CONFIRMED_ABSENT) | **SA(admin)만** | reconciliation `confirmed_absent` 필수 필드(§3.3). 워커 불가 | — |
| T13 | failed(operator_only) → scheduled | **SA(admin) 재실행 승인** | T1 재검사 전부 + 대사 기록 존재(unknown 경유 시) + reconciliation_required=false + 새 attempt는 **새 컨테이너**(G-T3 확인 전) + 이벤트 reason `operator_rerun_approved` | — |
| T14 | failed(auto) → scheduled | W | last_error.autoRetry=true, attempts<max, 백오프 시각 | 예 |
| T15 | scheduled/failed/manual_ready → cancelled | SA | dispatching·unknown·published·awaiting_evidence 불가(기존 cancelJob 원칙). dispatching 중 취소 요청은 cancel_requested_at만 기록 → 워커가 publish_requested 이전 단계에서만 존중 | — |
| T16 | manual_ready → awaiting_evidence | SA | 운영자 "블로그에서 게시를 마쳤습니다" | — |
| T17 | awaiting_evidence → published | SA | evidence operator_manual: HTTPS URL(허용 호스트) 또는 외부 ID + 대상 블로그 + 확인자·시각 + (ID만이면 방법 메모) | — |
| T18 | manual_ready/awaiting_evidence → abandoned | SA | 이유 필수, "외부에 남았을 수 있음" 확인 체크 | — |
| T19 | awaiting_evidence → unknown | SA | 운영자가 게시 여부 불확실 선언 → 대사 화면 | — |
| T20 | published → (변화 없음) / evidence 정정 | SA | 새 evidence 행 + 이전 superseded + correction_reason. status 역전 불가 | — |
| T21 | 모든 비종료 → reconciliation_required=true | SYS | late_arrival 또는 conflict evidence insert. 해제는 SA 대사 기록 후 | — |

DB 강제 [제안]: `distribution_jobs_guard` 트리거가 (old.status, new.status) 허용 쌍 표를 검사하고, 종료 상태 역전·스냅샷 열 변경·`unknown→scheduled` 직접 전이·`unknown→failed`에 대응 `confirmed_absent` 대사 행 부재·`failed→scheduled`에서 retry_policy=operator_only인데 재실행 승인 이벤트 부재를 거부한다. 앱 순수 함수(jobs.ts)와 같은 표를 공유하고 tests/db에서 전 조합 대조(기존 orders와 같은 방식).

### 4.5 보조 표시 `hold_reason` (결과값을 덮지 않음)

`stale`(원문/리비전 교체) · `reauth_required` · `paused`(전역/채널 중지) · `rights_blocked` · `capability_unverified` · `awaiting_operator`(기한 지난 예약 재확인). scheduled 작업에만 설정되며 claim을 막는다. 해제는 원인 해소 + SA 확인(재인증·재개 후 **자동 일괄 실행 금지**: 기한이 지난 작업은 `awaiting_operator`로 바꾸고 "새 시각 / 지금 실행 확인 / 취소" 중 선택, UX S6·S8). `stale`은 해제 불가 — 취소 후 새 버전으로 새 작업(기존 partial unique가 이전 열린 작업 정리를 강제).

"지연"은 저장하지 않고 `scheduled_at < now() - 허용지연`으로 파생한다(SLA 수치 [결정] D12).

---

## 5. 화면 액션 ↔ 데이터 연산

| UX 화면/액션 | 서버 연산(서비스 함수) | 데이터 제약 |
|---|---|---|
| S2 저장하여 새 버전 | `create_content_version` | content 행 잠금, version_no+1, 해시 계산, 이전 버전 참조 scheduled 작업 `hold_reason=stale`(SYS), 승인 이동 없음 |
| S2 과거 버전 복원 | 위와 동일(과거 내용으로 새 버전) | 승인·증거 이전 금지 |
| S2 동시 수정 | 기대 version_no 비교 | 불일치 시 CONFLICT, 입력은 클라이언트에 보존 |
| S3 채널 초안 저장 | `create_draft_revision` | content_version_id = 저장 시점 최신 버전 고정, 이전 리비전 승인 자동 무효(해시 불일치) |
| S3 검증 다시 확인 | validation 재계산 후 새 리비전 또는 리비전 validation 결과를 별도 `draft_validation_runs`(선택) | 미확인 규칙은 `unverified`(통과 아님) |
| S4 승인 / 재승인 | `record_approval` | subject_hash 일치, 미리 체크된 동의 금지(체크리스트 항목은 서버에서 필수 true 확인) |
| S4 예약 확정 / 지금 게시 요청 | `create_job` (T1/T2) | 접수 응답 유실 시 클라이언트는 `idempotency_key`로 기존 작업 조회(재요청 금지) |
| S4 예약 시각 변경 | `reschedule_job` | scheduled만, 재승인 불요(UX 권고), 이벤트 기록 |
| S5 내보내기 / 복사 | 작업 이벤트 `exported`(선택) | 상태 변화 없음 — 내보내기는 게시 아님 |
| S5 게시 마침 / 증거 확정 / 중단 | T16 / T17 / T18 | §3.3 evidence 제약 |
| S6 연결 시작 / 콜백 | `oauth_begin` / `oauth_complete` | state 1회 소비, 계정 일치 확인, credentials 암호화 저장 |
| S6 재인증 후 보류 작업 | `release_hold` | 기한 지난 작업은 awaiting_operator, 일괄 실행 없음 |
| S6 연결 해제 | `disconnect_connection` | 비밀 즉시 삭제, scheduled 작업 hold, 외부 게시물 유지 고지, audit 미러 |
| S7 외부 결과 조회 | 워커/서버 `lookup_*`(capability supported일 때만) | 결과는 reconciliation 행, 조회 실패≠부재 |
| S7 게시 확인 / 부재 확인 / 여전히 불명 | T11 / T12 / T10 | 동시성: 대사 저장 시 job.version 기대값 비교, 늦은 증거와 충돌 시 확정 거부 |
| S8 실패 채널 재시도 | T14(자동) 또는 T13(운영자) | 성공 채널 재게시 불가(작업이 채널별) |
| S8 취소 | T15 | 경합 시 "취소되지 않았을 수 있음" = cancel_requested_at 기록 후 결과 조회 |
| S8 새 실제 게시 실행 중지/재개 | `set_runtime_control` | 진행 중 publish_requested 단계는 중지 불가함을 표시, audit 미러 |

---

## 6. 스케줄러 인터페이스 (느슨한 결합)

스케줄러는 "깨우기"만 하고 상태·중복 방지는 전부 DB가 맡는다. 어떤 스케줄러든 같은 엔드포인트·같은 claim 함수를 사용한다.

```
[Vercel Pro Cron (GET, Authorization: Bearer CRON_SECRET)]  ─┐
[Supabase pg_cron → pg_net HTTP POST (Vault에 둔 tick secret)]─┼→ /api/internal/distribution/tick (서버 전용 라우트)
[운영자 수동 tick (admin, 개발·장애 시)]                       ─┘      │
                                                                       ├ scheduler_runs insert (중복 run 감지)
                                                                       ├ DISTRIBUTION_LIVE_ENABLED · runtime_controls 확인
                                                                       ├ claim_due_jobs(worker_id, limit, lease_seconds)  ← FOR UPDATE SKIP LOCKED
                                                                       ├ 작업당 1단계 실행(§4.2), write-ahead 커밋
                                                                       ├ recover_expired_leases()  (T6/T7 분류)
                                                                       └ refresh_due_connections()  (연결 축)
```

- 계약: tick은 **멱등·중복 호출 안전**(Vercel 문서: 중복 호출·무재시도·best effort). 한 tick 실패는 다음 tick이 DB 상태로 이어받는다.
- 인증: 비밀은 상수 시간 비교, 리다이렉트 없음, 응답에 작업 내용·건수 외 정보 없음. 비밀값은 서버 env(Vercel) 또는 Vault(pg_cron 측) — 값은 조사하지 않았다.
- pg_cron이 직접 공급자 API를 부르지 않는다(토큰을 DB 함수가 다루지 않게).
- **[결정] D3(미해결)**: Vercel Pro Cron(유료, Cron→Schedules 이전 예정) vs Supabase pg_cron+pg_net(프로젝트 플랜 제공 여부 미확인). 이 문서는 계정 플랜·API 제공 여부를 추정하지 않는다. 결정 전까지 tick은 운영자 수동 호출(dry_run)만 가정한다.

---

## 7. 권한: RLS · grants · 열 노출

### 7.1 MVP 역할 모델 (admin 단일)

- 게시 콘솔 진입·모든 배포 쓰기: **distribution_admin** = `role_assignments.role='admin'` AND `profiles.approval_status='approved'` (C1). 서버 `decideAccess(viewer, "distribution_admin")` + DB `private.is_distribution_admin()` 양쪽.
- 다중 작성자/승인자·자기 승인 금지는 §10 확장안으로 분리. MVP에서는 승인자=작성자일 수 있으며, 승인 기록에 actor가 남는다.

### 7.2 역할별 접근 표

| 객체 | anon | authenticated(비관리자) | authenticated + distribution_admin (RLS) | service_role (서버 전용) |
|---|---|---|---|---|
| contents / content_versions / drafts / draft_revisions / revision_media / approvals | 없음 | 없음 | SELECT(전 열) | 함수 경유 INSERT(버전·리비전·승인은 insert만) |
| channel_connections | 없음 | 없음 | SELECT(비밀 없는 열: last_error_code 포함) | 함수 경유 갱신 |
| `distribution_secrets.*` | 스키마 USAGE 없음 | 없음 | **없음** | 전용 함수만(아래 7.4) |
| jobs | 없음 | 없음 | SELECT(전 열) | claim/전이 함수 |
| job_attempts / job_events / evidence / reconciliations | 없음 | 없음 | SELECT | INSERT(이벤트는 트리거), 증거 상태 열만 함수 갱신 |
| media_assets / rights_reviews / variants | 없음 | 없음 | SELECT(storage_path 포함, 서명 URL 없음) | 함수 경유 |
| media_exposures | 없음 | 없음 | SELECT(url_sha256, 시각) | INSERT |
| capability_verifications / runtime_controls / scheduler_runs | 없음 | 없음 | SELECT | 함수 경유 |
| Storage bucket `distribution-media`(비공개) | 없음 | 없음 | 없음(관리자 미리보기는 서버가 짧은 서명 URL 발급) | 업로드·변환·서명 |
| Storage bucket `distribution-evidence`(권리 증빙, 비공개) | 없음 | 없음 | 없음(서버 경유 열람) | 전용 |

### 7.3 grants 적용 방식 [제안]

1. 기존 migration과 동일: 새 테이블 전부 `revoke all on table … from public, anon, authenticated;` 시퀀스도 회수.
2. admin 읽기는 `grant select (명시 열) on … to authenticated` + 정책 `for select to authenticated using ((select private.is_distribution_admin()))`. 열 목록 명시(새 열 추가 시 자동 노출 방지).
3. 클라이언트 쓰기 grant·정책은 **두지 않는다**(기존 원칙). 서버 액션도 사용자 세션 클라이언트로 쓰지 않는다.
4. 쓰기 함수: `public.distribution_*` 함수, `security invoker`(service_role이 RLS 우회), `revoke execute from public, anon, authenticated; grant execute to service_role`. PostgREST로 노출되지만 실행은 service_role만 가능 → Security Advisor의 "signed-in users can execute SECURITY DEFINER" 경고 대상 아님. 함수 안에서도 `p_actor_id`가 distribution_admin인지 재확인(서버 판정의 이중화). 대안(전용 노출 스키마 `distribution_api`)은 [결정] D4.
5. 불변 테이블: BEFORE UPDATE/DELETE 트리거로 거부(service_role 포함). truncate 권한도 service_role에서 회수 검토.
6. `private.is_distribution_admin()`: security definer, `search_path=''`, authenticated EXECUTE(기존 is_admin과 동일 패턴).

### 7.4 토큰/secret 저장 후보 (실제 비밀은 조사하지 않음)

| 후보 | 방식 | 장점 | 단점/게이트 |
|---|---|---|---|
| A. 앱 envelope 암호화 (권고) | 서버에서 AES-256-GCM, 데이터 키는 서버 env의 KEK로 래핑(`key_version`), 암호문을 `distribution_secrets.credentials`에. 접근은 service_role 전용 함수 `distribution_get_credential(connection_id)`(definer, 감사 이벤트 남김) | DB 유출만으로 복호화 불가, 플랫폼 기능 의존 적음, 키 회전 단순 | KEK 관리 책임(Vercel env), 함수가 암호문만 반환하도록 설계 |
| B. Supabase Vault | `vault.create_secret`, `credentials.vault_secret_id`. 복호화는 `vault.decrypted_secrets`를 읽는 definer 함수(service_role 전용) | 루트 키가 DB 밖, 운영 단순 | 프로젝트에서의 제공·권한 조건 [게이트] D5, DB 함수가 평문을 반환하는 구조 |
| C. 외부 secret manager | 토큰은 외부, DB에는 참조만 | 격리 최상 | 추가 비용·계정 = 사용자 결정 |

공통 규칙:
- **회전**: KEK `key_version` 증가 → 워커가 배치로 재암호화(구 키는 모든 행 이전 후 폐기). 공급자 토큰 자체는 refresh 때마다 교체(새 암호문, `rotated_at`).
- **폐기**: 연결 해제·계정 오연결·유출 의심 시 credentials 행 즉시 삭제 + connection `disconnected/revoked` + 해당 채널 scheduled 작업 hold + audit 미러. 공급자 측 토큰 철회 API 존재 여부는 [게이트] G-X1(미확인 시 "공급자 앱 설정에서 앱 제거" 운영 절차 안내).
- **로그 금지**: 토큰, code, state 원문, 교환 응답. token_fingerprint만 표시.
- 앱 시크릿(Meta app secret)·CRON_SECRET·service/secret key는 DB에 저장하지 않고 서버 env만. 브라우저 번들·`NEXT_PUBLIC_*` 금지(기존 `config.ts`의 `sb_secret_` 거절 유지).
- 서버 전용 service 클라이언트 모듈은 `server-only` import + secret 키 형식 검사로 구현 단계에서 신설(이 작업 범위 밖).

---

## 8. 앱 타입/함수 계약 변경점 (문서만, 코드 미작성)

| 대상 | 현재 | 변경 제안 | 호환성 |
|---|---|---|---|
| `PublishMode` | live·dry_run | + `manual` | 멱등키 `…:manual`. 기존 키 형식 유지 |
| `JobStatus` | 7개 | + manual_ready, awaiting_evidence, abandoned | UI 배지·summarize 갱신 필요 |
| 신규 `JobPhase` | — | §4.2 값 | live 전용 |
| 신규 `HoldReason` | — | §4.5 값 | — |
| `PublishJob` | id…lastError | + contentVersionId, draftRevisionId, approvalId, connectionId, phase, holdReason, retryPolicy, hasIssues, issues, reconciliationRequired, scheduleTz, leaseExpiresAt, version | 기존 필드 유지(추가만) |
| `PublishError` | code·message·retryable | + `autoRetry: boolean` (retryable=중복 위험 없음 판단, autoRetry=사람 없이 재전송 허용). | **C6**: `reconcileUnknown(confirmed_absent)`는 retryable:true, autoRetry:false로. [결정] D2 |
| `PublishResult` | published·dry_run_ok·rejected·failed·unknown | published에 `issues?: PublishIssue[]`; 단계 결과 `container_created{containerId}`, `container_status{status}` 추가 | 기존 kind 유지 |
| `PublishAdapter` | `publish(job, draft)` 단일 | 단계형: `createContainer`, `getContainerStatus`, `publishContainer`, `lookupMedia`, `listRecent(since)`; blog는 adapter 없음(manual) | DryRunAdapter는 단계형 모의로 확장 |
| `AdapterCapabilities` | … lookupByIdempotencyKey | + `lookupByContainerStatus`, `lookupRecentPosts`; lookupByIdempotencyKey는 세 채널 `unsupported`; 값의 출처는 capability_verifications | supported 승격 규칙 유지 |
| `makeIdempotencyKey` | contentId 패턴 1~64자 | uuid(36자) 허용 확인, mode manual | 변경 없음 수준 |
| `checkDuplicate` | open = scheduled/dispatching/unknown/failed | + manual_ready, awaiting_evidence; published 판정에 manual 포함. DB partial unique와 동일 집합 | 추가 |
| `applyResult` | dispatching → 결과 | 단계 결과 반영 `applyStepResult(job, attempt, step)`; published 시 evidence 동반 필수 | 기존 시도번호 규칙 유지 |
| `retryFailed` | retryable이면 scheduled | autoRetry=true만 워커 허용; operator_only는 `approveRerun(job, actor, reconciliationId)` 신설 | 동작 강화 |
| `reconcileUnknown` | 3분기 | + `absence_candidate`(워커), confirmed_absent는 actor·method·scope 필수 입력 | 시그니처 확장 |
| `cancelJob` | scheduled·failed | + manual_ready; `abandonManual` 신설 | 추가 |
| `summarize*` | published/failed/unknown/pending | + issues(채널 목록), manual 대기 → pending, abandoned 별도 목록(분모 포함 여부 [결정] D10) | DEC-DISTRIBUTION-002 #5 범위 분리 유지 |
| `late-evidence` | 순수 판정만 | 저장 계층에서 evidence(source=late_arrival) + job.reconciliation_required=true로 영속 | 주석의 "계약"이 보장으로 바뀜 |
| `isValidEvidenceUrl` | https·자격정보 없음 | + 수동 채널 호스트 허용목록 검사 함수(별도) | 추가 |
| 신규 `DistributionStore`(server-only) | 없음 | §5 서버 연산 인터페이스, 구현은 service_role 함수 호출 | — |
| `decideAccess` | approved_member·admin | + `distribution_admin`(admin + approved) | 기존 값 의미 불변 |
| `env.ts` | TRANSACTIONS_ENABLED | + `DISTRIBUTION_LIVE_ENABLED = false as const` | — |

---

## 9. migration 단계별 rollout / rollback

모든 단계는 **추가 전용**이며 기존 테이블·함수·check를 바꾸지 않는다. 각 단계는 별도 착수 지시 후 SQL 작성 → `tests/db` 하네스(PGlite) 실행 검증 → Master 검토 순. 원격 적용은 별도 사용자 승인.

| 단계 | migration(가칭) | 내용 | 사용 기능 | rollback |
|---|---|---|---|---|
| M1 | `…_distribution_content.sql` | `private.is_distribution_admin()`, contents/versions/drafts/revisions/revision_media/approvals, 불변 트리거, grants/RLS | 원문·초안·승인(UI 저장) | 데이터 없음: 역순 drop. 데이터 있음: 기능 플래그 off, 테이블 보존(forward-fix) |
| M2 | `…_distribution_jobs.sql` | jobs/attempts/events/evidence/reconciliations, guard 트리거, 이벤트 자동 기록, partial unique, runtime_controls, service_role 함수(create/claim/transition/reconcile) | 수동 블로그(AUTOPOST-MANUAL-BLOG-001), dry_run | 증거·이벤트가 생긴 뒤에는 **drop 금지**. 함수 교체로 수정, 중지 스위치 사용 |
| M3 | `…_distribution_connections.sql` | `distribution_secrets` 스키마(USAGE 없음), connections, credentials, oauth_states, capability_verifications, 자격증명 함수 | Threads 연결(AUTOPOST-THREADS-001) | 연결 전: drop. 연결 후: 모든 credentials 삭제(폐기) 후 스키마 보존 또는 drop |
| M4 | `…_distribution_media.sql` | media assets/rights/variants/exposures, Storage 버킷·정책(비공개) | Instagram(AUTOPOST-INSTAGRAM-001) | 업로드 전: drop. 이후: 업로드 중지, 파일·권리 증빙 보존 |
| M5 | `…_distribution_scheduler.sql` | scheduler_runs, (pg_cron 선택 시) cron 등록 별도 파일 | 예약 실행 | cron unschedule이 1차 롤백(데이터 무관) |

공통 사전 조건: 적용 전 백업/스냅샷, 기존 `tests/db` RLS·grant 매트릭스에 배포 테이블 추가, 전이표 전 조합 대조 시험, `DISTRIBUTION_LIVE_ENABLED=false` 상태 배포 후 dry_run 검증. 코드 롤백으로 이미 외부에 게시된 콘텐츠가 사라지지 않음을 운영 절차에 명시(플랜 §9).

---

## 10. 확장안: 다중 작성자·승인자 (MVP 범위 밖)

- 역할: 공용 `role_assignments.role` check 변경은 공통 계약 변경이므로 피하고 `distribution_role_assignments(user_id, role in ('editor','approver','operator'), granted_by, granted_at)` 별도 테이블 권고. 대안(공용 check 확장)은 Master 조정.
- 소유권: `distribution_contents.owner_id`는 M1부터 존재(MVP는 admin). editor는 `owner_id = auth.uid()` 행 SELECT + 서버 함수로 자기 원문/초안 작성.
- 승인 분리: `distribution_approvals`에 제약 "approver ≠ 대상 리비전 created_by"(설정값으로 on/off), 승인 요청 테이블 `distribution_review_requests`.
- 대사 `confirmed_absent`·재실행 승인·중지/재개는 `operator` 이상, 이중 검토(2인)는 `distribution_reconciliations`에 `second_reviewer_id` 추가로 지원.
- RLS: editor는 자기 콘텐츠의 작업 상태 열만 읽기, 연결·증거 원문 열·미디어 증빙은 operator 이상.
- 다계정 Meta 연결은 App Review·앱 게시 게이트(API readiness G-T1/G-T4) 이후. connections의 MVP 단일 연결 unique를 완화.

---

## 11. 보존·삭제 요약

| 데이터 | 기본 보존 | 삭제 조건 |
|---|---|---|
| 원문 버전·초안 리비전·승인·작업·이벤트·증거·대사·capability 기록 | 영구(감사·중복 방지 근거) | 데이터 삭제 요청 절차([결정] D9)로만. 작업 참조 원문은 archive만 |
| credentials | 연결 유지 중만 | 해제·철회·유출 시 즉시 |
| oauth_states | 소비/만료 후 짧게 | 24h 내 정리 허용 |
| media 원본·변환본 | 정책 기간([결정] D8), 자동 일괄 파기 없음 | 비종료 작업 참조 0 + retention_hold 해제 + 기간 경과 + admin 요청 |
| 권리 증빙·동의서 | 미디어보다 길게 | 정책 기간 경과 + 분쟁 없음 |
| media_exposures, scheduler_runs | 운영 기간(예: 90일, [결정]) | 기간 경과 정리 |
| dry_run 작업 | [결정] D10 | 선택적 정리(live 집계에 영향 없음) |

---

## 12. 게이트·결정 목록

**공급자 미확인 게이트 [게이트]** (해당 capability `unverified` 유지, 자동 처리 금지)

| ID | 내용 | 데이터 영향 |
|---|---|---|
| G-T3 | Threads 같은 컨테이너 재게시 동작, `PUBLISHED` 컨테이너→미디어 ID | 재실행은 새 컨테이너·새 attempt 고정, 컨테이너 상태만으로 published 확정 금지(목록 매칭 필요) |
| G-I3 | Instagram 권한 문자열(-publish/-publishing), 게시 한도 50/100 | scopes_granted는 실제 값 저장, 한도는 런타임 조회값 기록 |
| G-I4 | Instagram Login에서 caption 조회 가능 여부 | 자동 매칭은 시각·permalink, 확정은 운영자 |
| G-I5 | 공개 미디어 URL 방식·유효시간 | exposures TTL |
| G-X1 | 공급자 토큰 철회 API 존재 여부 | 폐기 절차 |
| G-X2 | Threads 글자 수 계산 규칙(이모지 바이트) | validation 경계값 `unverified` |
| G-X3 | PKCE 지원 여부 | oauth_states.code_verifier 사용 여부 |

**Master·사용자 결정 [결정]**

| ID | 질문 | 권고 |
|---|---|---|
| D1 | 기존 `is_admin`/`decideAccess("admin")`에 승인 상태 검사를 추가할지 | 배포는 신규 `is_distribution_admin` 사용, 기존 함수 보강은 별도 공통 계약 작업 |
| D2 | `confirmed_absent`의 자동 재시도 금지(코드 동작 변경) | 승인 권고(UX S7과 일치) |
| D3 | 스케줄러: Vercel Pro Cron vs Supabase pg_cron | 미해결. 플랜·제공 여부 확인 전 수동 tick만 |
| D4 | 쓰기 함수 위치: public(service_role 전용 실행) vs 전용 노출 스키마 | public + service_role 전용 |
| D5 | 토큰 저장: envelope(A) vs Vault(B) vs 외부(C) | A 권고, B는 제공 조건 확인 후 |
| D6 | job id 형식: 기존 텍스트 규칙 vs uuid | uuid(텍스트로 표현 시 기존 `isValidJobId` 통과) |
| D7 | 수동 블로그 증거 URL 허용 호스트 목록, URL 필수 여부 | blog.naver.com·m.blog.naver.com부터, URL 또는 ID+방법 메모 |
| D8 | 미디어·권리 증빙 보존 기간 | 결정 전 무기한 보존 |
| D9 | 사용자/데이터 삭제 요청 시 감사·증거 처리 | 개인 식별 열 가명화 + 기록 보존안 검토 |
| D10 | abandoned의 집계 분모 포함 여부, dry_run 정리 | abandoned는 별도 목록·분모 포함(미게시로 표시) |
| D11 | 토큰 refresh 시작 시점 | 만료 14일 전부터, 실패 시 매 tick 재시도 아닌 일 1회 |
| D12 | 지연 판정·확인 SLA 수치 | AUTOPOST-OPERATIONS-001에서 |
| D13 | 승인 유효 범위(시각 변경 재승인 불요, 계정 변경 재승인) | 리비전 해시에 대상 계정 포함 → 계정 변경 자동 재승인 |
| D14 | `confirmed_absent` 단일/이중 검토 | MVP 단일 admin + 필수 근거 |

---

## 13. 일관성 자체 점검

| 요구 | 반영 위치 |
|---|---|
| unknown 중복 방지: `confirmed_absent` 전 재전송 금지 | §2-4, T7·T10~T13, guard 트리거, partial unique(unknown 포함), 워커는 candidate까지만 |
| 원격 idempotency 없음 대응 | 사이트 멱등키 partial unique, write-ahead phase, 컨테이너 ID 선커밋·unique, capability unsupported |
| 단계 상태·published_with_issues | §4.1~4.2, attempts, evidence.issues, has_issues |
| reauth/권한 갱신 | 연결 축 §4.3, authorization_expires_at, account_visibility, hold_reason |
| 수동 게시 증거 | mode manual, T16~T19, evidence 허용 호스트, 크롤링 없음 |
| 외부 증거·감사 | evidence(불변·정정 행), events 트리거 자동 기록, audit_events 미러 |
| 권리·미디어 보존 | rights_reviews 불변, live job 검사, 자동 파기 없음, 증빙 장기 보존 |
| 기존 계약 비충돌 | 기존 테이블·함수 미수정, `set_updated_at` 재사용, 별도 스키마·접두사 |
| 비밀 서버 전용 | `distribution_secrets` 무 USAGE, service_role 전용 함수, 로그 금지 |

## 14. 검증·제약·Master 할 일

- 실행한 검증: 문서·코드 정적 읽기와 이 문서 내부 대조만. SQL·테스트·빌드·DB·외부 API 실행 없음. 이 설계가 실제로 동작한다는 증거가 아니다.
- 제약: 공급자 동작은 API readiness 문서 기준(실계정 미검증). Supabase 플랜별 기능(pg_cron, Vault, pg_net) 제공 여부 미확인. `docs/DB_VERIFICATION.md`는 앞 40줄만 읽었다.
- 파일 변경: 이 결과 파일 1개 생성. 다른 파일 수정 없음.
- Master 할 일: (1) C1·C6 충돌과 D1~D14 결정 정리, (2) M1(원문·승인)부터 SQL 작성 착수 여부 지시, (3) UX 배지 명칭과 §4 상태값 정렬을 CX-DESIGN 측에 전달, (4) 테스터 검증 작업(G-T3·G-I3·G-I4)을 별도 승인 범위로 등록.
