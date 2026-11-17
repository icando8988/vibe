# AUTOPOST-FULL-UI-VISUAL-004 — 로컬 HTML 시각 검토 결과

- 담당 AG-UI-01 / Codex Design(배정 작업자), Master CX-MASTER-01.
- Task `task_4ad76c2dd839` / dispatch `ctx_e3590122a6ed` / terminal `term_27d47b2ae8bd60ddd33fc7b30d13c5c9`.
- 날짜 2026-11-17 (Asia/Seoul). 상태 **ready_review**. 추가 위임 없음.
- 목표: 지정 로컬 HTML을 1180/960/700/320 CSS px에서 렌더 검토하고 앵커·details·키보드 포커스·넘침 및 비활성을 확인, 시각 결함만 수정.

## 사용 지침과 접근 범위

`orca-cli/SKILL.md`, `ego-browser/SKILL.md`, `orca skills get orca-cli`의 버전 일치 가이드와 `references/browser.md`, 프로젝트 AGENTS 진입 지침을 확인했다. 이번에는 명시된 Orca 프로젝트 내장 브라우저를 사용했다. 작업 기준은 같은 세션에서 작성한 전체 기능 UI 계약/HTML이며 새 계정·외부 자료는 열지 않았다.

`orca tab create`로 **file:///D:/Vibe/docs/AUTOPOST_FULL_FEATURE_WIREFRAME.html**을 직접 열 수 있었다. 임시 정적 서버/프로젝트 서버·loopback 서버를 만들 필요가 없었으며 종료할 서버도 없다. D:/Vibe를 서버 루트로 노출하지 않았다. 검토 탭의 page ID는 `9d202602-54ab-4437-808c-30b6ea8b2baf`다. 이 탭만 명시적으로 대상으로 사용했고 다른 탭·계정은 열람하지 않았다.

도구는 Orca viewport/snapshot/click/eval/keypress/screenshot/reload, 로컬 파일 읽기/쓰기와 PNG 확인만 사용했다. eval은 해당 정적 문서의 DOM/레이아웃/포커스·스크롤 상태 확인과 화면 위치 이동에 한정했다. 외부 사이트·로그인·실계정·DB·키/env·원본 프로그램·API·모델·배포·commit 작업은 하지 않았다. 브라우저 실행 허용을 앱/외부 네트워크 검증으로 확장하지 않았다.

## 발견 및 수정

**V004-01 / 좁은 화면 기능 지도 표 가독성 / P2 — 수정 후 재확인**

- 위치: `docs/AUTOPOST_FULL_FEATURE_WIREFRAME.html`의 `.fw-table`, `.fw-table-wrap`, 기능 지도 details.
- 관찰: 320px에서 페이지 전체 넘침은 없었지만 3열 표가 231px 안으로 압축되어 ‘수집원·이력’ 등 링크와 단어가 여러 줄로 잘게 끊어졌다. 수정 전 증거: `docs/design-evidence/autopost-full-ui/320-table-before.png`.
- 수정: 표 min-width 560px, 기존 wrapper의 overflow-x:auto 유지. wrapper에 tabindex=0·region 이름·설명 연결을 추가하고 좁은 화면 좌우 스크롤/방향키 안내를 제공했다. tabindex=0의 focus-visible에도 기존 3px 링을 적용했다. 표의 열 의미/헤더·원본 기능 목록은 유지했다.
- 재확인: 320px wrapper clientWidth 231 / scrollWidth 560, 문서 clientWidth와 scrollWidth는 모두 305. 문서 전체는 옆으로 밀리지 않고 표 안에서만 스크롤한다. Tab으로 wrapper에 도달 후 ArrowRight가 scrollLeft를 0→40으로 바꿨다. 실제 focus-visible=true, computed outline은 `rgb(30,64,175) solid 3px`였고 PNG에서도 링을 확인했다.
- 수정 후 증거: `320-table-after.png`, `320-table-after-focus.png`. 후자는 방향키로 오른쪽 이동한 상태라 왼쪽 일부가 스크롤 영역 밖인 것이 의도된 결과다.

