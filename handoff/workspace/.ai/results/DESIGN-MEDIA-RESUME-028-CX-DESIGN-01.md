# DESIGN-MEDIA-RESUME-028 — 미디어 독립 UX·접근성 검토

담당 CX-DESIGN-01 / Codex Design. Master CX-MASTER-01. 작업 task_b9c1688a332e / dispatch ctx_61806e606bb1. 2026-11-17 Asia/Seoul. 결과 상태 ready_review.

## 판정·범위

P1 확정 발견 0건, P2 수정 권고 4건, 업로드 활성화 전 문구 정합성 권고 1건이다. 이는 소스에서 확인한 조건과 예상 사용자 영향이며 실제 관리자 화면·운영 장애 재현이나 접근성 통과 판정이 아니다. 기존 M025-01~05는 모두 보완 구현이 있다. M025-01/04/05의 실제 스타일·키보드·화면낭독기 동작은 아직 인수할 수 없다.

원문 중심 A안의 메뉴·콘텐츠 구조, 처리/권리 별도 축, 업로드 비활성 정책을 유지하는 검토다. 앱/UI/CSS/시험/TEAM/점유/공통 이력은 수정하지 않았다. 수정 파일은 이 결과 한 개뿐이며 commit·배포·외부게시·DB/Storage 쓰기·인증 우회·가짜 성공은 수행하지 않았다.

읽은 지침: 루트 AGENTS.md·PROJECT_HANDOFF.md, handoff/workspace/AGENTS.md·AI_TEAM_RULES.md, .ai/PROJECT.md·TEAM.md·TEAM_CURRENT.md·WORK_OWNERSHIP.md·TRANSPORT.md·roles/CODEX_SUB_UI.md·history/WORK_HISTORY.md, docs/MASTER_EXECUTION_PLAN_20261117.md, results/RESUME-20261117-MASTER.md·UI-MEDIA-025-CX-DESIGN-01.md, tasks/DESIGN-MEDIA-RESUME-028.md. .ai/docs는 handoff/workspace 아래다. 과거 D:/Vibe/web 및 terminal 기록보다 현재 배정을 우선했다.

## 시점·충돌·검증 한계

- 작업 경로 D:/VIBE/vibe-github, branch main, HEAD `8f0691cba968838087c89b52ba708ff4e90ccfda`. 시작 당시 Master의 문서 변경/미추적 작업 문서가 있었으며 보존했다.
- 약 17:09~17:15 KST 소스를 읽었다. 17:13:42 KST 1차 SHA-256 채집 이후 Front 병행 변경을 확인했다. loadMediaList의 오류 kind 분리, 목록 안내, media 문맥 보충, CSS 중복 선언 제거를 반영해 재검토했다. 17:14~17:15에는 actions.ts의 순수 판정이 새 action-state.ts로 이동하여 해당 파일도 읽었다. actions.ts 1차 해시 `A3767A3A161F90234435E5EC079AC66A4FEE8A931DA01E6E37A37B11C45788DB`는 폐기하고 아래 재확인 기준을 사용한다. 전체 작업 트리가 동결된 스냅샷이라는 뜻은 아니다.
- 17:17:52 해시 채집 때 Backend의 MEDIA_UPLOAD_CONTRACT 갱신과 Front 시험 추가를 확인하고 해당 diff/추가 구간을 읽었다. 업로드 계약은 최초 열람의 “잠정”에서 “로컬 기준 확정, 실제 Storage 미검증, Master 인수 전 활성화 보류”로 바뀌었다. D028-05의 원본 임시 보관·삭제 실패·고아 정리 미구현 근거는 갱신본에서도 유지된다. 아래 계약 해시는 이 갱신본이며 최초 해시 `89A4665E937269875A4F9D77C1020BC25785BE0BBAA918577E8EAEF11F10836F`와 구분한다.
- `Get-NetTCPConnection -State Listen`으로 기존 실행과 포트를 확인했다. 통상 앱 포트 3000/3001/8080/8000의 실행은 없었고, 승인 admin 접근 URL·세션은 제공/확인되지 않았다. 다른 담당 프로세스를 중단하거나 서버를 새로 시작하지 않았다.
- ego-browser 스킬 및 `ego-browser skill`의 끝 표시까지 읽고 실제 task space 2 연결을 확인한 뒤 빈 탭을 종료했다. 앱 URL 탐색/관리자 인증/실제 미디어 화면 관찰은 하지 않았다. 따라서 브라우저 연결 확인을 UI 실측으로 세지 않는다. 기존 프로필/쿠키는 조사하지 않았다.
- 320/700/960px는 아래 CSS 분기와 DOM 동선만 검토했다. bounding box·가로 넘침·명암 대비·확대·Tab/Enter/Space/방향키·포커스 이동·화면낭독기 실측 모두 미실시다. 테스트·빌드·lint는 실행하지 않았다. 기존 시험 파일을 읽었지만 Master의 622개 통과 기록을 이번 검토의 실행 결과로 재사용하지 않는다.

