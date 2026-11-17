# CI-002 — Node 24 기준 실제 로컬 호환 검증

- 책임 CC-ENG-01 / Master 지시 msg_ff80af35fb71, .ai/tasks/CI-002-CC-ENG-01.md / 2026-11-16
- 상태: **closed — 로컬 실측 생략, 첫 GitHub CI로 대체(사용자 결정 2026-11-16)**

## 결정 (2026-11-16, 사용자)

선택지 3 채택: 로컬 Node 24 실측은 하지 않고, 첫 push 후 GitHub CI(Node 24, `.nvmrc`) 결과를 첫 Node 24 검증으로 삼는다. 권한 규칙 추가와 재시도는 하지 않는다. CI 결과 확인 항목은 `docs/CI_VERIFICATION.md` 마지막 절.

## 수행

1. Node 24 실행기 탐색(읽기 전용): 없음. 시스템 Node는 26.13.0 하나, 버전 관리자도 없다.
2. npm 공식 `node@24` 확인: 최신 24.22.3. 격리 캐시를 써서 메타데이터만 조회했다(tarball 주소, `node-bin-setup` 의존성, preinstall이 플랫폼별 바이너리를 설치하는 구조).
3. 격리 실행 `npm exec --cache <스크래치> --package=node@24.22.3 -- node -e …` 시도 → **Claude Code 권한 분류기가 실행 전에 거부**(외부 바이너리 내려받기·실행). 동일 조건 재시도와 우회는 하지 않았다.

## 결과

- Node 24에서 lint·test·build·typecheck는 **실행하지 않았다.** Node 24 호환은 실측 근거가 없다(엔진 범위상 지원 대상이라는 정적 근거만 있음).
- 코드 결함은 발견하지 못했다(실행하지 않았으므로 판단 불가).
- 변경: `docs/CI_VERIFICATION.md`에 CI-002 절 추가. 웹 소스·lock·workflow·전역 환경은 변경하지 않았다. 스크래치 캐시에는 메타데이터만 있다.

## 진행하려면 (사용자·Master 선택)

1. 사용자가 공식 node@24를 npm exec로 격리 실행하는 것을 허용하는 권한 규칙 추가 → 재실행.
2. 사용자가 Node 24 환경에서 직접 실행.
3. 첫 push 후 GitHub CI 결과를 첫 Node 24 검증으로 삼기.
