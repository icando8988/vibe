# 세계일주·출판 프로젝트 웹앱 (가칭)

비공개 개발 단계. 2026-11-16 기준(INT-002 정리). 인증·DB·거래·외부 게시는 **연결되지 않았다**. 화면이 있다고 기능이 완료된 것이 아니다.

## 실행

Windows PowerShell에서는 `npm.cmd`를 쓴다.

```powershell
npm.cmd ci             # package-lock.json 그대로 설치
npm.cmd run dev        # 개발 서버 http://localhost:3000
npm.cmd run typecheck  # tsc --noEmit  (라우트를 추가·삭제했다면 build 뒤에 실행: .next/types 갱신)
npm.cmd test           # vitest: 도메인·배포·콘텐츠 순수 함수 + 라우트 설정 회귀
npm.cmd run lint       # eslint (Next 16부터 build가 lint를 실행하지 않음)
npm.cmd run build      # 프로덕션 빌드
```

환경변수는 `.env.example`에 이름만 있다. 값을 넣지 않아도 앱은 '미연결' 상태로 빌드·실행된다. 실제 값은 추적 제외된 `.env.local`에만 둔다.

### 마지막 확인 결과 (2026-11-16, Node 26.13.0)

lint·typecheck exit 0, `npm test` 10 files / 186 tests 통과(QA-MKT-002 기준). build는 MKT-006에서 exit 0. DB 시험(`tests/db`)은 실행기가 없어 **미실행**.

### CI (GitHub Actions)

`.github/workflows/ci.yml` — `main` push와 pull request에서 `npm ci → lint → test → build → typecheck`를 실행한다(로컬 순서와 같음).
- 권한 `contents: read`만. 배포·비밀값·원격 쓰기·특권 트리거 없음. 공식 action을 커밋 SHA로 고정했다.
- Node 버전은 `.nvmrc`(24)를 따른다. npm 캐시 키는 `package-lock.json`.
- **아직 GitHub에서 한 번도 실행하지 않았다**(원격 저장소 미설정). 첫 push 뒤 결과를 확인해야 한다. 근거·대기 항목: `../docs/CI_VERIFICATION.md`(루트 문서 폴더, 이 저장소 밖).

### Windows 개발 ↔ Linux CI 차이

| 항목 | 로컬(Windows) | CI(ubuntu-latest) |
|---|---|---|
| npm 실행 | PowerShell에서 `npm.cmd` | `npm` |
| Node | 26.13.0(현재 Active LTS 계열) | `.nvmrc` 24 |
| 파일 경로 대소문자 | 구분 안 함 | **구분함**. import 경로는 실제 파일명과 대소문자까지 같아야 한다(2026-11-16 점검: 문제 0건) |
| `.next` 잔여물 | 라우트를 지운 뒤 typecheck를 build보다 먼저 돌리면 옛 타입 때문에 실패할 수 있음 → build 후 typecheck | 매번 깨끗한 checkout이라 해당 없음 |
| 줄바꿈 | CRLF일 수 있음 | LF. 현재 검사 도구들은 줄바꿈에 영향받지 않음 |

## 현재 상태

| 영역 | 상태 |
|---|---|
| 공개 화면 | 홈·도전 이야기·책과 참여·참여 안내·이야기 목록. 실제 사진·가격·실적 없음. UI(`src/components`, `src/styles`)는 Design 담당이며 이 문서는 12:44 시점 파일 기준 |
| 사이트 색인 | 전체 `noindex, nofollow`. 공개 승인 전 해제하지 않는다 |
| 이야기(/stories) | 저장소가 비어 있어 빈 상태 안내. 공개 판정(게시·공개 허용·검토·출처 확인·게시 시각)을 통과한 글만 보인다 |
| 이야기 변경 반영 | **빌드 시점에 확정된다.** 상세 라우트가 `dynamicParams = false` + `generateStaticParams`라서 글 추가·공개 변경·예약 게시 시각 도래는 재빌드(재배포)해야 반영된다. 저장소를 DB/CMS로 바꾸거나 예약 게시를 연결하기 전에 이 방식을 다시 정해야 한다(이유: `docs/qa/MKT-006/README.md`) |
| 없는 주소 404 | 라우팅 단계 404로 서버 HTML에 안내·복구 링크 포함(JS 없이도 보임). 페이지 렌더 중 `notFound()`는 Next 16.4.6에서 빈 오류 셸을 보내므로 새 동적 라우트에서도 같은 방식을 쓴다 |
| 로그인·회원 | 미연결. `/me`, `/admin`은 개인·운영 데이터를 렌더하지 않는다 |
| 거래 | `POST /api/participations` 항상 503. `TRANSACTIONS_ENABLED = false` 코드 상수 |
| 콘텐츠 배포(블로그·Threads·Instagram) | `src/lib/distribution`에 공통 타입·상태 전이만. 실제 공급자 어댑터 없음(live는 NOT_CONNECTED, dry-run은 미리보기만). **자동포스팅 프로그램 미제공** |
| 외부 호출·추적 | `src`에 fetch·외부 스크립트·분석 태그 없음 |
| DB | `supabase/migrations` 초기 스키마·RLS·열 권한 작성. **실제 DB에서 실행 검증 안 함**(`tests/db`는 실행기 준비 후 실행) |