## P1/P2 · 재현 조건·근거 · 권장 수정 · Front 인계

### D028-01 · P2 · 동작하는 metadata 화면 위에 전체 비동작 안내

**재현 조건/근거:** media/page.tsx와 media/[assetId]/page.tsx의 ConsoleShell에 gateNotice가 없다. console-shell.tsx:134 이하 기본 안내는 “입력·버튼은 동작하지 않으며, 표시되는 상태는 실제 작업 결과가 아닙니다”라고 한다. 반면 상세는 listAssets 조회 성공 자산에 실제 decideMediaRightsAction/archiveMediaAssetAction을 연결하고 disabledReason=null로 폼을 켠다. 목록도 실제 조회 결과만 렌더한다. 미디어 연결 완료 여부와 실제 게시 gate가 섞여 사용자가 실제 권리/보관 변경을 연습 화면으로 오해할 수 있다. 소스 조건 확인이며 실제 변경 실행은 하지 않았다.

**권장 수정:** 공용 Shell 기본값 변경 없이 두 미디어 페이지의 기존 gateNotice prop으로 “미디어 조회·권리 결정·보관은 서버에 저장됩니다. 이미지 업로드는 계약 검토 중이며 실제 게시는 닫혀 있습니다”처럼 현재 기능별 상태를 설명한다. 조회 준비 전/실패에는 그 결과에 맞는 설명을 사용하고 저장 성공을 미리 약속하지 않는다.

**Front 인계/수락:** 두 페이지에서 준비 전/조회 오류/ok0/ok목록/활성 상세를 대조한다. 실제 metadata 폼 위에 “입력·버튼 비동작/실제 결과 아님”이 나오지 않고, 실제 게시 gate와 업로드 비활성은 유지한다. 공용 Shell은 이번 권고만으로 수정 권한을 확대하지 않는다.

### D028-02 · P2 · 충돌·보관 오류에 원문/초안 문맥과 복구 동선 잔존

**재현 조건/근거:** action-state.mediaFailState는 conflict_version/archived를 각각 공용 notice로 유지하고 `media:<code>` 설명을 fields에 추가한다. Front의 이번 보충으로 자산이 바뀌었다는 설명과 입력 보존 안내는 개선됐다. 그러나 ActionForm은 WriteNoticeView를 먼저 렌더하므로 “원문이 이미 새 버전”, “보관된 원문·초안”도 동시에 나온다(write-notice-view.tsx:18/27). 최신 상태 다시 불러오기 버튼은 ActionForm의 uncertain 분기에만 있다. 충돌에서는 복사 후 새로 불러오라는 글과 기존 제출 버튼이 남아 낡은 expectedVersion으로 다시 제출할 수 있다. 자동 버전 갱신/자동 재전송이 없다는 점은 올바르다.

**권장 수정:** 미디어에 한해 자산 문맥의 notice 제목/본문을 제공하고 공용 문장과 중복되지 않도록 한다. 공용 ActionForm에 선택 prop이 필요하면 Master와 범위를 조정한다. 충돌 시 입력 보존 범위와 새로고침 때 유실 가능성을 밝히고, 입력을 복사한 뒤 최신 상태를 확인하는 명시적 동선을 제공한다. expectedVersion을 조용히 최신 값으로 바꾸거나 자동 재제출하지 않는다.

**Front 인계/수락:** 낡은 버전 권리/보관 제출과 다른 화면에서 먼저 보관된 경우를 별도 검증한다. 안내 대상이 자산으로 일치하고, 입력은 실패 직후 유지되며, 최신 상태 확인 후 사용자가 다시 결정할 수 있어야 한다. 이번 문맥 보충은 부분 해소로 기록하고 회귀로 오인하지 않는다.

### D028-03 · P2 · 미디어 invalid 안내가 실제 필수 규칙과 불일치

