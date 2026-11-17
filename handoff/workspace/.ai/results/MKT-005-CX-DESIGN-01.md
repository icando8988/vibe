# MKT-005 배포 공통 로직과 UI 연결

책임 Codex design / CX-DESIGN-01 · P1 · 상태 ready_review · 2026-11-16.
입력: MKT-005 배정, MKT-003 결과와 distribution types/jobs/adapters/result/idempotency, 기존 디자인 계약.
수정 범위: components/styles, DESIGN_SYSTEM, docs/qa/MKT-005, 이 결과. app/lib/tests/package/DB/공용 .ai 수정 금지.
완료 조건: 공통 함수 모의 실행 연결, 검토 무효·빈 입력·중복·완료 브라우저 검증, 4폭 점검, 한계/연동 보고.

## 구현

- content-distribution-preview.tsx: ContentItem/ChannelDraft/PublishJob 타입, createJob→startDispatch→DryRunAdapter.publish→applyResult 연결. 별도 배포 상태 기계를 만들지 않았다. live/getAdapter 호출 없음. 직접 import의 전이 의존성은 순수 TS이고 서버 API·환경·Node 접근 없음.
- 원문 버전과 채널을 검토 snapshot에 묶고 제목/본문 변경·원문 복원·채널 변경 시 검토를 무효화한다. 제목/본문이 공백이면 확인 불가. 미검토 실행은 오류로 안내한다. 오류는 label/aria-describedby/aria-invalid 및 role=alert로 연결한다.
- mode=dry_run·scheduledAt=null 고정. dry_run_succeeded는 ‘모의 실행 완료 · 외부 게시 없음’ 표시. 실제 외부 식별자/예약/저장 없음. 메모리 이력으로 공통 중복 거절을 적용하고 ref 잠금으로 재진입 억제, 편집 generation이 바뀐 뒤 예전 결과를 현재 결과로 표시하지 않는다.
- 실제 결과와 상태 설명 예시(details)를 분리. unknown·partial은 설명 예시로만 존재하며 실제 job을 바꾸지 않는다. capability 표는 공통 unverifiedCapabilities 값으로 전부 미확인, connected=false, 글자/미디어 제한 미확인.
- styles에 검토/오류/결과/설명/capability 레이아웃 추가. 기존 18px·포커스·반응형 유지.
- Master msg_f5905e0ae497 후 MKT-004 구현/반환 확인하고 site-header/project-home에 /stories 진입 링크 추가. 존재하지 않는 기사·채널 링크 없음.
- docs/DESIGN_SYSTEM.md와 docs/qa/MKT-005에 계약과 재현 증거 기록. app/lib/tests/package/DB/공용 .ai 수정 없음. 의존성·계정 추가·인증 우회·외부 게시·저장 없음.

## 실제 검증

- 최종 npm.cmd run lint: exit 0, npm.cmd run typecheck: exit 0 (D:/Vibe/web).
- 로컬 harness(3315), 실제 Chromium 11가지 UI 사례 PASS: 미검토 실행 거절, 샘플 확인, 편집 후 무효, 재확인 전 실행 거절, 재검토→dry_run_succeeded, 재클릭→공통 DUPLICATE, 공백 본문 거절, 빈 본문 실행 거절, 빈 제목·본문 거절, 샘플 복원 후 무효, Threads 모의 완료.
- 320/390 mobile,768/1440 desktop에서 모의 UI 가로 넘침/잘림 요소 없음. capability 값은 모두 미확인. browser-results.json 참조.
- summary에 초점 후 실제 Enter로 details 열림 확인. unknown/partial 선택 후에도 실제 모의 완료 결과는 유지되고 설명 예시만 변경됨. 별도 JSON과 screenshot 저장. 320px 캡처에서 summary의 초점 테두리도 확인(전체 앱 키보드·포커스 적합 판정은 아님).
- 실제 Next dev(3316) 홈 링크→/stories 이동과 ‘아직 공개된 이야기가 없습니다’ 빈 상태 확인. 새 헤더/홈 및 목록 4폭에 가로 넘침 없음, main 1개. /stories를 임의 글로 채우지 않음.
- 최종 harness console entries 빈 목록, 비잘림. network의 로컬 문서/JS 200 외 외부 게시·저장 요청 없음. result-320/result-1440 PNG 직접 확인.
- React skill 점검: state는 UI 검토 snapshot/입력/안내만, job 전이는 공통 함수 재사용. useId 라벨·안정 key·명시적 타입·derived preview·effect 없음·문자열 텍스트 렌더 유지.

## 발견 문제·수정 여부

앱/공통 배포 로직의 새 결함은 확인하지 못했다. QA harness에서 UTF-8 복사 오류와 .ts 제네릭의 TSX 파싱 오류를 발견했고 fileName 지정 및 UTF-8 복사로 수정했다. 이 문제로 빈 화면이었던 시점은 검증 통과로 기록하지 않았고 수정 후 11사례와 4폭을 실행했다. 공통 모듈은 수정하지 않았다.

DEV-002B의 앱 본문 링크 높이 문제는 Claude MKT-004가 수정했다고 보고했으며 이 작업은 해당 app 파일을 수정하지 않았다. 404 SSR 조사는 Claude MKT-006 범위이므로 건드리지 않았다.

## 미실행·Master 후속

Next 보호 관리자 라우트에 아직 연결하지 않았다. props 없는 클라이언트 시안을 향후 서버 권한 확인 뒤 본문에 배치해야 하며 인증/권한은 이 컴포넌트가 제공하지 않는다. 서버 승인·저장·큐·live 게시·실예약·외부 프로그램·실적/통계·대사 기능은 없다. 실제 화면낭독기·실기기·브라우저 200% 확대 미검증, 편집과 비동기 완료의 극단적 경합은 실제 공급자 지연으로 시험하지 않았다. 공통 로직 단위시험은 이미 존재하여 중복 추가하지 않았다. build는 이번 작업에서 별도 실행하지 않았다.

프로그램 수령 후 capability·권한·미디어 조건, 원문/초안 버전 저장 계약, unknown 결과 대사와 부분 성공, 재시도/중복 방지의 서버 보장을 연결해야 한다. 현재 ref 이력은 화면 이탈 시 사라지므로 운영 중복 방지로 사용하지 않는다.

직접 시작한 3315 harness와 3316 dev 서버는 종료하고 반환한다. 최종 통합/done 판정은 CX-MASTER-01 담당.