그 밖에 검토한 메뉴·Blog/Instagram 편집 구획·긴 안내·폼에서 가로 잘림/겹침으로 확정할 추가 시각 결함은 발견하지 않았다. 320px에서는 제목과 긴 경로가 여러 줄로 줄바꿈되며 비활성 select/placeholder 일부는 제어 내에서 생략될 수 있으나 필드 label·외부 준비 전 사유는 별도로 읽을 수 있다. 실제 사용 가능한 입력/옵션 UX 통과 판정은 아니다.

## 폭별 실제 렌더/DOM 결과

모든 폭은 viewport 높이 900px, scale 1, desktop Chromium 엔진의 viewport 변경이다. 터치 기기/모바일 OS 에뮬레이터 시험은 아니다. Windows 세로 스크롤바 15px 때문에 clientWidth가 요청 폭보다 작다.

| 요청 폭 | document clientWidth / scrollWidth | 메뉴 | Blog 편집 열 | 채널 링크 | 기능 지도 wrapper client / scroll |
|---|---|---|---|---|---|
| 1180 | 1165 / 1165 | desktop 표시, mobile 숨김 | 약 416.7px + 416.7px | flex 가로 | 817 / 817 |
| 960 | 945 / 945 | desktop 숨김, details 표시 | 약 434.7px + 434.7px | flex 가로 | 853 / 853 |
| 700 | 685 / 685 | details 표시 | 649px 한 열 | grid 한 열 | 611 / 611 |
| 320 | 305 / 305 | details 표시 | 269px 한 열 | grid 한 열 | 231 / 560, 내부 스크롤 |

측정은 표를 펼친 최종 HTML에서 반복했다. 각 폭에서 전체 행위 버튼은 **44개, 활성 버튼 0개**였으며 활성 input/select/textarea도 **0개**였다. 단계 S0~S4·준비 전 배지와 기능/지원 범위 문구는 수정하지 않았다. 최종 DOM main 1개/h1 1개, 내부 앵커 미존재 대상 0개를 확인했다. 본문 링크 타깃에서 렌더 높이 44px 미만인 항목은 점검 시 0개였다(닫힌 details의 숨김 링크는 제외).

## 앵커·details·키보드 실제 확인

- 960px에서 모바일 메뉴 summary에 초점을 두고 **Enter**로 열림(false→true), **Tab**으로 첫 ‘통합 개요’ 링크 이동을 확인했다. 최종 screenshot 이후 computed focus-visible=true·3px solid 파랑 outline을 확인했다. `960-menu-focus.png`에 실제 링이 보인다.
- 모바일 메뉴의 ‘Blog 편집’ 링크를 Orca click으로 활성화한 결과 hash `#blog`, 대상 상단 약 44.85px로 이동했다.
- 320px에서 Blog 채널 링크 중 Threads에 초점을 둔 뒤 **Enter**로 hash `#threads`, 대상 상단 약 45.03px 이동을 확인했다. 700px/320px 채널 링크는 세로 배열이다.
- 본문 바로가기 링크에 초점 후 **Enter**로 hash `#main-content`, 실제 activeElement=main-content로 이동했다. 스크린리더 낭독을 확인했다는 뜻은 아니다.
- 기능 지도 summary에서 **Enter**로 details가 펼쳐지고 표가 렌더되는 것을 확인했다. 수정 후 **Tab**으로 스크롤 region 도달→**ArrowRight**로 내부 스크롤을 확인했다.
- 전체 내부 링크의 대상 존재는 브라우저 DOM에서 확인했지만 101개 링크 각각을 실제 클릭한 것은 아니다. 전체 Tab 순서/모든 details/모든 필드에 대한 완전한 키보드 감사는 하지 않았다.