**재현 조건/근거:** ready 미승인 자산에서 승인 선택 후 허용 채널을 하나도 선택하지 않으면 service.decideRights가 invalid/allowedChannels를 반환한다. FormFrame은 채널 그룹을 오류 표시하고 첫 체크박스로 초점을 보내도록 구성돼 있다. 동시에 공용 WriteNoticeView.invalid는 “승인은 모든 확인 항목이, 반려·철회는 사유가 필요”하다고 안내한다. 실제 미디어 폼은 사유를 “권장”으로 표시하고 required가 없으며 service와 120000 SQL도 빈 사유를 null로 허용한다. 미디어에는 승인 체크리스트도 없다. 오류 발생 자체보다 어떤 항목이 필수인지 오해하게 하는 문구 문제다.

**권장 수정:** 미디어의 invalid 문구를 “표시된 항목을 확인하세요. 권리 승인에는 허용 채널 1개 이상이 필요합니다”처럼 실제 규칙으로 제한한다. 반려/철회 사유 필수화는 별도 정책 변경으로 취급하며 이번 디자인 권고로 강제하지 않는다.

**Front 인계/수락:** 채널 0개 오류, 잘못된 유효기한, 보관 확인 누락에서 미디어 규칙에 맞는 안내를 확인한다. 반려/철회 사유의 optional 표기와 오류 문구가 일치해야 한다. 기존 markInvalidControls의 hint ID 보존과 첫 대상 초점은 유지한다.

### D028-04 · P2 · 여러 줄 사유 입력이 DB에서 거절되지만 고칠 항목 안내 없음

**재현 조건/근거:** media-forms.tsx:97~98은 rows=3 textarea와 최대 1000자 안내를 제공한다. 여기에 `첫 줄` + 줄바꿈 + `둘째 줄`을 입력하는 조건이다. service.decideRights는 note를 그대로 RPC에 전달한다. 120000 SQL distribution_decide_media_rights:376 및 이력 테이블 note CHECK는 `[[:cntrl:]]`를 금지하므로 줄바꿈을 거절한다. SQLSTATE 22023은 errors.ts에서 invalid_input, action-state에서는 일반 invalid notice이며 note field가 지정되지 않는다. 따라서 aria-invalid/초점 연결 보완이 이 경우에는 작동하지 않고 사용자는 1000자 이내의 정상적인 여러 줄 입력이 왜 거절됐는지 알 수 없다. DB 실행 재현은 하지 않았으며 소스 계약상 조건이다.

**권장 수정:** Front 액션에서 계약상 허용하지 않는 제어 문자를 검출하고 note 필드 오류와 “줄바꿈 없이 입력” 등 구체적 수정 안내를 제공한다. 정책을 바꾸려면 Backend/Master가 명시적으로 결정한다. 사용자 입력의 줄바꿈을 알림 없이 제거하거나 SQL 제약을 약화하지 않는다.

**Front 인계/수락:** 한 줄 정상 입력/두 줄 입력/1000자 경계/복사한 탭 입력을 대조해 어떤 문자를 고쳐야 하는지 알 수 있고 입력이 남는지 확인한다. note로 초점과 오류 설명이 연결돼야 한다. 서버 거절 원문이나 내부 코드는 표시하지 않는다.

### D028-05 · P2, 활성화 전 · “원본 저장 안 함”을 임시 보관 계약과 정렬

**재현 조건/근거:** MediaUploadPanel과 MediaAssetFacts는 “원본 파일은 저장하지 않습니다/저장하지 않음”을 단정한다. 현재 업로드는 비활성이라 이번 화면에서 원본이 전송되는 경로는 없다. 다만 읽은 잠정 MEDIA_UPLOAD_CONTRACT §1/2/5는 원본 private intake 임시 보관, 처리 후 삭제 시도, 삭제 실패·만료·취소 후 고아 가능 및 sweep 미구현을 명시한다. 향후 직접 업로드를 활성화하면 두 설명이 충돌한다. 보안 사고나 실제 잔존 파일 발견으로 보고하지 않는다.

**권장 수정:** 최종 계약 인수 뒤 활성화 전에 “원본은 비공개 저장소에 임시 보관해 처리한 뒤 삭제를 시도합니다” 등 실제 수명에 맞춰 안내한다. 정리 미구현을 숨기는 즉시/완전 삭제 보장은 하지 않는다. 비활성 사유도 “구현 없음”보다 “최종 계약 인수·연결 검증 전”으로 정렬할 수 있다.

**Front 인계/수락:** 업로드 비활성 유지. Backend 최종 반환과 Master 인수 후 원본 안내/임시 보관/삭제 한계를 대조한다. directUpload=true나 저장소 설정 존재를 실제 Storage 검증으로 설명하지 않는다.

