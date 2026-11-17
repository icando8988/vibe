# 공개 UI 디자인 시스템 v0.1

DEV-002 · CX-DESIGN-01 · 2026-11-16. 비공개 검토용 첫 구현이며 브랜드·거래 정책 승인본이 아니다.

## 방향과 콘텐츠

흰 바탕, 읽기 쉬운 짙은 글자, 파랑 CTA와 주황 강조를 사용한다. 사진·가짜 표지·가격·후원자·실적·경로 없이 도전 소개 → 책과 참여 → 준비 과정 → 문의·정책 순서로 읽는다. 도전은 계획으로만 표현한다. 공식 이름 확정 전 머리말과 푸터에 임시 이름/검토용임을 표시한다.

## 토큰

| 용도 | CSS 변수 | 값 |
|---|---|---|
| 주 CTA | --ds-blue | #2563eb |
| 링크·포커스 | --ds-blue-dark | #1e40af |
| 파랑 면 | --ds-blue-soft | #eff6ff |
| 장식 강조 | --ds-orange | #f97316 |
| 주황 면 위 글자 | --ds-orange-ink | #9a3412 |
| 주황 면 | --ds-orange-soft | #fff7ed |
| 본문 | --ds-ink | #172b4d |
| 부가 설명 | --ds-muted | #526178 |
| 배경·보조 면 | --ds-paper / --ds-surface | #ffffff / #f7f9fc |
| 경계 | --ds-line | #cbd5e1 |
| 오류 글자·면 | --ds-error / --ds-error-soft | #991b1b / #fef2f2 |
| 최대 폭·큰 모서리 | --ds-content / --ds-radius | 1180px / 20px |

시스템 글꼴만 사용한다. 루트 18px, 본문 줄높이 1.7. 주요 제목은 clamp로 폭에 대응한다. 주황 원색은 흰 글자 버튼 배경으로 사용하지 않는다. 일반 링크는 밑줄, 메뉴·버튼은 공간과 형태로 구분한다. 최소 조작 높이는 44px, 주요 CTA 50px다.

## 연결 방법

Master가 `web/src/app/layout.tsx`에서 기존 전역 CSS 뒤에 `import '../styles/design.css'`를 한 번 추가한다. SiteHeader → 라우트 내용 → SiteFooter 순서로 배치한다. 홈은 ProjectHome, /books는 BooksView를 각자 단독 본문으로 사용하며 추가 main으로 감싸지 않는다. 두 본문은 자체 `main#main-content`와 h1을 제공한다. 나머지 페이지도 유일한 `main id="main-content" tabIndex={-1}`을 제공해야 본문 바로가기와 키보드 이동이 이어진다.

| 파일 | named export | 입력 |
|---|---|---|
| components/site-header.tsx | SiteHeader | 없음 |
| components/site-footer.tsx | SiteFooter | 없음 |
| components/project-home.tsx | ProjectHome | 없음 |
| components/books-view.tsx | BooksView | 없음 |
| components/status-notice.tsx | StatusNotice | title: string, children: ReactNode, tone?: info/warning/error, announce?: boolean |

모두 서버 렌더링 가능한 React 컴포넌트다. 추가 의존성·클라이언트 상태·네트워크 요청·폼 제출·외부 자산이 없다. 헤더를 숨기는 모바일 메뉴 대신 줄바꿈되는 전체 메뉴를 제공한다. /about, /books, /how-it-works, /login은 계약 경로다. #contact는 SiteFooter 안에 있으며 함께 렌더링해야 한다. 없는 문의·정책 페이지로 링크하지 않고 푸터에서 미준비 상태를 직접 안내한다. 실제 문의 경로·정책이 확보되면 Master가 공개 전 연결해야 한다.

## 상태와 접근성

- 홈: 준비 단계, 신청·입금 미접수. 책 목록: 자료 미확보/모집 전 빈 상태. 0원·가짜 상품·실적 집계·검색 결과 없음으로 오인시키는 표현 없음.
- 회원: 회원 이용 안내로 /login 이동, 가입 완료를 약속하지 않는다. 거래: 미연결 사유를 텍스트로 안내하며 제출·입금 완료 동작 없음.
- StatusNotice: info/warning/error 모두 제목과 본문으로 설명한다. 초기 정적 콘텐츠는 live region을 쓰지 않는다. 사용자 행동 뒤 실제 안내가 바뀔 때만 announce=true로 role=status를 활성화한다. 실제 로딩·서버 오류는 데이터 연동 시 호출자가 상태와 복구 경로를 넣어야 한다.
- 랜드마크·제목 계층·순서 있는 과정 목록·내비게이션 이름·장식 aria-hidden 적용. 본문 바로가기와 3px 포커스 표시, 강제 색상·동작 감소 대응. 고정 헤더/하단 CTA와 자동 애니메이션 없음.
- 960px에서 헤더 줄 분리, 700px에서 한 열로 재배치. 320px에서도 최소 고정 본문 폭 없이 단어 줄바꿈되도록 설계. 실제 화면과 200% 확대 합격 판정은 브라우저 검증 후 가능.

