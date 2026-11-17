# DEC-AUTOPOST-DATA-001 — 배포 도메인 권한과 미확실 결과 재실행

- 결정 ID: DEC-AUTOPOST-DATA-001
- 결정자: CX-MASTER-01
- 날짜: 2026-11-16 (Asia/Seoul)
- 근거: AUTOPOST-DATA-001 결과와 현재 `web` 권한/배포 코드 확인
- 범위: 통합 콘텐츠 배포 기능 및 후속 데이터/작업 상태 계약

## 결정

### D1 — 배포 전용 관리자 권한

통합 게시 콘솔과 배포 변경은 `role_assignments.role='admin'`이면서 `profiles.approval_status='approved'`인 사용자만 허용한다. 전역 `private.is_admin()`과 `decideAccess(..., 'admin')`의 기존 의미는 이 작업에서 바꾸지 않는다. 통합 배포 전용 판정(예: `distribution_admin`)을 추가해 현재 상태를 서버에서 재확인하고 DB RLS/write 함수를 같은 조건으로 보호한다.

이 결정은 기존 admin 기능 전체에 대한 권한 변경을 하지 않는다. suspended/rejected 관리자 차단을 전역으로 확장하려면 별도 공통 권한 변경 검토가 필요하다.

### D2 — confirmed_absent 이후에도 운영자 확인 필요

`unknown`은 게시 여부를 대사하기 전 재전송할 수 없다. `confirmed_absent`가 기록돼도 이는 외부 게시가 없었다는 판단 근거이지, 자동 실행 허가는 아니다. 재실행은 승인·권리·연결·중지 상태를 다시 확인하고 운영자가 명시적으로 승인해야 한다. 워커의 자동 재시도 정책과 운영자 재실행 허가를 별도 필드/전이로 구분한다.

현재 순수 함수 `retryFailed()`가 `retryable`만으로 자동/수동 경계를 표현하지 못하므로, 실제 live dispatch 구현 전 별도 작업에서 `autoRetry` 또는 동등한 안전한 retry policy를 도입한다. 변경은 테스트 없이 코드상 전이/호출부 검토만 먼저 한다. 기존 테스트는 해당 계약 개정 작업에서 실행하지 않는다(검증은 별도 승인 시 수행).

### 채택된 데이터 원칙

- 기존 테이블·권한 함수·check 제약은 수정하지 않고 신규 `distribution_*` 도메인으로 추가한다.
- 원문/초안 버전과 승인은 해시에 고정한 append-only 근거를 둔다.
- 토큰·OAuth state는 노출된 `private` 스키마가 아닌 별도 비노출 스키마 경계에 둔다. secret 저장 기술(AES envelope/Vault/외부)은 별도 결정 전까지 보류한다.
- 공급자 API 응답이 불확실한 경우 자동 재호출하지 않는다. 외부 컨테이너 ID와 원격 상태 대사 근거를 보존한다.

## 미결정 항목

- Vercel Pro Cron과 Supabase pg_cron 중 MVP 스케줄러 선택
- 서비스 쓰기 함수 노출 위치와 service-role 저장 기술
- 데이터/미디어/권리 증빙 보존 및 사용자 삭제 요청 방식
- Threads/Instagram 공식 문서와 테스터 검증이 필요한 항목

미결정 항목은 첫 콘텐츠/승인 migration을 막지 않는다. DB 실행, 원격 Supabase 적용, live posting, 외부 플랫폼 연결은 별도 지시/게이트다.
