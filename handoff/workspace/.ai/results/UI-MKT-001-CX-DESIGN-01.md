# UI-MKT-001 모의 배포 상태·오류 안내

Codex design / CX-DESIGN-01 · P2 · 상태 ready_review · 2026-11-16.
입력: 배정, MARKETING_INTEGRATION_REVIEW U01~03, DEC-DISTRIBUTION-002, 현재 Result/jobs 타입 읽기전용.
범위: content-distribution-preview.tsx, 필요시 design.css, DESIGN_SYSTEM, docs/qa/UI-MKT-001, 이 결과. lib/app/tests/package/콘텐츠v2/공용.ai 수정 없음.
완료 조건: 한글 결과·오류/다음행동, attempt 전달, 실제브라우저 공백/미검토/중복/편집무효/완료/예시분리 및3폭·키보드, lint/typecheck.

## 변경과 결함 처리

| 항목 | 재현·영향 | 수정 |
|---|---|---|
| U01 | 검토→모의 실행 뒤 내부 상태 dry_run_succeeded가 결과 본문에 표시됨 | 한글 완료 제목, 원문 버전/채널, 미리보기·입력 확인 및 재실행 불필요 안내. 실패 결과도 한글 안내로 표시 |
| U02 | 같은 버전·채널을 재실행하면 CODE:원문 오류가 노출됨 | 공통 DistributionErrorCode에 대응하는 UI 안내 13개와 다음 행동. 중복은 기존 요청/표시 결과 확인, 변경한 경우 재검토. 모르는 코드·예외는 일반 안내만. error.message/원문 payload는 렌더하지 않음 |
| U03 | applyResult에 시도 번호 미전달 | {attempt: started.value.attempts} 전달. 공통 API 충돌 없음 |

제품 변경은 content-distribution-preview.tsx와 DESIGN_SYSTEM 설명뿐이다. CSS는 기존 규칙으로 충분해 수정하지 않았다. docs/qa/UI-MKT-001에 harness/검증/캡처를 추가했다. lib/app/tests/package/원고/공용.ai 수정 없음. 새 의존성·실계정·실예약·저장·게시·인증 우회 없음.

Master msg_c48986bbf5f0의 QA-MKT002 안정 스냅샷 안내를 반영했다. preserveLateEvidence/explicit scope summary를 UI 운영 기능으로 추가하지 않고 dry_run 흐름만 유지했다.

## 실행 검증

- D:/Vibe/web npm.cmd run lint: exit0, npm.cmd run typecheck: exit0.
- 실제 Chromium 로컬 harness에서 일반 흐름8건 및 오류 안내 fixture14건 통과. 전 상태에서 원시 상태/코드/원문 표식이 일반 화면에 없음. 자연 발생 중복도 한글 안내와 가능한 다음 행동으로 표시됨.
- 공백/미검토 차단, 편집 후 검토 무효, 재확인 후 모의 완료, 초기화 후 재검토를 실제 fill/click으로 검증. 오류 fixture는 정상 흐름과 구분해 저장했으며 실제 공급자 실패라고 주장하지 않음.
- harness 계측으로 완료마다 options.attempt=1 전달 확인. 일반 모의 처리 후 [1,1], 키보드 Threads 완료까지 [1,1,1]. 실제 재시도/외부 결과 대사 시험은 아님.
- 320/390 mobile·1440 desktop에 가로 넘침 없음. 실제 ArrowRight/Tab/Enter로 채널 선택→샘플 검토→모의 완료 성공. 설명 details도 Enter로 열고 unknown/partial 선택 시 실제 완료 결과 유지 확인.
- 대표 스크린샷 저장·직접 확인. console 오류 없음, network는 로컬 문서/JS만. 원고 v2 JSON/MD/HTML/renderer SHA-256 보존, 승인·보류 상태 변경 없음.
- React 검토: 고정 UI 매핑만 추가, 상태 전이는 공통 함수 유지. 미지원 복구·실게시 성공을 약속하지 않음. 개인정보·비밀 입력 금지 안내 유지.

## 제한과 후속

Next 보호 관리자 라우트/서버 저장·승인·실제 공급자 오류/게시/예약은 여전히 미연결이다. 실기기·화면낭독기·실제200%확대 미검증. 공통 로직 단위시험을 복제하거나 새 패키지를 추가하지 않았다. build는 이번 UI 문구 변경에 별도 실행하지 않았다.

이번 범위의 U01~03은 수정·검증 완료로 ready_review 반환한다. 실제 공급자·관리자 통합은 별도 후속이며 Master가 최종 통합/done을 판단한다. 직접 시작한3317 harness는 종료 후 반환한다.
