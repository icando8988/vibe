# DEV-001 — 앱 기반과 서버·DB 착수 (+ DEV-002 UI 라우트 연결)

- 상위 DEVELOPMENT-001 / P1 / 책임 CC-ENG-01 (Claude Code, Orca task_f1467d4f779d, dispatch ctx_0d4fc0ab6524)
- 상태: **ready_review** / 2026-11-16 · 통합 판단은 CX-MASTER-01
- 추가 지시: msg_e74f21191938(Master) — DEV-002 공개 UI를 src/app에서 연결. 반영 완료.
- 읽은 입력: AI_TEAM_RULES, .ai/PROJECT·TEAM·TRANSPORT, roles/CLAUDE_CODE, DEC-DEV-START-001, tasks/DEV-001, docs/DEVELOPMENT_CONTRACT v0.1, docs/MASTER_DEVELOPMENT_PLAN(0·10~13·19~24절 중심), docs/DESIGN_SYSTEM.md, results/DEV-002-CX-DESIGN-01.md
- 루트 자격정보(API KEY.txt, DB 비번 파일)는 읽지·복사하지 않았다. Supabase 연결·외부 발송·배포·유료 작업·git init/commit 없음. 추가 위임 없음.

## 검증 결과 (D:/Vibe/web, Node v26.13.0, npm 11.20.0, Windows PowerShell 5.1)

