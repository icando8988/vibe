# GitHub push 준비 점검

INT-002 · CC-ENG-01 · 2026-11-16 12:50 기준. **stage·commit·push·remote 설정·계정 작업은 하지 않았다**(Master 담당).

## 대상

- 저장소: `D:/Vibe/web` (`git rev-parse --show-toplevel` = `D:/Vibe/web`, 브랜치 `main`, 커밋 없음, remote 없음).
- 상위 `D:/Vibe`의 기획서 XLSX·ZIP·문서·`.ai`·비밀 메모 파일은 이 저장소 밖이라 포함되지 않는다. 루트 비밀 파일은 열지 않았다.

## push 후보 (untracked, 제외 규칙 적용 후 70개)

| 묶음 | 개수 |
|---|---|
| 루트 설정: `.env.example .gitignore .npmrc AGENTS.md README.md eslint.config.mjs next.config.ts package.json package-lock.json tsconfig.json vitest.config.mts` | 11 |
| `src/app/**` | 16 |
| `src/components/**` (Design) | 6 |
| `src/styles/design.css` (Design) | 1 |
| `src/lib/**` (auth 1, content 6, distribution 7, domain 6, env.ts 1) | 21 |
| `supabase/migrations/*.sql` | 1 |
| `tests/**` (content 2, distribution 2, domain 4, db 6 — db는 미실행 시험·Supabase 대체 스텁) | 14 |
| 합계 | **70** |

정확한 목록은 `git ls-files --others --exclude-standard`로 재확인한다.

`AGENTS.md`는 `next dev`가 생성·유지하는 파일이다(Next 안내상 커밋 권장).

## 제외 확인 (`git check-ignore`로 확인)

`node_modules/ .next/ next-env.d.ts *.tsbuildinfo` 실제 무시됨. `.env`·`.env.local`·`*.pem`·`API KEY*`·`ego/`·로그 경로를 시험해 모두 무시됨, `.env.example`·migration·`tests/db/*.sql`은 추적 유지.
`.gitignore` 보강(INT-002): 키·인증서·자격 JSON, 브라우저 자동화 상태(쿠키·storage-state·프로필·ego), 로컬 실행기(.pglite, playwright 결과), supabase 로컬 env, 로그·덤프·로컬 DB 파일, OS/편집기 파일.

## 커밋 전 검수 결과

| 항목 | 결과 |
|---|---|
| `.env.example` | 변수 4개 모두 빈 값 |
| 비밀값 패턴 스캔(후보 70개, 경로·유형만 출력) | 개인키·클라우드/GitHub/AI 토큰·JWT·Supabase 주소/키·DB 접속 문자열·값 있는 env 할당·비밀번호 리터럴: **0건**. "이메일 형태" 2건은 시험 파일의 계정정보 포함 URL 거절 fixture(예약 도메인 `.invalid`, 가짜 값) → 오탐 |
| 외부 호출·추적 | `src`에 fetch·WebSocket·외부 스크립트·분석 태그 없음. 절대 URL은 내부 검증용 `internal.invalid`뿐. 환경변수 직접 읽기는 `NEXT_PUBLIC_SITE_URL`(미설정)과 Supabase 설정 존재 여부 확인뿐 |
| 거래·게시 | `TRANSACTIONS_ENABLED = false` 상수, 거래 API 503. 배포 어댑터 live는 NOT_CONNECTED |
| 빌드 산출물·임시 파일 | 후보에 없음(확인용 라우트·임시 harness·서버 로그 잔존 없음) |
| 파일 크기 | 최대 package-lock.json 244KB |
| 빌드·시험 | MKT-006 시점 build/typecheck/lint exit 0, 110 tests. 이번 변경은 `.gitignore`·README뿐이라 재실행하지 않았다 |
| UI 파일 | Design 작업 중일 수 있음. 위 점검은 12:44 수정본 기준 |

## 남은 입력 (사용자/Master)

1. 원격 저장소 공개 범위: **공개(public)로 확정** — 사용자 직접 지시, 2026-11-16("개발 중 불편할 것 같아"). 앞서 지시한 비공개를 변경함. 저장소 주소(계정/조직·저장소 이름)는 아직 미정.
   - 공개 시 함께 공개되는 것: 소스 전체, DB 스키마·권한 설계, 기획 단계 문구, `src/components/project-home.tsx`의 도전자 실명(Design 범위). 비밀값 스캔 결과 0건.
   - 한 번 공개된 내용은 나중에 비공개로 돌려도 복제·캐시가 남을 수 있다.
   - 실명 노출: 사용자 확인 완료, 그대로 둔다(2026-11-16 "실명은 그대로 둬도 돼").
2. 이 환경의 GitHub 인증: `gh` 2.103.2 설치됨, **로그인 안 됨**(2026-11-16 확인). 사용자가 직접 `gh auth login` 필요. 토큰을 파일·채팅·저장소에 두지 않는다.
3. 커밋 작성자 `user.name`/`user.email`: 전역·저장소 모두 미설정. 임의로 만들지 않는다.

## 방침

- 원격에 기존 이력이 있으면 강제 push로 덮지 않는다. fetch 후 내용 확인 → 별도 브랜치 push 또는 병합을 Master가 결정.
- 첫 커밋은 위 후보 목록 그대로, `git add -A` 전에 `git status`로 목록이 이 문서와 같은지 다시 확인.
- 루트 `D:/Vibe` 자료는 이 저장소에 복사하지 않는다.
