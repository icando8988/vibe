# CI-001 — GitHub 검사 자동화 준비

- 책임 CC-ENG-01 / Master 지시 msg_a293478b2a83, .ai/tasks/CI-001-CC-ENG-01.md / 2026-11-16
- 상태: **ready_review** — workflow 작성 완료, **GitHub에서는 실행하지 않음**(원격·인증 미설정)

## 변경

- `web/.github/workflows/ci.yml`(신규)
  - 트리거: main push, pull request
  - 권한: `contents: read`
  - 단계: `npm ci → lint → test → build → typecheck`
  - 공식 action을 SHA로 고정: checkout v7.0.1 `3d3c42e…`, setup-node v7.1.0 `949feb2…`
  - checkout은 `persist-credentials: false`, npm 캐시 키는 lockfile
  - secret·배포·원격 쓰기·특권 트리거 없음
- `web/.nvmrc`(신규): `24`
- `web/README.md`: CI 설명, Windows ↔ Linux 차이 표, 최신 검증 수치(186 tests)
- `docs/CI_VERIFICATION.md`: action 고정 근거, Node 버전 판단, 정적 점검, 첫 push 후 확인 항목
- package·lock·app·lib·tests·components·DB·공용 .ai 미변경

## 근거와 점검

- action 버전·SHA: GitHub 공개 API로 latest 릴리스, 태그가 가리키는 커밋(서명 verified), 그 SHA의 `action.yml`(node24 런타임, 사용할 입력 존재)을 확인했다.
- 정적 점검
  - YAML 구조: 이미 설치된 js-yaml로 해석(새 설치 없음)
  - `uses` 2개 모두 SHA로 고정, secrets 참조 없음
  - CI 명령이 로컬 스크립트와 같음
  - lockfile v3가 package.json과 일치(`npm ci` 가능)
  - import 경로 대소문자 61개 파일 문제 0(Linux 대비)
  - `.github`·`.nvmrc`는 추적 대상
- 로컬 테스트·빌드는 재실행하지 않았다. 변경이 workflow·문서뿐이라 기존 근거(186 tests·lint·typecheck, MKT-006 build)를 사용했다.

## 남은 일 / 결정

1. 첫 push 후 실제 CI 결과 확인(`docs/CI_VERIFICATION.md` 마지막 절).
2. Node 기준: CI는 지시대로 24. 다만 2026-11-16 현재 Node 26이 Active LTS이고 로컬은 26.13.0이다. 26으로 올릴지 Master가 결정.
3. 브랜치 보호에서 필수 검사로 지정할지는 사용자·Master 결정.