Orca CLI ref를 PowerShell에 전달할 때 따옴표 없는 `@e215`가 인자로 전달되지 않아 click 1회가 시작 전 거절됐다. `--element '@e253'`처럼 인용 후 성공했다. eval 1회도 쉘의 중첩 인용 때문에 구문 오류가 났고 JS 문자열 인용을 바로잡아 다시 실행했다. 초기 프로그램적 focus 직후에는 :focus-visible이 false였으므로 그 순간을 통과로 세지 않았고 실제 keypress/화면 캡처 뒤 상태로 확인했다. 실패한 시도를 성공 근거에 포함하지 않았다.

## 스크린샷 증거 15개

모두 `docs/design-evidence/autopost-full-ui/` 아래에 보존했다. 원본 자산·실계정·외부 화면은 없다.

| 파일 | 범위 |
|---|---|
| `1180-overview.png` | desktop 전체 메뉴/콘솔 제목/준비 전 안내 |
| `1180-blog.png` | Blog 채널 링크·2열 편집/미리보기 |
| `1180-instagram.png` | Instagram 캡션·구성·슬라이드 구획 |
| `960-overview.png` | 960px 헤더 재배치/단일 본문 |
| `960-menu-focus.png` | 열린 접이 메뉴와 Tab 이동한 링크 focus 링 |
| `960-blog.png` | 가로 채널 탐색/2열 편집 |
| `700-overview.png` | 700px 개요·긴 안내 |
| `700-blog.png` | 한 열 편집/세로 채널 링크 |
| `320-overview.png` | 좁은 화면 헤더/긴 문장·제목 줄바꿈 |
| `320-blog.png` | 좁은 채널 링크·Blog 편집 |
| `320-instagram.png` | 좁은 Instagram 제목/경로/필드 |
| `320-schedule.png` | 예약 폼·datetime-local·시간대 필드 |
| `320-table-before.png` | 수정 전 표 단어 과다 줄바꿈 |
| `320-table-after.png` | 수정 후 스크롤 안내와 표 |
| `320-table-after-focus.png` | 수정 후 표 region focus 링·방향키 스크롤 |

스크린샷은 viewport 캡처이며 전체 장문 페이지의 모든 픽셀을 검토한 결과가 아니다. 특정 구획의 시각 확인과 전체 DOM 폭/배치 측정을 결합했다. 최종 네 폭 캡처를 다시 수행했고 잘못된 위치로 찍혔던 초기 `1180-blog.png`는 올바른 Blog 구획 캡처로 교체했다.

## 수정 범위·남은 한계

수정: 대상 HTML의 표 최소 폭·스크롤 포커스/안내, 위 PNG 15개, 본 결과 파일뿐이다. 기존 HTML 문서의 ‘정적 검토의 한계’ 안내는 최초 작성 시점의 보수적인 고지로 남겨 두었으며 이번 실측의 범위는 본 결과 파일이 추가한다. web 앱/DQ 구현 파일은 수정하지 않았다. 임시 서버는 만들지 않아 정리 대상 없음, 기존 프로세스/다른 브라우저 탭도 종료하지 않았다.

**미측정:** 실제 스크린리더·200% 확대·고대비/forced-colors·색 대비 수치·실제 터치 기기·다른 브라우저·전체 키보드 순회·네트워크 요청 추적. 기능적 저장·계정·DB·모델·확장·API·예약/게시 실행도 확인하지 않았다. 따라서 접근성 전체 통과나 앱/플랫폼 정상으로 보고하지 않는다. 실제 앱은 Claude가 단계별 구현하고 별도 통합 검증해야 한다.

Master 검토용 로컬 HTML 렌더 확인과 시각 결함 1건 수정은 완료했다. 남은 일은 결과/시안 수락, 실제 앱 이식과 기능별 readiness, 위 미측정 항목의 별도 검증이다.