## 기존 M025 대조

| 기존 항목 | 현재 소스 | 판정/남은 검증 |
|---|---|---|
| M025-01 checkbox 스타일 | mediaForm/choice 범위 width·min-height·padding 초기화, 1.15rem 크기, label min-height44px, choiceGroup 배치 | 보완 있음. computed style 미실측. `.mediaForm fieldset.choiceGroup`와 `.dc-console .ds-editor-fields fieldset`은 특정성 (0,2,1)로 같으므로 주석의 “더 높음”을 근거로 flex 확정하지 않는다. 최종 CSS 순서 확인 필요 |
| M025-02 보관 자산 사용 가능 안내 | usageNote는 archivedAt를 먼저 검사하고 새 초안·게시 선택 불가 안내 | 소스상 해소. ready/미승인/만료/승인도 별도 문구 |
| M025-03 미지 실패 코드 | failureText 일반 한글 fallback, 실패 후 새 파일 안내는 “업로드가 준비되면” | 소스상 해소. 원문 코드 노출 없음 |
| M025-04 짧은 ID 링크 | dc-action min-height44px, 전체 UUID aria-label, 표 region/tabIndex0/초점 outline | 보완 있음. 실제 타깃/표 스크롤·동일 접두 ID 구별 실측 필요 |
| M025-05 오류·비활성 연결 | fieldset aria-describedby, 선택 errorSummaryId/markInvalidFields, 기존 hint ID 보존 | 필드 이름이 반환되는 경우 보완 있음. reason/media 합성 이름은 입력에 연결하지 않는 의도이며 경고가 출력된다. DB note 거절은 D028-04 |

## 상태·문구·키보드·모바일 검토표

| 경로/조건 | 소스 확인 | 실측/인수할 항목 |
|---|---|---|
| 관리자 접근 | 두 page 모두 guard 선행, 승인 admin만. 부적합 ID InvalidParam/목록 링크 | 승인 세션과 거부 세션의 직접 URL 이동 미실측 |
| 준비 전 | metadata 설정 신호 후 실제 listAssets, 준비 전은 assets=null. upload 준비로 metadata를 차단하지 않음 | 설정 준비도와 조회 성공을 혼동하지 않는지 실제 화면 확인 |
| 조회 오류/0건 | unavailable/bad_response/db 별도 글, 모두 0건과 구분. ok([])만 조회 성공0건 | 오류 상태에서 사실·권리·보관 폼이 없는지 브라우저 확인 |
| 상세 없음 | 최근100건 안에서 찾지 못하면 없음/타인/100건 밖 가능성 안내, 폼 없음, 목록 복귀 | 100건 밖 자산 직접 조회는 현재 계약의 한계. pagination·임의 조회 확장은 별도 범위 |
| ready/권리/보관 | 독립 열/배지, ready만 승인 선택지, 승인 상태는 철회만, 보관 폼 없음, 승인 유효기한/KST | 승인돼도 게시 직전 채널/처리/변환본/유효기한 서버 재검사 설명 유지 |
| 폼 label·키보드 | radio/checkbox는 암시적 label+legend, textarea/datetime 명시 htmlFor, required 보관 확인, pending fieldset 잠금/aria-busy/status | Tab 순서·라디오 방향키·Space 선택·Enter 제출·대기 후 초점 복원 미실측 |
| 쓰기 uncertain | bad_response/unavailable는 uncertain, 자동 전송 없음, 입력 유지, 수동 refresh 버튼 | refresh 전후 입력·최신 DTO·hidden 버전·포커스·버튼을 실제 왕복 확인. 원문값을 URL/스토리지에 보관하지 않음 |
| 표 | caption/열·행 scope, 스크롤 region 이름/tabIndex0, 상세 링크 전체 ID 접근 이름, 복귀 selected 행 | Tab으로 region 진입 후 방향키 횡스크롤, 포커스 외곽선 잘림, 화면낭독기 표 탐색 미실측 |
| 320px | 공용 frame 폭 calc(100%-1.5rem), panel padding1rem, facts 한 열, 콘텐츠 min-width0/overflow-wrap:anywhere. spec nowrap 제거 | 목록 가로 이동 안에서 상세 링크 접근, 긴 ID/규격/사유/유효기한/오류 줄바꿈, 날짜 입력 intrinsic 폭·버튼 넘침 확인 |
| 700px | max-width700 포함 facts 한 열. 모바일 details 메뉴 활성, sidebar 숨김 | 경계700/701px, 메뉴 열기→미디어→목록→상세→권리→보관→목록 전 과정 키보드 확인 |
| 960px | max-width960 포함 셸 한 열·모바일 details 메뉴, facts는 두 열 | 경계960/961px·고배율에서 메뉴 중복/숨겨진 메뉴 포커스 없음, 표 초점과 가로 이동 확인 |