## 버전 고정과 근거 (2026-11-16 확인)

`.npmrc`의 `save-exact=true`와 package.json 정확 버전으로 고정했다. 확인 출처: npm 레지스트리(`npm view`)와 Next.js 공식 문서.

| 패키지 | 버전 | 근거 |
|---|---|---|
| next | 16.4.6 | npm latest (2026-11-09 게시). nextjs.org 설치 문서: Node.js 최소 20.9, Turbopack 기본, `next lint` 대신 ESLint CLI |
| react / react-dom | 19.3.1 | npm latest. next 16.4.6 peer `^18.2.0 \|\| ^19.0.0` 충족 |
| typescript | 6.0.3 | 최신은 7.0.2이나 **typescript-eslint(eslint-config-next 의존) peer가 `>=4.8.4 <6.1.0`** 이라 6.x 최신으로 고정 |
| eslint | 9.39.5 | 최신은 10.x이나 eslint-plugin-react/import/jsx-a11y peer가 `^9`까지라 9.x 최신으로 고정. npm이 9.x 지원 종료 경고를 표시함 → 플러그인이 10을 지원하면 올린다 |
| eslint-config-next | 16.4.6 | next와 동일 버전 |
| vitest | 5.1.0 | npm latest. engines `^22.12 \|\| ^24 \|\| >=26` |
| @types/node | 24.19.2 | 배포 런타임 Node 24 LTS 기준 |
| @types/react, @types/react-dom | 19.3.0 | npm latest |

Supabase SDK는 실제 연결 단계(DEV-004)에서 그때의 최신 버전을 확인해 추가한다.

## 구조

```
src/app/                라우트
  layout.tsx            SiteHeader/SiteFooter + globals.css → styles/design.css
  page.tsx, books/      UI 컴포넌트 ProjectHome / BooksView 단독 렌더 (자체 main 포함)
  stories/              이야기 목록(동적) · 상세(빌드 시 확정, dynamicParams=false)
  about/ how-it-works/ login/ me/ admin/   _components/page-main.tsx 로 유일 main#main-content
  api/participations    POST 항상 503 TRANSACTIONS_DISABLED
  api/status            연동 준비 상태 불리언만
src/components, src/styles   UI(Design) 범위
src/lib/domain/         판매 도메인 규칙: 네 상태축 전이·불변식, 금액, 캠페인, 입력 검증
src/lib/distribution/   콘텐츠 배포 공통 계약: 작업 상태·멱등키·대사·UTM·미연결/모의 어댑터
src/lib/content/        공개 이야기: 공개 판정·빈 저장소·텍스트 렌더·metadata
src/lib/auth/viewer.ts  viewer 판별(현재 항상 익명) + 접근 판정
src/lib/env.ts          연동 준비 상태, TRANSACTIONS_ENABLED=false
supabase/migrations/    초기 스키마·RLS·열 권한 (미실행)
tests/                  domain · distribution · content (npm test) / db (별도 설정, 미실행)
```

## 안전장치

- `/me`, `/admin`, `/login`, `/api/*`: 동적 렌더 + `Cache-Control: private, no-store` + noindex.
- 실거래 스위치는 환경변수가 아니라 코드 상수.
- 로그인 복귀 경로는 `safeReturnTo`로 내부 경로만 허용.
- 이야기 본문은 텍스트로만 렌더(HTML 해석 없음). canonical·OG 주소는 공개 사이트 주소 확정 전에는 만들지 않는다.

## 미연결·미결

인증(이메일·카카오), Supabase 연결, 신청/취소/입금/환불 쓰기, 알림, 관리 기능, 외부 게시는 미구현. 목표 기준·입금 순서·만료·1인 상한·수수료는 DEC-002/003 결정 전이라 확정하지 않았다(`POLICY-PENDING` 주석). 승인된 이야기 원문, 공개 사이트 주소, 자동포스팅 프로그램은 아직 받지 않았다.