## 검증과 후속 인수

정적 검사: 계약의 5개 export, TSX의 정적 class에 대응 CSS 존재, 외부 요청·가짜 동작 없음 확인. sRGB 대비 계산으로 파랑/흰색, 진한 파랑/흰색, 부가글/보조면, 본문/파랑면, 주황글/주황면을 확인했다. 구체 값은 결과 문서 참조.

React best practices 점검: props는 명시적 타입, 안정적인 목록 key, 순수 컴포넌트와 정적 데이터, 불필요한 effect/state/memo 없음, 직접 모듈 import, HTML escape 유지. 외부 UI 패키지와 CSS-in-JS 없음.

패키지·컴파일러·라우트 연결이 준비되면 Master가 typecheck/build/lint와 320/360/390/768/1024/1440px, 200% 확대, Tab/Shift+Tab/Enter, 본문 바로가기, footer anchor, 화면낭독기 상태 안내를 검증한다. 실제 사용자·콘텐츠·거래 검증은 별도 단계다.

## DEV-002B 통합 검증과 MKT-002 우선순위 변경

내부 페이지 링크는 next/link로 통일하고 #main-content/#contact/#stories는 기본 앵커를 유지한다. DEV-002B에서 lint/typecheck와 8경로×4폭 검사를 수행했다. 앱 본문 일부 링크의 24px 높이와 실제 브라우저 확대/가시 포커스 검증 제한은 DEV-002B 결과 참조.

DEC-MARKETING-001 이후 홈 흐름은 도전 이야기 → 콘텐츠 준비 안내 → 기획 주제 → 보조 책 안내 → 문의·정책이다. 주요 CTA는 /about, 보조 CTA는 현재 홈의 #stories다. 없는 기사/구독/공식 채널 링크는 생성하지 않는다. 기존 회원·책 경로는 준비 안내로 유지한다. 콘텐츠 주제는 미발행 기획으로 명시하며 실제 준비 성과로 표현하지 않는다.

### 독립 운영 미리보기 계약

`components/content-distribution-preview.tsx`의 named export `ContentDistributionPreview`는 props 없는 로컬 시안이다. client component이며 useId/useState를 사용한다. public home/layout에서는 import하지 않는다. Master가 권한을 서버에서 확인하는 관리자 페이지 본문 안에 배치해야 하며, 이 컴포넌트는 인증·관리자 권한을 제공하지 않는다. h2를 제공하므로 호스트 페이지가 h1/main을 소유한다. design.css는 기존처럼 루트에서 한 번 로드한다. 관리자 PageMain의 컨테이너 안에 넣으면 폭/여백이 겹치므로 별도 main 안에 배치하거나 통합 시 컨테이너 계약을 조정한다.

제목·본문은 메모리 state이고 저장되지 않는다. 채널은 native radio group(블로그/Threads/Instagram)으로 고르며, 제목과 본문의 순서를 달리하는 예시만 제공한다. 실제 플랫폼 UI/문자 제한/미디어 필수 여부/분할 게시/서비스 종류를 확정하지 않는다. 미디어 업로드·계정 입력·URL/UTM 생성·게시 버튼은 없다.

상태 선택은 업무 상태 변경이 아닌 **샘플 화면 선택**이다. needs_review/scheduled/failed/disconnected를 선택해 설명을 확인하며, scheduled에도 실제 예약 없음, failed에도 실제 게시 시도 없음을 명시한다. 변경 설명은 polite live region, 원문 초기화 결과는 role=status로 안내한다. 원문 초기화는 제목/본문만 되돌리고 채널·샘플 상태는 유지한다. 새로고침/화면 이탈은 모든 로컬 변경을 지운다.

프로그램 수령 후에는 실제 capability와 별도 계약을 맺어야 한다: 원문/채널별 초안 저장·버전/검토 권한, 예약 시각과 Asia/Seoul 표시, UTC 변환, 실패 코드·재시도 가능 여부, unknown 결과 대사, 부분 성공과 외부 게시 식별자/URL, 실제 권리 검토와 미디어 대체텍스트. 로컬 시안의 상태값을 서버 상태로 그대로 신뢰하지 않는다.

