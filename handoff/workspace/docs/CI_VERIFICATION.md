# CI 검증 기록

CI-001 · CC-ENG-01 · 2026-11-16. 대상: `D:/Vibe/web/.github/workflows/ci.yml`, `D:/Vibe/web/.nvmrc`.

## 판정: 작성 완료, **GitHub 미실행**

원격 저장소·인증이 아직 설정되지 않아 GitHub Actions에서 한 번도 돌리지 않았다. 아래는 정적 점검 결과다. 실제 CI 통과를 뜻하지 않는다.

## 구성

| 항목 | 값 |
|---|---|
| 트리거 | `push`(main), `pull_request`. `pull_request_target`·`workflow_run` 등 특권 트리거 없음 |
| 권한 | `contents: read` |
| 러너 | `ubuntu-latest`, 제한 시간 15분, 같은 ref 중복 실행 취소 |
| 단계 | checkout → setup-node → `npm ci` → `npm run lint` → `npm test` → `npm run build` → `npm run typecheck` |
| 환경 | `NEXT_TELEMETRY_DISABLED=1`만. secret·토큰·`.env` 값 요구 없음(앱은 미연결 상태로 빌드됨) |
| checkout | `persist-credentials: false`(토큰을 작업 폴더에 남기지 않음) |
| 캐시 | setup-node `cache: npm`, `cache-dependency-path: package-lock.json` |

## 공식 action 고정 근거 (2026-11-16, GitHub 공개 API로 확인)

| action | 릴리스 | 고정 SHA | 확인 |
|---|---|---|---|
| actions/checkout | v7.0.1 (2026-07-20, latest) | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 태그 ref가 이 커밋을 직접 가리킴, 커밋 서명 verified. `action.yml` runs.using `node24`, `persist-credentials` 입력 존재 |
| actions/setup-node | v7.1.0 (2026-10-08, latest) | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 태그 ref → 커밋, 서명 verified. `action.yml` runs.using `node24`, `node-version-file`·`cache`·`cache-dependency-path` 입력 존재 |

조회 경로: `api.github.com/repos/<repo>/releases/latest`, `.../git/ref/tags/<tag>`, `.../commits/<sha>`, `raw.githubusercontent.com/<repo>/<sha>/action.yml`. 외부 문서의 지시를 따르지 않았고 값만 확인했다.

## Node 버전

- `.nvmrc` = `24`: Master 지시(Node 24 LTS 기준)와 `@types/node` 24에 맞춤. 2026-11-16 기준 v24 최신은 24.22.3(Krypton).
- Node 26은 2026-11-16 현재 Active LTS(Lithium, 26.13.1)이고 로컬 개발은 26.13.0으로 검증했다. CI(24)와 로컬(26)이 다르므로 기준을 26으로 올릴지 Master가 결정한다.
- 엔진 호환: 앱 `>=20.9.0`, next `>=20.9.0`, vitest `^22.12 || ^24 || >=26` → 24·26 모두 충족.

## 정적 점검 결과

| 점검 | 결과 |
|---|---|
| YAML 구조 | 이미 설치된 `js-yaml`로 해석 성공(새 설치 없음). 트리거·권한·단계 순서 확인 |
| action 고정 | `uses` 2개 모두 40자리 SHA. `secrets.` 참조 없음 |
| CI 명령 ↔ 로컬 스크립트 | `lint`=`eslint`, `test`=`vitest run`, `build`=`next build`, `typecheck`=`tsc --noEmit`. 로컬 검증 명령과 같음 |
| lockfile | `package-lock.json` v3 있음, package.json 의존성과 일치 → `npm ci` 가능 |
| 대소문자 | 추적 후보 TS/JS 61개의 상대·`@/` import 해석 결과 실제 파일명과 대소문자 일치(문제 0) |
| 추적 여부 | `.github/`·`.nvmrc` 모두 `.gitignore`에 걸리지 않음(push 후보에 포함) |
| 로컬 근거 | QA-MKT-002: lint·typecheck exit 0, 186 tests. MKT-006: build exit 0. 이번 변경은 workflow·문서뿐이라 재실행하지 않음 |

