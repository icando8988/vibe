# DEV-003 격리 DB 실행 검증 및 권한 보강

P1 / 책임 CC-ENG-01 / 상위 DEVELOPMENT-001 / 상태 prepared.
DEV-001 반환을 검토했다. build/typecheck/50tests 성공 증거는 수용하되 lint는 Design 후속 DEV-002B로 배정한다. 귀하는 DB/도메인에 집중하며 UI 작업을 기다리지 않는다.
입력: 공통 규칙/역할/계획/DEVELOPMENT_CONTRACT, DEV-001 migration 및 보고서.
허용 수정: web/supabase/**, web/tests/db/**, web/tests/domain/**, web/src/lib/domain/**, docs/DB_VERIFICATION.md, 본인 .ai/results/DEV-003-CC-ENG-01.md. app/components/styles/package/lockfile/공용 .ai 변경 금지. 새 패키지 필요시 ask로 Master에게 근거 전달하고 독립 SQL·시험 명세는 진행.

1. Docker/Postgres/Supabase CLI 존재와 실행 가능성을 읽기 전용 확인. 이미 사용 가능한 로컬 격리 DB만 사용. 원격 DB/계정/루트 비밀번호/KEY 파일 접근·유료 서비스·전역 설치·Docker 시스템 설정 변경 금지. 적합한 실행기가 없으면 차단을 즉시 보고하되 실제 실행용 테스트 스크립트와 SQL 정적 보강을 완료하고 실행 검증을 통과했다고 하지 않는다.
2. 초기 migration을 격리 DB에 적용하고 anon/memberA/memberB/pending/admin 실제 쿼리 매트릭스 작성·실행. 테스트 auth.users/auth.uid/role 부트스트랩이 Supabase 대체 스텁이면 실제 Supabase 통합과 구분. 실패 권한/문법은 수정하고 새 DB 재적용 검증.
3. 권한 핵심: 공개 승인 콘텐츠와 상위 비공개 전파, 자기 승인·역할 승격 불가, display_name만 본인 수정, 타인 주문/입금/환불 거절, 클라이언트 거래 쓰기 거절. GRANT/REVOKE는 실제 기본 권한 차이까지 검증. 행 단위 RLS가 내부 열을 보호하지 않음을 검토: 공개 campaigns의 owner_id/내부 정책 필드, 본인 payment/refund의 reconciliation_ref/verified_by/payout_ref/내부 사유 등을 최소 공개 projection 또는 열 권한/별도 테이블로 분리하는 설계를 구현하되 기존 계획과 충돌하면 이유를 보고.
4. 종료 주문/늦은 입금/환불·이행 교차 불변식과 DB CHECK가 TS와 일치하는지 경계 케이스 검증. 역할 함수 security definer 고정 search_path와 실행권한 확인. 개인정보/증빙 원문을 시험 로그에 노출하지 않는다.
5. 확장 테이블을 무작정 모두 만들지 말고 이번 단계는 기존 스키마 실제 검증과 보안 공백 해소에 우선 집중. 남은 inventory/알림/배송/동의 테이블은 의존성과 승인 필요 항목을 구분해 후속 명세.
완료: 실행 결과·사용한 로컬 환경·미실행 범위·변경·결함·재현 가능한 테스트·남은 결정·DEV-004 준비 조건을 보고하고 worker_done. 비제로 핵심 검증은 미완료 표시, 테스트/권한 비활성화 금지. 추가 위임 금지.