| 명령 | 결과 |
|---|---|
| `npm.cmd install --no-fund --no-audit` | exit 0, 370 packages. 경고 1건: eslint@9.39.5 지원 종료 안내(아래 버전 근거 참고) |
| `npm.cmd run typecheck` (`tsc --noEmit`) | **exit 0** |
| `npm.cmd test` (vitest 5.1.0) | **exit 0**, 3 files / 50 tests passed |
| `npm.cmd run build` (next 16.4.6 Turbopack) | **exit 0**. 정적: / /about /books /how-it-works /_not-found, 동적: /login /me /admin /api/participations /api/status |
| `npm.cmd run lint` | **exit 1 — UI 담당 파일 2건** (아래 INT-DEV-001-01). app/lib/tests에는 lint 오류 없음 |
| `next start -p 3311` 런타임 점검(curl) | 모든 페이지 200(없는 경로 404), 페이지마다 `<main>` 1개·`main#main-content` 1개·h1 1개·`#contact` 1개. /login·/me·/admin·/api/* `Cache-Control: private, no-store`. POST /api/participations → 503 `TRANSACTIONS_DISABLED`. /api/status → 불리언만. `/login?returnTo=//evil.example` → 복귀 경로 `/`로 차단(Next 내부 RSC 라우터 상태에 원 URL이 JSON으로 실리는 것만 확인, 렌더/링크 아님). 점검 후 서버 종료 |

미실행: 브라우저 시각 확인·320~1440px·200% 확대·키보드·화면낭독기, SQL 실행/RLS 쿼리 검증, 인증·DB 연동 시험.

## 변경 목록 (모두 신규, D:/Vibe/web)

- 설정: package.json(정확 버전), package-lock.json, .npmrc(save-exact), tsconfig.json(strict + noUncheckedIndexedAccess, `@/*`), next.config.ts(보안 헤더, 개인 경로 no-store/noindex), eslint.config.mjs(Next 16 flat), vitest.config.mts, .gitignore(.env* 제외, .env.example만 추적), .env.example(변수명만), README.md(실행·버전 근거·구조·안전장치)
- 라우트 src/app: layout.tsx(SiteHeader→라우트→SiteFooter, globals.css 다음 ../styles/design.css), page.tsx(ProjectHome 단독), books/page.tsx(BooksView 단독), about·how-it-works·login·me·admin/page.tsx, not-found.tsx, _components/page-main.tsx(유일 `main#main-content tabIndex=-1`), globals.css(디자인과 겹치지 않는 최소 규칙), api/participations/route.ts(POST 항상 503), api/status/route.ts
- 서버/도메인 src/lib: env.ts(연동 준비 상태, `TRANSACTIONS_ENABLED = false` 상수), auth/viewer.ts(viewer 항상 익명 + decideAccess), domain/errors.ts, order-states.ts(네 상태축 전이표·주체·교차 가드·불변식), money.ts(금액 스냅샷·환불 한도·대사 분류), campaign.ts(모집 시간·재고·1인 상한·목표 basis 명시), input.ts(safeReturnTo·멱등키), progress-label.ts(상태→표시 문구)
- DB: supabase/migrations/20261116000000_initial_foundation.sql (**미실행**)
- 테스트: tests/domain/order-states.test.ts, money-campaign.test.ts, input-access.test.ts
- 빌드 산출(추적 제외): .next/, next-env.d.ts, tsconfig.tsbuildinfo, node_modules/
- 수정하지 않음: src/components/**, src/styles/**, public/design(없음), docs/DEVELOPMENT_CONTRACT.md, 공용 .ai 파일

## 공식 버전 근거 (2026-11-16, npm 레지스트리 `npm view` + nextjs.org 문서)

| 패키지 | 고정 | 근거 |
|---|---|---|
| next / eslint-config-next | 16.4.6 | npm latest(2026-11-09 게시). 설치 문서: "Minimum Node.js version: 20.9", Turbopack 기본, build가 lint를 실행하지 않고 `next lint` 대신 ESLint CLI 권장 |
| react / react-dom | 19.3.1 | npm latest, next peer `^19` 충족 |
| typescript | 6.0.3 | latest 7.0.2는 typescript-eslint peer `>=4.8.4 <6.1.0` 위반 → 6.x 최신. Next 문서상 TS 7은 JS 컴파일러 API가 없어 CLI 경로만 지원 |
| eslint | 9.39.5 | latest 10.15.0이나 eslint-plugin-react/import/jsx-a11y peer가 `^9`까지 → 9.x 최신. npm이 9.x 지원 종료 경고를 냄 → 플러그인 10 지원 시 상향(후속) |
| vitest | 5.1.0 | npm latest, engines `^22.12 \|\| ^24 \|\| >=26` |
| @types/node 24.19.2, @types/react(-dom) 19.3.0 | | 배포 Node 24 LTS 기준, React 타입 latest |

Supabase SDK는 실제 연결 단계에서 최신 확인 후 추가(현재 미설치).

## 설계 요약과 선택 이유

- **네 상태축**(19.2): order/payment/fulfillment/refund를 TS와 SQL 양쪽에서 분리. TS `checkInvariants`와 SQL check 제약을 같은 규칙으로 맞춤: 출고·배포는 verified 후, 전자책은 released만/종이책은 shipped·delivered만, 환불은 확인 입금 있을 때만, 입금 확인 건 취소는 환불 절차 필수, 만료는 미입금만, 완료는 전달 후. 취소/만료는 종료 상태로 부활 전이 없음, 늦은 입금은 mismatch로만(M05). reported는 회원 요청일 뿐이며 verified·환불 completed는 admin만.
- **시간**: `opensAt <= now < closesAt` 서버 판단, 배치가 open으로 남겨도 시간이 우선.
- **목표 basis**: 함수 인자로 반드시 지정하며 기본값 없음, DB `goal_basis`는 null=미확정(DEC-003을 몰래 고르지 않음).
- **RLS 방향**: 모든 테이블 활성. 공개는 published/approved만(상위 비공개 시 하위 숨김). profiles/orders/payment_records/refunds는 본인 읽기 + 관리자 읽기. role_assignments 본인 읽기만. audit_events 클라이언트 접근 없음. 클라이언트 거래 쓰기 정책 없음 + insert/update/delete revoke 이중 차단. profiles는 display_name 열만 본인 수정. `is_admin()`/`is_approved_member()`는 security definer + `search_path=''` + execute를 authenticated로 제한.
- **실거래 비활성**: 환경변수로 켤 수 없는 코드 상수. API는 입력 저장 없이 503.
- **개인 경로**: me/admin/login은 force-dynamic + no-store + noindex, 인증 미연결 시 데이터·건수·관리 메뉴 구조를 렌더하지 않음. 사이트 전체 noindex(공개 승인 전).

## 미연결 기능 / 미결 정책

- 미연결: 이메일·카카오 인증, Supabase 클라이언트·세션, 공개 콘텐츠 DB 조회(현재 BooksView 정적 빈 상태), 신청/취소/입금 확인/환불 쓰기, 알림 outbox, 관리 화면, XLSX, 전자책 다운로드.
- 미결(POLICY-PENDING, 코드/SQL에서 확정하지 않음): DEC-001 seller(B안) — role 값만 예약. DEC-002 수납·10% 수수료 — 계산 없음. DEC-003 입금 순서·목표 basis·예약 만료·입금기한·1인 상한·미달 처리 — nullable 필드. DEC-005 회원 사전승인 유지 — 기본 pending으로 원문 따름. 개인정보 보유기간·주소 수집(shipping_addresses), fulfillments/digital_entitlements/notification_outbox/consent_records/assets/content_posts/inventory 원장은 이번 migration에 넣지 않음(DEV-003 이후).
- SQL: 작성만 하고 **실행하지 않음**. 문법·RLS·권한(특히 profiles 열 권한과 정책 결합)은 DEV-003에서 격리 DB로 검증 필요.

## 통합 주의 (Master 할 일)

| ID | 내용 | 처리 |
|---|---|---|
| INT-DEV-001-01 · lint 실패 | `src/components/books-view.tsx:7`(breadcrumb `<a href="/">`)와 `site-header.tsx:13`(brand `<a href="/">`)이 `@next/next/no-html-link-for-pages` error → `npm run lint` exit 1. build/typecheck에는 영향 없음 | UI 범위라 수정·규칙 비활성화 안 함. UI 담당이 내부 링크를 `next/link`로 바꾸는 것을 권장(다른 내부 `<a>`도 같은 이유로 클라이언트 내비게이션 손실). 규칙 완화는 Master 판단 |
| INT-DEV-001-02 | BooksView/ProjectHome에 데이터 props가 없어 DEV-003 공개 조회 연결 시 UI 계약 확장 필요 | Master가 UI 담당과 props 계약 조정 |
| INT-DEV-001-03 | design.css가 `html{font-size:18px}`·body를 소유. globals.css에는 겹치는 규칙 없음 | 이후 전역 규칙은 한쪽에만 |
| INT-DEV-001-04 | 헤더 메뉴에 /me 진입 링크 없음(의도된 미준비로 보임). /me·/admin은 URL 직접 접근만 | 인증 연결 시 UI에 추가 요청 |
| INT-DEV-001-05 | web 내부 Git 미초기화(커밋 금지 범위라 생략). `.gitignore`는 준비됨 | 초기화·첫 커밋은 Master 결정 |
| INT-DEV-001-06 | eslint 9 지원 종료 경고 | 플러그인 peer가 10을 지원하면 상향 |

## 후속 분해

**DEV-003 스키마·migration·RLS·테스트 데이터 (CC-ENG-01)**
1. Supabase CLI(로컬 Docker 또는 비용 없는 격리 브랜치)를 준비하고 이번 migration 적용, 문법·권한 오류 수정. 계정·비용이 필요하면 Master 결정.
2. 남은 테이블: inventory 원장/예약, fulfillments, shipping_addresses, digital_entitlements, notification_outbox, consent_records, assets, content_posts, journey_segments.
3. RLS 검증 스크립트: anon / member-A / member-B / pending / admin(+B안 seller) 실제 쿼리 매트릭스(T03). 상위 비공개 시 하위 숨김, 자기 승격 불가, 타인 주문·입금 불가.
4. 가짜 실적 없는 테스트 시드(명시적 테스트 표기), 백업·복원 절차 초안.

**DEV-004 인증·역할·회원 승인 (CC-ENG-01)**
1. 그 시점 최신 `@supabase/ssr`·`@supabase/supabase-js` 확인 후 추가, 서버 세션 → `getViewer()` 교체(현재 계약 유지).
2. 가입 트리거로 profiles(pending) 생성, 이메일 우선, 카카오는 콘솔 확인 전 숨김.
3. `safeReturnTo` + 사이트 URL 허용목록으로 인증 리디렉션, 세션 만료/재전송, pending/rejected 화면(20절 S07).
4. admin 부여는 운영 절차(service role)만, 감사 기록. 시험 T02/T03.

**DEV-005 참여/취소·재고·멱등 (CC-ENG-01, DEC-002/003 확정 후 실거래 활성)**
1. `order-states.ts`·`money.ts`·`campaign.ts` 규칙을 DB 함수로 구현: 잠금 순서 캠페인→주문→입금/환불→재고, 사용자+작업+멱등키 유일, 동일키/다른 입력 CONFLICT.
2. 신청·취소·만료·입금 확인·환불 완료 API(19.3) + expected version, 재고 복원 1회(`inventory_released_at`).
3. 경합 시험 T05(남은 10개·동시 20건), 경계시각 T06, 취소/입금 T07, 환불 누계 한도.
4. `TRANSACTIONS_ENABLED`는 결정 기록과 리뷰 후에만 코드로 변경.
