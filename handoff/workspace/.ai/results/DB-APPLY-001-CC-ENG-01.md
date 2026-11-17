# DB-APPLY-001 — 서울 Supabase에 초기 migration 적용·검증

- 책임 CC-ENG-01 / **사용자 직접 지시**(Master 배정 아님) / 2026-11-16
- 상태: **done — 적용 성공, 구조·역할 점검 통과, 행 단위 매트릭스는 미실행**

## 수행
1. 기존 싱가포르 빈 프로젝트 삭제, 서울 `vibe`(`pudkzpmvafkapammevbz`) 생성(사용자 지시·사용자가 비밀번호 설정).
2. SQL Editor로 `20261116000000_initial_foundation.sql` 트랜잭션 적용 → Success.
3. 카탈로그 점검, 역할 전환 18항목(rollback), Security Advisor 확인. 상세: `docs/DB_VERIFICATION.md` 마지막 절.

## 결과
- 기본 권한 회수·열 권한·RLS·함수 보안 속성이 설계와 일치. 결함 없음.
- Advisor 경고 2(security definer 함수 RPC 노출) → 비노출 스키마 이동 후속 권장.
- migration 이력 미기록(SQL Editor 적용) → CLI 도입 시 repair 필요.

## 남은 일 / 결정
1. 행 단위 RLS 매트릭스(JWT·시드 데이터) 실행 방법: 실제 프로젝트에서 테스트 사용자로 할지, PGlite/로컬로 할지.
2. `is_admin`·`is_approved_member`를 `private` 스키마로 옮기는 migration 여부.
3. DEV-004(SDK·Vercel 환경변수·인증) 착수 지시.
