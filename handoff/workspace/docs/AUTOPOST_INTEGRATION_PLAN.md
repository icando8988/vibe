# 통합 콘텐츠 배포 시스템 개발 플랜

- 문서 ID: `AUTOPOST-INTEGRATION-PLAN-001`
- 담당: CX-MASTER-01
- 작성일: 2026-11-16 (Asia/Seoul)
- 상태: 검토 완료, 권리·운영 결정 대기
- 대상: 기존 `web/` 사이트와 Blog Posting Kit v1.07, Instagram Auto Posting Kit v1.11, Threads Auto Posting Kit v1.02

## 1. 총괄 판단

세 배포킷은 서로 독립된 Next.js/Supabase/Vercel 서비스이며, 회원별 BYOK·스케줄러·테이블·게시 상태를 각각 보유한다. 현재 사이트는 이미 `src/lib/distribution/`에 콘텐츠 초안, 승인, 작업 생성, 멱등키, 재시도, `unknown` 결과 대사 계약을 갖췄지만 영속 저장소와 실제 게시 어댑터는 준비되지 않았다. 따라서 세 앱을 통째로 합치거나 각 `schema.sql`을 실행하는 방식은 피하고, 기존 사이트의 배포 계약을 중심으로 새 통합 기능을 설계한다.

키트 NOTICE에는 BUYLIFE의 권리 보유와 사전 서면 허락 없는 추출·복제·수정·배포 제한이 기재되어 있다. “수강생 배포 키트”가 1개 사이트에 통합·수정하는 권한까지 포함하는지는 보고서만으로 확인되지 않았다. 그러므로 이 플랜은 기능·데이터 계약 수준의 통합 계획이며, 키트 코드·프롬프트·스키마 재사용은 서면 권한 범위 확인 전까지 차단한다. 권한이 확인되지 않으면 공식 플랫폼 문서와 독립 요구사항만으로 별도 구현하는 clean-room 경로를 사용한다.

## 2. 조사 결과와 통합 적합성

| 제품 | 실제 게시 경로 | 통합 판단 | 주요 위험·차이 |
|---|---|---|---|
| Blog v1.07 | 네이버 블로그는 Chrome 확장이 로그인된 브라우저에 내용을 입력하고 사용자가 마지막 게시 버튼을 누른다. 다른 블로그는 복사·붙여넣기 중심이다. | 우선 “검토된 콘텐츠 내보내기 + 수동 게시 + 게시 URL 등록”으로 제공한다. 네이버 자동입력 확장과 CDP는 MVP에서 제외한다. | 네이버 글쓰기 Open API는 2020-05-06 종료됐다. 키트 NOTICE 권한 불확실, CDP/자동 입력 정책 위험, 게시 결과 URL이 서버에 자동 회수되지 않음. |
| Threads v1.02 | Threads Graph API로 컨테이너 생성 후 게시하며, 회원별 Meta 앱·토큰·예약 실행을 사용한다. | 공식 API 사용 가능성 및 앱 검수를 확인한 뒤 서버 전용 어댑터를 별도로 구현한다. MVP 채널 후보 1순위. | 보고서상 토큰 갱신·unknown/대사·멱등성이 부족하며 RLS에서 토큰/앱 시크릿을 노출할 수 있다. 킷 SQL은 `set_updated_at` 함수와 공용 테이블/권한 설계를 충돌시킨다. |
| Instagram v1.11 | Instagram Graph API로 이미지 컨테이너 생성, 처리 완료 대기, 게시 및 permalink 확인. 피드와 캐러셀 경로가 있다. | 미디어 권리·규격·처리상태·공식 권한을 확정한 후 2차 API 채널로 진행한다. | 평문 토큰/API 시크릿과 과도한 RLS 접근, 갱신 없음, 게시 timeout 재시도 중복 위험, 결과 조회 실패를 실패로 기록하는 문제, SSRF 및 고아 미디어. |

보고서의 코드 관찰은 정적 분석이며 실제 계정/API 동작 검증은 아니다. Meta 권한, 앱 검수, 게시 제한은 연결 직전 공식 자료와 실제 승인 상태를 다시 확인한다.

### 2.1 UX/API readiness 후속 검토

2026-11-16 추가 결과 검토:

- `AUTOPOST-UX-001`: 검토 승인. 기존 사이트의 관리자 진입, 상태 안내, 배포 미리보기, 반응형 스타일을 근거로 화면 명세를 만들었다. 첫 MVP는 기존 `admin` 권한 안에 게시 콘솔을 제한하고, 작성자/승인자 분리는 별도 권한 계약에서 결정한다. 검토 필요/stale/승인, 연결/readiness, job outcome을 독립 상태축으로 표시한다. 원본 변경 시 미실행 예약을 stale 차단하고 이전 승인을 부활시키지 않는다. 상세는 `.ai/results/AUTOPOST-UX-001-CX-DESIGN.md`.
- `AUTOPOST-API-READINESS-001`: 문서 기반 검토 승인, 실계정 검증은 미완료. 단일 운영자 범위에서는 Threads Tester와 Instagram Standard Access 경로로 MVP 시험이 가능하다는 공식 문서 내용을 반영한다. 다계정 공개 출시 전 Meta App Review, 운영 정책 URL·데이터 삭제 요청 요건을 별도 게이트로 둔다. 상세 및 출처 목록은 `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md`.
- 네이버는 블로그 글쓰기 API 종료와 약관 때문에 수동 내보내기·사람 게시·URL/ID 증거 입력만 MVP 경로로 유지한다. 서버가 게시 URL을 자동 크롤링하는 것도 포함하지 않는다. 사이트 공개 도메인이 확정되면 사람이 네이버 공유하기 버튼을 눌러 사이트 콘텐츠 URL을 공유하는 보조 기능을 따로 검토할 수 있다.
- Vercel Hobby Cron은 하루 1회 및 ±59분 정확도라 예약 게시 요구를 충족하지 못한다. Vercel Pro Cron은 분 단위 실행이지만 Cron 제품이 Schedules로 이전 예정이고 중복 호출/실패 재시도 없음의 운영 부담이 있다. 대안은 Supabase pg_cron에서 보호된 dispatch 경로를 호출하는 것이며, 계정/환경에서의 이용 가능 여부 확인이 필요하다. 일 수십 건의 단일 운영자 MVP에서는 Queue가 우선 불필요하다. ([Vercel Cron 계획·정확도](https://vercel.com/docs/cron-jobs/usage-and-pricing), [운영/중복 호출](https://vercel.com/docs/cron-jobs/manage-cron-jobs))
- Threads와 Instagram 게시 API는 idempotency key를 제공한다고 확인되지 않았다. 원격 컨테이너 ID를 publish 요청 전에 DB에 커밋하고 상태 API로 대사하는 흐름을 공통 계약에 추가한다. 컨테이너의 `PUBLISHED` 상태만으로 게시물 ID를 얻을 수 있는지 미확인일 수 있으므로 사용자 게시물 목록/미디어 조회 및 운영 대사를 준비한다. 같은 컨테이너 재게시 가능성 확인 전 자동 재호출은 금지한다.
- 채널 내부 상태/증거 확장: `container_created`, `processing`, `ready`, `published_with_issues`, `reauth_required`, `manual_ready`, `awaiting_evidence`를 기존 상위 job 상태에 어떻게 매핑할지 AUTOPOST-DATA-001에서 결정한다. 상위 집계는 성공·실패·unknown과 경고를 보존한다.
- M1 migration은 Master 정적 검토 후 보완본을 수용했다. 리비전 미디어의 동일 트랜잭션 제약은 `created_at=now()`만으로 증명하지 않고 내부 `xid8` transaction ID를 비교한다. 해당 내부 열은 authenticated SELECT grants에서 제외된다. PostgreSQL 공식 문서는 `pg_current_xact_id()`가 `xid8`을 반환하고 subtransaction 안에서도 최상위 transaction ID를 반환한다고 명시한다. [PostgreSQL transaction ID functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-TXID-SNAPSHOT)
- M1은 **작성·정적 검토 완료**이며 DB/PGlite 적용 검증은 아직 하지 않았다. 원격 적용 전 migration/RLS/grants 검증이 남아 있다. `AUTOPOST-M2-JOBS-001`로 작업/시도/이벤트/증거/대사 저장 기반을 후속 작성한다.
- Threads 장기 토큰 갱신과 별개로 공개/비공개 운영 프로필에 따른 권한 부여 갱신을 추적한다. 비공개 프로필은 권한 갱신 제약이 보고되어 운영 계정 상태를 게이트로 확인한다. 컨테이너 재게시 동작과 PUBLISHED 컨테이너의 media ID 관계는 테스터 검증 전 자동 재시도 불가.
- Instagram 단일 이미지 MVP는 JPEG만 허용하거나 서버에서 검증된 변환을 제공해야 한다. 게시 문서는 미디어를 게시 시점에 공개 서버에서 내려받는다고 명시하므로 미디어 URL 수명은 컨테이너 처리 완료를 고려한다. 문서 간 게시 한도(50/100), permission 표기(`...publish`/`...publishing`) 불일치는 출시 게이트로 유지하고 런타임 한도 API 및 실제 앱 권한을 기준으로 한다. 게시 성공과 구성 경고는 `published_with_issues` 형태로 증거와 경고를 함께 남긴다. [Meta Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- 문서 기반 capability는 `supported`로 올리지 않는다. 테스터 환경에서 확인되기 전 실제 게시·예약을 `unverified`로 막는다. 플랫폼 예약 기능은 확인되지 않았으므로 예약은 사이트 dispatch만 담당한다.

### 2.2 데이터 계약 결과 및 Master 결정

`AUTOPOST-DATA-001` 결과를 검토했고, 기존 코드 근거도 대조했다. 상세 엔티티·전이·migration 초안은 `.ai/results/AUTOPOST-DATA-001-CC-ENG.md`를 참고한다.

- **D1 결정:** 배포 기능만 승인된 admin(`role=admin AND approval_status=approved`)으로 제한한다. 기존 전역 admin 판정은 수정하지 않고 전용 권한 판정을 추가한다. 근거상 현재 `decideAccess(..., "admin")`는 admin 역할만 확인하며 승인 상태는 확인하지 않는다.
- **D2 결정:** `unknown`의 `confirmed_absent`만으로는 재게시하지 않는다. 운영자가 명시적으로 재실행을 승인하고 모든 조건을 재검사해야 한다. 현재 `reconcileUnknown(confirmed_absent)`가 `retryable: true`를 반환하며 `retryFailed()`가 이를 `scheduled`로 바꿀 수 있어 live dispatch 구현 전에 자동/운영자 재시도 경계를 코드 계약에 명시해야 한다.
- 채택 원칙: 별도 `distribution_*` 데이터 도메인, 승인 해시 고정, 불변 실행/증거 이력, 원격 컨테이너 ID를 게시 요청 전에 영속화, UI와 DB 양쪽에서 client write 금지. 기존 공용 테이블·함수·체크 제약은 수정하지 않는다.
- 첫 migration `AUTOPOST-M1-CONTENT-001`은 정적 검토를 마쳤다. 범위는 배포 콘텐츠 버전·채널 초안/리비전·승인·전용 admin RLS/grants다. DB 적용 검증은 미완료이며 외부 실행은 포함하지 않는다. 다음 `AUTOPOST-M2-JOBS-001`은 작업/시도/증거/대사 저장에 한정한다.
- 비밀 저장 기술, 스케줄러(Vercel Pro Cron vs Supabase pg_cron), 보존/삭제 정책, 공급자 테스터 실측은 미결정으로 남긴다. 이를 첫 콘텐츠/승인 migration 범위에 억지로 넣지 않는다.

## 3. 목표 제품 흐름

한 콘텐츠 버전을 한 번 검토하고 채널별 초안을 만든 뒤, 승인된 채널만 개별 예약·실행한다. 채널별 결과는 독립적으로 기록해 일부 성공을 전체 실패로 덮지 않는다.

`수집/작성 → 편집 → 채널 초안 생성 → 권리·사실·링크 검토 → 승인 → 예약 또는 수동 내보내기 → 실행/확인 → 증거 등록 → 성과 기록`

- 공통 원본: 본문, 제목, 출처, 작성자, 콘텐츠 버전, 사용 미디어 및 권리 근거.
- 채널 초안: 채널별 문안·미디어·링크·길이/규격 검증·승인자·승인 시각.
- API 게시: `scheduled → dispatching → published | failed | unknown`; 외부 식별자 또는 게시 URL 증거를 기록한다.
- 수동 게시: `approved → manual_ready → awaiting_evidence → published | abandoned`; 사람이 게시 URL 또는 외부 식별자를 입력해야 완료 처리한다.
- `unknown`은 재시도 버튼을 제공하지 않고 먼저 외부 채널 대사 또는 운영자 증거 검토를 요구한다.
- 콘텐츠가 승인 후 수정되면 새 버전을 만든다. 이전 버전에 연결된 채널 초안과 예약 작업은 stale 상태로 표시한다.

## 4. 목표 구조

### 4.1 사이트와 서버 경계

- 기존 `web/`을 단일 UI·인증·권한 진입점으로 유지한다.
- 기존 `src/lib/distribution` 타입과 순수 함수 계약을 재사용·확장하고, 플랫폼 SDK와 토큰은 서버 전용 모듈에 격리한다.
- 모든 게시 요청은 서버에서 사용자 권한, 콘텐츠 버전, 채널 초안 승인, 미디어 권리, 연결 상태를 다시 검사한다.
- 브라우저에는 공급자 토큰, 앱 시크릿, cron secret, service/secret key를 보내지 않는다.
- 연결 수명주기(연결·갱신·만료·해제·삭제요청)와 게시 작업 수명주기를 분리한다.

### 4.2 신규 도메인 테이블 후보

이름은 제안이며 기존 Supabase migration 및 열 권한 계약과 대조 후 확정한다. 기존 테이블을 덮어쓰거나 키트 SQL을 실행하지 않는다.

| 테이블 후보 | 핵심 데이터 | 권한 원칙 |
|---|---|---|
| `distribution_channel_connections` | 사용자/워크스페이스, 채널, 외부 계정 ID, 연결 상태, 만료시각, 암호화된 자격증명 참조 | 클라이언트에는 연결 상태/표시명만 노출. 비밀은 서버 전용 저장소 또는 별도 비공개 스키마. |
| `distribution_channel_drafts` | 콘텐츠 ID·버전, 채널, 본문, 미디어 참조, 링크, 검증 결과, 승인 메타데이터 | 소유자/승인 역할만 최소 권한. 승인 전 편집 가능, 승인 후 변경은 재승인. |
| `distribution_jobs` | idempotency key, 콘텐츠 버전, 채널, 모드, 예약시각, 상태, 시도/lease, 외부 ID/URL, 오류 분류 | 서버 워커가 상태 전이. 사용자는 허용된 취소·조회만. unique idempotency 제약 및 원자적 claim. |
| `distribution_job_events` | 상태 전이, actor, attempt, 시간, 결과 요약, 대사 근거 | append-only, 비밀·본문 전체를 로그에 복제하지 않음. |
| `distribution_media_assets` | 저장 경로, MIME/크기/해시, 출처, 라이선스/동의, 공개 범위, 보존 정책 | 업로더/운영자 권한, 공개 URL은 필요한 게시 단계에만 발급. 고아 정리 작업은 보존 확인 후 수행. |

Supabase RLS뿐 아니라 table grants/column grants, 서버 권한 검사, storage policy를 함께 설계한다. Supabase 문서도 노출 스키마의 RLS 활성화만으로 충분하지 않고 grants를 최소화하며 secret/service role 키는 서버 밖으로 보내지 말라고 권고한다.

### 4.3 작업 실행과 실패 복구

1. 예약 worker는 DB transaction/RPC에서 due job을 조건부로 선점하고 lease/attempt를 증가시킨다.
2. 동일 idempotency key의 중복 작업은 DB unique 제약으로 거부한다. 한 콘텐츠·버전·채널·실행 모드가 기본 dedupe 범위다.
3. 원격 호출 후 응답이 불확실하면 `unknown`으로 저장하고 재호출하지 않는다.
4. API가 공식적으로 제공하는 외부 조회가 있으면 게시물 식별자로 대사한다. 없으면 운영자 확인과 URL/ID 입력으로 대사한다.
5. 만료·철회 토큰은 연결 상태를 `reauth_required`로 만들고, 재인증 전 예약 실행을 보류한다.
6. 정체된 `dispatching`은 즉시 실패/재시도하지 않는다. lease 만료 후 원격 성공 여부를 먼저 확인하고 `unknown` 또는 복구 가능한 실패로 분류한다.
7. 실행 이벤트는 추적 가능한 최소 정보를 남긴다. 토큰, 전체 OAuth 응답, 사용자 비밀, 전체 생성 프롬프트는 로그에 기록하지 않는다.

## 5. 단계별 로드맵과 작업 지시

| 순서 / 작업 ID | 담당 제안 | 범위와 완료 조건 | 선행/차단 조건 |
|---|---|---|---|
| P0 `DEC-AUTOPOST-LICENSE-001` | 사용자 결정, Master 기록 | 서면 허용 범위 확인: (a) 코드/스키마/프롬프트 분석, (b) 1개 사이트 복제·수정·배포, (c) AI 작업 허용. 확인 문서/허용 범위를 결정 기록으로 남긴다. | 결정 전 키트 코드·프롬프트 추가 조사/복사/실행 금지. clean-room 플랜은 진행 가능. |
| P0 `AUTOPOST-UX-001` | CX-DESIGN 후속 배정 | 통합 게시 콘솔의 목록, 편집/승인, 채널별 예약, 수동 게시, unknown 대사, 연결 상태, 모바일 화면 흐름과 접근성/빈 상태 명세. 키트 화면 복제 없이 기존 사이트 스타일 사용. | 본 통합 플랜. 코드 구현 아님. |
| P0 `AUTOPOST-API-READINESS-001` | CC-ENG-05 / Claude | **검토 완료.** 공식 자료 readiness 표 제출. 결과와 남은 불일치는 본 플랜 §2.1 및 `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md` 참조. | 구현 전 테스터 검증 및 Meta 운영 결정 필요. |
| P0 `AUTOPOST-UX-001` | CX-DESIGN-03 / Codex Design | **검토 완료.** 관리자 콘솔, 승인/버전, 수동 게시 증거, 대사, 상태·모바일·접근성 명세. `.ai/results/AUTOPOST-UX-001-CX-DESIGN.md` 참조. | 작성자/승인자 권한 분리는 사용자/데이터 계약 결정. |
| P1 `AUTOPOST-DATA-001` | CC-ENG-06 / Claude | **검토 완료.** 별도 데이터/상태 계약, role·RLS/grants 및 M1~M5 제안 제출. `.ai/results/AUTOPOST-DATA-001-CC-ENG.md` 참조. |
| P1 `AUTOPOST-M1-CONTENT-001` | CC-ENG-07 / Claude | **Master 정적 검토 완료.** 콘텐츠 버전/초안/승인 migration 추가. DB 적용 검증은 미완료. `.ai/results/AUTOPOST-DATA-001-CC-ENG.md`, `web/supabase/migrations/20261116030000_distribution_content.sql` 참조. |
| P1 `AUTOPOST-M2-JOBS-001` | Claude 엔지니어 후속 배정 | 작업·시도·이벤트·증거·대사 저장 기반을 추가한다. SQL 실행·DB 적용은 포함하지 않는다. | D2 운영자 재실행 승인, unknown 자동 재시도 금지, 원격 컨테이너 ID 선커밋을 반영한다. |
| P1 `AUTOPOST-MANUAL-BLOG-001` | 엔지니어 | 승인 콘텐츠를 안전하게 복사/다운로드하고 대상 사이트 체크리스트를 제공. 운영자가 게시 URL/ID를 기록해 evidence로 완료. 네이버 로그인/CDP 자동화 없음. | 콘텐츠 승인 계약 및 미디어 권리 기준 확정. |
| P2 `AUTOPOST-THREADS-001` | 엔지니어 | 별도 서버 전용 Threads adapter, OAuth state nonce, 토큰 수명주기, 원자적 작업 claim, unknown 대사/운영 수동대사, audit events. 앱 승인 전 dry-run만. | API readiness 통과, 데이터/보안 설계 승인, 서면 권리 결정 또는 clean-room 담당 분리. |
| P3 `AUTOPOST-INSTAGRAM-001` | 엔지니어 | 이미지 단일 게시부터 시작. MIME/용량/비율/권리 검사, 공개 접근 가능한 일시 미디어 URL, 처리 polling, 게시 증거 및 timeout 대사를 구현. 캐러셀/비디오는 별도 단계. | Meta 권한·미디어 정책 확인, Threads 작업 패턴 안정화, 미디어 보존 정책. |
| P4 `AUTOPOST-OPERATIONS-001` | Master + 운영 | 예약 지연/실패/unknown/재인증 대시보드, 운영 알림, 수동 대사, 감사 내역, 중지 스위치, 데이터 삭제 처리. 배포/실계정 검증은 별도 사용자 승인 후. | 각 채널 acceptance 충족. |

### 권장 출시 순서

1. **수동 블로그 배포**로 승인·채널 문안·UTM·게시 증거 흐름을 검증한다.
2. **Threads 텍스트 게시**를 단일 운영자 + 등록된 Tester 계정으로 제한해 API 플로우를 검증한다. 앱 검수는 다계정/외부 사용자 지원 게이트로 분리한다.
3. **Instagram 단일 이미지 게시**를 추가한다. 캐러셀·동영상·다중 계정은 안정화 후.
4. Naver 브라우저 자동 입력과 CDP는 공식 정책 및 라이선스·운영 위험을 별도 검토하기 전까지 범위 밖이다.

## 6. 보안·정책·콘텐츠 운영 기준

- 연결용 OAuth state는 일회용 난수이며 서버 세션/사용자/만료에 바인딩한다. 콜백에서 재사용·교차계정 연결을 거부한다.
- 자격증명은 암호화 at-rest 또는 별도 secret store에 저장하고 브라우저 API에서 읽기/쓰기 권한을 제공하지 않는다. 토큰 교환/갱신 로그는 마스킹한다.
- HTML을 렌더링할 경우 허용 태그/속성 기반 sanitization을 하고 외부 URL 수집은 SSRF 방어(공인 IP, redirect 재검사, 크기·시간 제한)를 적용한다.
- 게시 미디어는 출처·저작권·초상권·동의와 플랫폼 허용 여부를 기록한다. 승인되지 않은 자산은 live job을 생성하지 못한다.
- 예약 시간은 UTC로 저장하고 사용자 시간대로 보여 준다. 플랫폼별 실행 제한·중복 방지 및 지연 알림을 명시한다.
- 모든 채널은 개별 승인과 개별 결과를 갖는다. 부분 성공을 숨기지 않고, 자동 게시가 완료된 것으로 오인하게 만드는 UI를 금지한다.
- 운영자가 즉시 전체 live dispatch를 멈출 수 있는 feature flag/kill switch와 재개 승인 로그를 둔다.

## 7. MVP 완료 기준

- 승인 없는 콘텐츠, stale 버전, 권리 없는 미디어, 잘못된 URL은 live job으로 전환되지 않는다.
- 동시 worker가 같은 작업을 중복 선점하지 않으며 같은 idempotency key는 한 번만 저장된다.
- API timeout/프로세스 종료로 결과가 불명확하면 `unknown`으로 남고 자동 재시도되지 않는다.
- `published`는 외부 ID 또는 검토된 HTTPS 게시 URL 증거가 있을 때만 기록된다. 수동 채널은 운영자 증거 등록이 필수다.
- 브라우저에서 토큰/secret을 조회할 수 없고, unauthenticated/비소유 계정은 초안·작업·미디어를 열 수 없다.
- 재인증, 철회, 예약 취소, 실패 및 부분 성공 흐름을 UI에서 운영자가 판별할 수 있다.
- 미디어 삭제는 게시/보존 정책을 확인하고 수행하며, 30일 일괄 삭제 같은 기본 파기는 금지한다.
- 현재 사이트의 기존 콘텐츠/인증/권한/migration 계약을 깨뜨리지 않는 별도 migration 경계를 갖는다.

시험과 계정 실게시 검증은 각 구현 작업의 명시적 착수·검증 요청 이후 수행한다. 본 문서 작성 과정에서는 테스트나 코드를 실행하지 않았다.

## 8. 결정 필요 항목

1. BUYLIFE의 서면 허가 범위가 있는가? 코드 이식이 불가하면 clean-room 독립 구현으로 진행할지.
2. 첫 API 채널을 Threads로 승인할지, 수동 블로그 절차를 먼저 운영할지. 본 계획은 수동 블로그 → Threads → Instagram을 권고한다.
3. 단일 운영자 계정만 지원할지, 여러 작성자/승인자 계정을 지원할지.
4. Meta 앱 소유 주체와 검수/권한 신청 책임자, 실제 테스트 계정은 누구인지.
5. AI 생성 콘텐츠 사용 여부와 편집자 승인·출처 표시·광고/협찬 표기 정책.
6. 이미지 권리 증명과 삭제/보존 기간, 수동 게시 URL의 필수 여부.
7. KPI: UTM 규칙, 클릭/유입 지표, 채널별 게시 성공률과 운영 확인 SLA.
8. 예약 실행 기반을 선택한다: Vercel Pro Cron(분 단위, 유료/제품 이전 경로 고려) 또는 Supabase pg_cron(해당 프로젝트 플랜의 이용 가능 여부 확인 후).
9. Threads 운영 계정은 공개 프로필 여부와 90일 권한 갱신 운영을 확인한다. Instagram 로그인은 우선 Instagram Login + Standard Access 검토안으로 두되 실제 앱 권한 문자열을 확인한다.

## 9. 운영 리스크와 롤백

| 위험 | 완화 | 롤백/대응 |
|---|---|---|
| 라이선스 범위 불명 | 복제·수정을 멈추고 결정 기록, clean-room으로 분리 | 키트 참조 개발을 중단하고 이미 작성한 보고서는 접근 제한/보존 방침 검토 |
| Meta 권한·정책 변경 | 출시 직전 공식 문서 재확인, 기능 capability를 `unverified`로 표시 | 채널 연결/예약 생성 feature flag off, 수동 배포 유지 |
| 중복 게시 | 단일 claim, idempotency, timeout은 unknown, 자동 재시도 금지 | 채널 dispatcher 중지, 외부 계정에서 대사 후 운영자 승인 재개 |
| 토큰 노출/계정 오연결 | 서버 전용 암호화 secret, nonce state, RLS/grant 검토 | 자격증명 폐기·재연결, 해당 채널 중지, 감사 검토 |
| 미디어 노출/고아 파일 | 비공개 기본, 게시 직전 서명 URL/보존 정책, 삭제 대사 | 업로드·게시 중지, 접근 차단, 보존 확인 뒤 정리 |
| 예약 누락/지연 | lease/heartbeat/지연 감시, dead letter/운영 화면 | 예약 신규 생성 중단, 기존 작업 수동 대사 및 재조정 |

DB 변경 전 migration 백업/롤백 절차, 채널별 kill switch, 예약 job 일시정지, 토큰 회수 연락 절차를 준비한다. 게시물은 플랫폼 외부에 남을 수 있으므로 코드 롤백만으로 이미 게시된 콘텐츠가 취소된다고 가정하지 않는다.

## 10. 공식 자료 (2026-11-16 확인)

- NAVER Developers, [블로그 오픈 API 종료 안내](https://developers.naver.com/notice/article/7527): 외부 블로그 글쓰기 API 종료 시점 2020-05-06 및 반복·기계적 유사 글 대량 발행 문제를 명시.
- Meta for Developers, [Instagram API Changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/): Instagram Login API, Facebook Page 요구 제거 및 `instagram_business_content_publishing` 등 공식 권한 변경 이력.
- Meta for Developers, [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing): 공개 미디어 URL, 게시 endpoint, 현재 문서의 100개/24시간 한도. 별도 limit API와 실제 앱 상태는 출시 때 확인한다.
- Supabase Docs, [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): 노출 테이블의 RLS와 grants를 함께 설정하고 least privilege로 운영.
- Supabase Docs, [Securing your data](https://supabase.com/docs/guides/database/secure-data): secret/service role 키를 브라우저에 노출하지 않고 서버에서만 사용.
- Vercel Docs, [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs): 플랜별 실행 간격·정확도, 중복 호출·실패 처리 설계.
- PostgreSQL Docs 17, [Transaction ID and snapshot information functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-TXID-SNAPSHOT): `pg_current_xact_id()`는 `xid8`을 반환하며 subtransaction 내에서도 최상위 transaction ID를 반환한다.
- Threads 및 Instagram의 공식 출처 전체 목록은 `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md`에 있다. 권한·앱 검수·미디어 제약은 구현 착수와 실계정 검증 직전 재확인한다.

## 부록 A. 분석 산출물

- `.ai/results/AUTOPOST-BLOG-ANALYSIS-CC-ENG-02.md`
- `.ai/results/AUTOPOST-BLOG-ANALYSIS-HOLD-CC-ENG-02.md`
- `.ai/results/AUTOPOST-INSTA-ANALYSIS-CC-ENG-03.md`
- `.ai/results/AUTOPOST-THREADS-ANALYSIS-CC-ENG-04.md`