320/700/960 모두 DOM상 순서는 위치 경로→모바일 메뉴→제목/안내→목록 또는 상세 사실→권리→보관→목록 복귀다. 일반 focus-visible 3px, 표 region 개별 3px 규칙이 있다. outline 선언 존재만으로 대비·가시성·키보드 접근성 통과를 주장하지 않는다. 모바일에서 업로드 패널이 목록보다 먼저 나와 긴 정책 안내를 지나야 한다는 점은 후속 실제 높이 관찰 대상이며 현재 코드만으로 우선순위를 변경하지 않는다.

## Front/Master 반환

Front는 D028-01~04를 현재 점유 내에서 검토하고 공용 ActionForm/notice 변경이 필요하면 Master와 최소 선택 prop 범위를 조정한다. D028-02는 이번 보충이 이미 있는 상태를 기준으로 중복 문구/복구 동선만 다룬다. 먼저 코드 수정 후 승인된 관리자 환경에서 위 상태와 세 폭의 실제 동선을 검증한다. D028-05는 업로드 활성화 관문으로 넘긴다. 기존 M025 5건을 새로 미구현이라고 처리하지 않는다.

Master가 인수할 것: 이 독립 검토 결과와 Front 최종 diff·해시 대조, P2 후속 배정, 관리자 실측 환경 준비 여부 판단. 실측 미실시 자체는 소스 검토 산출물의 실패가 아니며, 실제 DB/Storage/접근성/게시 정상 인수는 남는다. 추가 agent/worker 생성·위임은 없었다.

전달 차단: 지정 --from/task/dispatch로 worker_done 1회 시도했으나 exit1 `consumer_fenced: This terminal is a Run coordinator and cannot report as term_831c9215-98e9-4d07-9ba1-298fc40b30c5; run the command from the worker's own terminal. No effects were applied.` 응답을 받았다. 요청 ID `3ca68ae3-c4aa-4407-8728-dcd46eda3a34`. 완료 접수로 기록하지 않는다. 신원/환경 변수를 바꾸어 우회하거나 worker_done을 중복 전송하지 않고 Master에 전달 차단을 알린다.

## 기준 파일·심벌·SHA-256

아래 표는 최종 재채집 시각을 함께 기록한다. 경로는 저장소 루트 기준이며 hash는 파일 전체 바이트다. 이후 Front/Backend 변경 시 해당 항목만 새 기준으로 재검토해야 한다.

최종 해시 채집: 2026-11-17T17:17:52.6527671+09:00