`js-yaml` 검사에서 `pull_request_target` 문자열이 걸린 것은 "쓰지 않는다"는 주석 때문이며 트리거 목록에는 없다.

## CI-002 Node 24 로컬 실측 — **미실행(권한 차단)**

2026-11-16 · Master 결정: CI 기준 Node 24 유지.

| 단계 | 결과 |
|---|---|
| 사용 가능한 Node 24 실행기 탐색 | 없음. 시스템 Node는 26.13.0 하나. nvm·fnm·volta 없음 |
| npm 공식 패키지 확인 | `node@24` 최신 24.22.3. tarball `https://registry.npmjs.org/node/-/node-24.22.3.tgz`, 의존성 `node-bin-setup`, preinstall이 플랫폼별 바이너리 패키지를 설치하는 구조(메타데이터만 조회, 격리 캐시 사용) |
| 격리 실행 `npm exec --cache <스크래치> --package=node@24.22.3 -- node -e "process.version…"` | **실행 전 차단.** Claude Code 권한 분류기가 외부 바이너리 내려받기·실행을 거부함. 같은 조건으로 재시도하지 않았고 우회도 하지 않았다 |
| Node 24로 lint/test/build/typecheck | **미실행** |

현재 근거는 Node 26.13.0의 로컬 결과(186 tests, lint·typecheck exit 0, build exit 0)와 엔진 범위(앱·next `>=20.9.0`, vitest `^24` 포함)뿐이다. **Node 24 동작은 실측되지 않았다.**

실측 방법(아래 중 하나가 필요):
1. 사용자가 이 세션에 npm exec로 공식 node@24를 받아 실행하는 것을 허용하는 권한 규칙을 추가한다. 이후 위 명령으로 `process.version`이 v24.x인지 먼저 확인하고, 같은 node로 각 도구를 직접 실행한다(`node node_modules/eslint/bin/eslint.js`, `node node_modules/vitest/vitest.mjs run`, `node node_modules/next/dist/bin/next build`, `node node_modules/typescript/bin/tsc --noEmit`).
2. 사용자가 직접 Node 24 환경에서 같은 명령을 실행한다.
3. 첫 push 후 GitHub CI(Node 24) 결과로 확인한다. 이 경우 로컬 실측 없이 CI가 첫 Node 24 검증이 된다.

**결정(2026-11-16, 사용자): 3번 채택.** 로컬 Node 24 실측은 하지 않는다. 첫 push 후 GitHub CI 실행이 첫 Node 24 검증이다. 그 전까지 Node 24 호환은 미확인 상태로 둔다.

## 첫 GitHub CI 실행 결과 — **통과** (2026-11-16)

- 저장소 `icando8988/vibe`(public), 커밋 `854285e`, run `43821977238`.
- Setup Node: **v24.22.2**(러너 캐시). → CI-002 Node 24 첫 실측 통과.
- 단계: Checkout · Setup Node.js · Install(lockfile) · Lint · Test · Build · Typecheck 모두 success.
- 외부 연동: 커밋 status·deployments·webhook 없음. Vercel/Supabase는 GitHub에 연결되지 않음(로컬 CLI도 없음).

## 첫 push 후 확인할 항목

1. Actions 탭에서 첫 실행이 `npm ci`부터 `typecheck`까지 모두 통과하는지(특히 Linux에서 build·test). **이 실행이 Node 24 첫 실측이다**(CI-002 결정). Setup Node 로그에서 실제 버전이 v24.x인지 기록한다.
2. setup-node의 npm 캐시가 저장되고 두 번째 실행에서 복원되는지.
3. 저장소 설정 > Actions 권한이 "읽기 전용 기본 토큰"인지(워크플로 `permissions`와 함께 확인).
4. 실패하면 로그의 단계 이름(Install / Lint / Test / Build / Typecheck)으로 원인을 나눠 보고.
5. (선택) 브랜치 보호에서 이 검사를 필수로 지정할지 — Master·사용자 결정.
