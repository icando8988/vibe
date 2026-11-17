# AUTOPOST-DATA-001 — 통합 배포 데이터·상태 계약 제안

- 작업 ID: AUTOPOST-DATA-001
- 담당: Claude Code 엔지니어 (CC-ENG-06)
- Master: CX-MASTER-01
- 입력: `docs/AUTOPOST_INTEGRATION_PLAN.md`, `.ai/results/AUTOPOST-UX-001-CX-DESIGN.md`, `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md`, 기존 `web/` migration/auth/distribution 코드
- 출력: `.ai/results/AUTOPOST-DATA-001-CC-ENG.md`

## 목표

현재 사이트만 기준으로 blog manual, Threads, Instagram을 위한 통합 영속성·상태 계약을 설계한다. 구현/SQL이 아니라 검토 가능한 데이터 설계안을 제출한다. 어떤 키트 코드·schema·분석 보고서도 열지 않는다. 기존 두 결과 보고서는 제품 요구사항으로만 사용한다.

## 조사 범위

- 기존 `web/supabase/migrations/**`, `web/src/lib/distribution/**`, `web/src/lib/auth/**`, 실제 admin role/권한 진입 구현을 읽어 현재 계약과 충돌을 확인한다.
- 사이트 공용 스키마와 충돌하지 않는 별도 도메인 설계를 제안: connections, channel drafts, jobs, immutable events, media rights/evidence.
- UX 결과에서 요구한 독립 상태축(콘텐츠 승인/stale, 연결/readiness, job outcome)과 화면 액션을 데이터 제약·전이와 연결한다.
- API readiness 결과를 반영: 원격 idempotency 없음, provider container ID 선저장, Threads/Instagram 단계 상태, Instagram `published_with_issues`, reauth/권한 갱신, 수동 게시 증거, unknown/manual reconciliation.
- 제안 표에는 각 테이블/엔티티의 목적, 필드, 불변조건, 인덱스/unique key, 관계, retention, 조회/변경 actor를 기록한다.
- 상태 전이표는 누가 어떤 근거로 바꿀 수 있는지, 자동 재시도 가능한지 명시한다. unknown은 `confirmed_absent` 전에 재전송 금지.
- RLS와 SQL grants/column-level exposure를 역할별로 표로 제안한다. service/secret key는 서버 전용. 토큰/secret 저장 후보와 키 회전·폐기 전략을 분석하되 실제 비밀은 조사하지 않는다.
- Scheduling 선택지(Vercel Pro Cron, Supabase pg_cron)는 스케줄러와 작업 테이블을 느슨하게 결합하는 운영 인터페이스로 제안한다. 계정 플랜/API 제공 여부를 추정하지 말고 unresolved decision으로 표시한다.
- 기존 앱에 필요한 타입/함수 계약의 변경점과 단계별 migration rollout/rollback을 문서로 제시한다. 코드는 작성하지 않는다.

## 제약

- `Blog_Posting_Kit*`, `Insta_Auto_Posting_Kit*`, `Threads_Auto_Posting_Kit*` 파일은 열지 않는다. 기존 kit 분석 결과 문서를 열지 않는다.
- migration SQL, app 코드, 테스트, seed, secret, 외부 계정/API, 데이터베이스에 손대지 않는다.
- 코드나 테스트는 실행하지 않는다.
- 작업 범위는 보고서 한 파일. 실제 구현/SQL은 Master 별도 지시가 있어야 한다.

## 완료 조건

- 현재 웹앱의 실제 migration/auth/distribution 경로를 근거로 기술한다.
- 권한 모델은 우선 기존 admin-only MVP로 구체화하고, 다중 작성자/승인자 지원은 별도 확장안으로 분리한다.
- 제안 전체에서 unknown 중복 방지, 외부 증거, 감사 이력, 권리·미디어 보존 조건이 일관된다.
- 미확인 공급자 동작은 gated decision으로 명시한다. 작업 종료 시 worker_done으로 보고한다.