| 파일 | 읽은 심벌/구간 | SHA-256 |
|---|---|---|
| src/components/distribution-console/media-labels.ts | failureText / rightsDecisionOptions / rightsUsableNow / MEDIA_REASON_FIELD_LABELS | F6C6593858E65BF8615EE57E174AEBE8841DFEDC2539361B34813FCF09EBD5D3 |
| src/components/distribution-console/media-asset-list.tsx | MediaAssetList / MediaListView / LIST_ERROR_TEXT | CED6EEC4DFD7BD9CC5E8A327700D1736198689689ACD6C72EDA16C60453FD310 |
| src/components/distribution-console/media-asset-detail.tsx | MediaAssetFacts / usageNote | 8E85F26BBEB5407D28DFAA74549900CA273C977347F25E0F599463BD9329A4DC |
| src/components/distribution-console/media-forms.tsx | FormFrame / MediaRightsForm / MediaArchiveForm / MediaUploadPanel | 5D1A46DE1BF6934FBB046114664937785983EF28D2EEA596E13B12DB58E554DB |
| src/components/distribution-console/media.module.css | mediaForm / choice / choiceGroup / spec / tableRegion | 8D9887D7F30BF140051A479AC4C8B762ABA2D2FC1FA111B72F22B65E6F69E583 |
| src/components/distribution-console/action-form.tsx | ActionForm / markInvalidControls | C3715A6A98E2F325CC203CE08086E97B7D30480450C2D0742CD9A42185F7AA69 |
| src/components/distribution-console/console-shell.tsx | ConsoleShell / DistributionDenied / NavGroups | 21CE1274C2570782F169D822CDEAA7013222009E62E3679C05C6DA44BB32FC7A |
| src/components/distribution-console/write-notice-view.tsx | WriteNoticeView / TEXT | C38A60116B7980834B9D376880CE0E7C873236C9DF6A18F6DB5C915FAE97F1D8 |
| src/components/distribution-console/guard.tsx | denyUnlessDistributionAdmin | C73452A2F1D5FF0F54D91AE26FDDC5F181B4303FCA7D6BF91B52C7B27C3992EA |
| src/components/distribution-console/access.ts | decideDistributionAccess | B3F5BF68DC25595A21D75FC1452285532DC34DD6428E4272ED2B0F4B6A9F3823 |
| src/components/status-notice.tsx | StatusNotice | 3B7F661A5D1DF97AB34DBF43DE0A85D7C28E4E96E894F8A000878985039AA50C |
| src/app/admin/distribution/media/page.tsx | MediaPage | 2836251130F95A6F501B48FCF04A9B6E7324F79565222905F3CBE9CFD102F624 |
| src/app/admin/distribution/media/[assetId]/page.tsx | MediaAssetPage | 18503DA64A2A299AEFE8BB50C0EC279836B09CC1F9F9E086228EB6304F62928A |
| src/app/admin/distribution/media/load.ts | loadMediaList | 670E8285E597933E3079990594F9A55549A070C16EB0F08BD06F80E153539D8B |
| src/app/admin/distribution/media/actions.ts | decideMediaRightsAction / archiveMediaAssetAction | D3DD247BBD6B1EC8FFC665A49AC28051A3C74F61189263CD2AF1B6C44B0FC1CD |
| src/app/admin/distribution/media/action-state.ts | mediaFailState / kstToIso / intOf | DAF1238DB8DAC9400C868F9A8E07780F067287678981402888A5A79E6AFB0A32 |
| src/app/layout.tsx | RootLayout / CSS import | C5DB95307AC66BF1F9759A516A98ABC433BE3FD317260929F7F6135152D0386F |
| src/app/admin/distribution/layout.tsx | DistributionLayout | 42CE0D72B07F5C63B739766BC0D25E415DE024E4454B5FBAB09CE56F0BC137D6 |
| src/app/globals.css | dc-console / dc-facts / media queries | 152D079E161C5137B8575071152A7C4D761528C15C911F03B84E3D576525B23A |
| src/styles/design.css | ds-editor-fields / focus-visible | F7913EB445AB97B8A8C71291105C0158CBB970E62FB3BF4BE4CDA302802E61E3 |
| src/server/distribution/media/session.ts | getMediaMetadataDeps / mediaReadinessOf | AA9333F91C6A06000D7F25B0FFE03C97ED24C557AA00D30045B2CAB9AD33A14E |
| src/server/distribution/media/service.ts | MediaAssetDto / decideRights / archiveAsset / listAssets | 9BF56B7021A58066758F9BA01CEB3FB2BBFAFA9B4481438D9587FF911C7FCC8E |
| src/server/distribution/write-notice.ts | writeNoticeOf / FormState | 1AAF0C09166B27BD1D78EF93D8E28915D007DB0173FFBF9D9D340D2AEC8C61EF |
| src/server/distribution/errors.ts | mapDistributionDbError / mediaErrorReason | CAE99A96032017C027520EC32EE1B7A065C4D403B1CD5885A81C616740FCFE7D |
| supabase/migrations/20261116120000_distribution_media_assets.sql | distribution_decide_media_rights / rights decisions note CHECK | D02FDEC9A0764C6B636463EAB9299BA44CD8127EA03E060626EC965040DC2F99 |
| tests/distribution-front/media-ui.test.ts | existing M025 SSR / fake DOM assertions, read only | 53C78644B9470535A01B78089D04D35BEEC63BC9EEB58E7E8B0322C9E91598EF |
| handoff/workspace/docs/contracts/MEDIA_FRONT_CONTRACT.md | 0-A / 3 / 4 / 5 / 6 / 8 / 9 | 1A968979C9BADF5FE34A0C8F2C2DA684FF397BD4009AB4180B647F7EDF19E9D1 |
| handoff/workspace/docs/contracts/MEDIA_UPLOAD_CONTRACT.md | 1 / 2 / 4 / 5 / 6 | 107898CA1A8A32E04B360E52FF6A45CE6FA260A7D8C5B0680EC4615FCE76A30A |
