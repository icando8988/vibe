# INT-002 — GitHub push 전 준비 검토

- 책임 CC-ENG-01 / Orca task_0099dca2844c, dispatch ctx_2bb4d55411f2 / 2026-11-16
- 상태: **ready_review** (변경안·안전점검만. stage/commit/push/remote/계정 작업 없음)

## 수행

- 읽기 전용 Git 점검: 최상위 `D:/Vibe/web`, `main`, 커밋·remote 없음, local config에 user.name/email 없음. 후보 70개(루트 자료 0). 무시 대상 `node_modules/ .next/ next-env.d.ts *.tsbuildinfo`.
- `.gitignore` 보강: 키·인증서·자격 JSON, 브라우저 자동화 상태(쿠키·storage-state·프로필·ego), 로컬 실행기 산출물, supabase 로컬 env, 로그·덤프·로컬 DB, OS/편집기 파일. migration·`tests/db/*.sql`·`.env.example`은 추적 유지(`git check-ignore`로 확인), 후보 수 변화 없음(70).
- 비밀값 스캔(후보 70개, 경로·유형만): 실제 비밀 0건. 이메일 형태 2건은 시험 fixture(`tests/content/content.test.ts:137`, `tests/distribution/adapters-utm.test.ts:90`, 예약 도메인 `.invalid`의 계정정보 포함 URL 거절 시험) → 오탐. `.env.example` 4개 변수 모두 빈 값.
- 외부 호출·추적: `src`에 fetch·외부 스크립트·분석 태그 없음, 거래 상수 false, 배포 live 어댑터 미연결.
- `web/README.md` 현황 재정리: 실행·검증, 마지막 확인 결과(MKT-006 110 tests), 사이트 noindex, 이야기 **빌드 시점 고정·재배포 필요·예약 글 자동 공개 안 됨**, 404 방식, 거래/로그인/배포 미연결, 자동포스팅 프로그램 미제공, DB 실제 미검증, UI 12:44 시점 기준 명시.
- `docs/CONTENT_WORKFLOW.md`: 빌드 고정의 구체 영향(글 변경·예약 시각·목록과 상세 불일치 가능성)과 저장소 이전 시 재검토 항목 추가.
- `docs/PUSH_READINESS.md`: 대상, 후보 표(합계 70), 제외 확인, 검수 결과, 남은 입력, 원격 이력 보존 방침.
- 빌드·시험 재실행 안 함: 변경이 `.gitignore`·markdown뿐이라 런타임 영향 없음(MKT-006 증거 유지).

## 변경 파일

`web/.gitignore`, `web/README.md`, `docs/CONTENT_WORKFLOW.md`(Master 메시지에서 지정), `docs/PUSH_READINESS.md`, 이 파일. 스캔 스크립트는 세션 임시 폴더에만 두고 저장소에 넣지 않았다.

## Master 할 일 / 남은 입력

1. 원격 저장소 주소·공개 범위(비공개 권장), GitHub 인증 방식, 커밋 작성자 — 모두 미확인.
2. 원격에 기존 이력이 있으면 강제 push 금지, 확인 후 병합/별도 브랜치.
3. 커밋 직전 `git status`로 후보 목록이 PUSH_READINESS와 같은지 재확인(Design이 UI를 수정 중일 수 있음).