MKT-002의 lint/typecheck 및 로컬 브라우저 증거는 docs/qa/MKT-002와 .ai/results/MKT-002-CX-DESIGN-01.md 참조. 자동포스팅 프로그램·인증·실제 게시 연동은 검증하지 않았다.

### MKT-005 공통 배포 로직 연결

이 절은 위 MKT-002 상태 선택 시안 계약을 보완한다. ContentDistributionPreview는 props 없는 독립 client component를 유지하면서 distribution의 ContentItem/ChannelDraft/PublishJob과 createJob/startDispatch/applyResult, DryRunAdapter를 직접 사용한다. 해당 import의 전이 의존성은 순수 TypeScript뿐이며 server-only, 환경변수, Node/DB/API 호출이 없다. 브라우저 메모리 harness에서 실제 모듈 실행도 확인했다. 모의 실행 외 어댑터를 선택하는 UI는 없다.

원문 편집·초기화는 version을 올리고 검토 및 화면 결과를 무효화한다. 채널 변경도 검토와 화면 결과를 무효화하되 원문 version은 바꾸지 않는다. 제목·본문 공백 검증 후 ‘샘플 검토 확인’을 눌러야 현재 버전/채널의 approved ChannelDraft를 메모리에 만든다. 이는 실운영 검토 승인이나 저장 기록이 아니다. ‘모의 실행’은 mode=dry_run, scheduledAt=null로 공통 함수를 순서대로 호출하며 dry_run_succeeded를 ‘모의 실행 완료 · 외부 게시 없음’으로 보여준다.

동일 원문·버전·채널 이력은 화면 메모리 ref에만 유지하며 재실행은 공통 DUPLICATE로 거절한다. 실행 핸들러의 ref 잠금은 같은 순간 중복 클릭을 막고, 실행 중 입력이 바뀌면 이전 generation의 결과를 현재 원문 결과로 덮어쓰지 않는다. 원문 초기화나 새로고침을 실제 외부 작업 취소로 표현하지 않는다. 새로고침 시 로컬 이력도 사라진다.

예전 상태 select는 ‘상태 설명 예시 · 실제 사건 아님’ details 안으로 이동했다. unknown/부분성공도 여기에서만 설명하며 실제 모의 결과를 바꾸지 않는다. capability 표는 공통 unverifiedCapabilities의 미연결/미확인 값과 null 제한을 따른다. 예약 입력·live 호출·외부 식별자·공식 계정/목적 URL·저장소는 제공하지 않는다.

Master 추가 지시 msg_f5905e0ae497 및 Claude MKT-004 완료 확인 후 헤더 ‘이야기 목록’과 홈 ‘이야기 목록 보기’를 /stories로 연결했다. #stories는 홈 기획 주제 영역 이동용으로 유지한다. 목록은 승인 글 미제공의 빈 상태이며 기사 slug나 외부 채널은 창작하지 않는다.

브라우저 검증·결과는 docs/qa/MKT-005와 .ai/results/MKT-005-CX-DESIGN-01.md 참조. 관리자 보호 라우트·서버 승인·영속 이력·공급자 게시/통계/대사 연동은 별도 작업이다.

### UI-MKT-001 사용자 안내

모의 결과의 내부 상태값은 화면에 출력하지 않는다. 성공은 ‘모의 실행 완료 · 외부 게시 없음’과 원문 버전/채널·입력 확인 행동으로 표시한다. 실패 결과는 한글 제목과 안전한 안내로 표현한다.

배포 오류는 코드별 고정 한글 안내와 현재 가능한 행동으로 바꾼다. 미검토/옛 초안은 샘플 검토 재확인, 중복은 기존 요청·표시 결과 확인과 수정한 경우 재검토, 미연결/지원 미확인은 현재 샘플 기능 범위 확인, 대사 필요·근거 부족은 반복 실행 중단을 안내한다. 실제로 없는 결과 대사·예약·로그인 기능으로 이동하라고 약속하지 않는다. 알 수 없는 코드는 일반 안내를 사용하며 오류 원문·공급자 payload·코드를 표시하지 않는다. 이 매핑은 UI 표현용이며 공통 상태 전이를 대체하지 않는다.

`applyResult(started.value, outcome, { attempt: started.value.attempts })`로 시도 번호를 전달한다. 모드는 dry_run으로 고정한다. preserveLateEvidence나 scope summary 등 새 공통 기능은 UI에 운영 기능으로 추가하지 않는다. 설명 예시와 실제 모의 결과는 계속 분리한다.

검증은 docs/qa/UI-MKT-001과 해당 결과 문서를 참조한다. 콘텐츠 v2와 미승인/보류 상태는 이 UI 변경과 별개로 보존한다.
