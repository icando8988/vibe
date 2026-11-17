# DESIGN-MEDIA-RECHECK-031 — D028 수정 독립 재검토

담당 CX-DESIGN-01 / Codex Design. Master 대화 후속배정, 2026-11-17 KST. 상태 ready_review. 이전 Dispatch ID를 재사용하거나 coordinator로 위장 전송하지 않는다.

## 결론

Front029의 핵심 수정은 현재 소스에 반영됐다. **D028-01/04/05는 소스상 해결, D028-02/03은 정상 폼 제출 경로에서는 해결됐으나 예외 안내 경로에 부분 잔존**으로 판정한다. CSS 특정성 충돌도 해결됐다. P1 확정 발견은 없고 P2 안내 보완 2건(R031-01/02)을 남긴다. 정상 폼 제출 수정 전체를 미완료로 되돌리는 판정은 아니다.

신규 결과 파일 한 개만 작성했다. 앱/UI/CSS/시험/공용 안내 기본값/TEAM/점유/기존 결과는 변경하지 않았다. 추가 agent·worker·서버 시작·인증 우회·DB/Storage 쓰기·commit·배포 없음.

## 범위·시점·검증 구분

- 입력: tasks/DESIGN-MEDIA-RECHECK-031.md, results/FE-MEDIA-FIX-029-CC-FRONT-01.md, results/DESIGN-MEDIA-RESUME-028-CX-DESIGN-01.md, 현재 diff와 아래 파일. .ai/docs는 handoff/workspace 아래다. 기존 진입 지침과 이번 TEAM_CURRENT·WORK_OWNERSHIP를 대조했다.
- 경로 D:/VIBE/vibe-github, main, HEAD `8f0691cba968838087c89b52ba708ff4e90ccfda`. 기존 Front/Backend/Master 미커밋 변경을 보존했다. 확인 시점 약 17:30~17:33 KST. 17:31:17에 Front029 결과의 14개 SHA-256과 현재 파일을 대조해 **14개 모두 일치**했다. 아래에 최종 재채집 해시를 남긴다.
- 실제 관리자 세션·접근 URL이 확인되지 않았고 통상 앱 포트 3000/3001/8000/8080의 listen도 없었다. 이번에는 브라우저를 열거나 서버를 새로 시작하지 않았다. 320/700/960px·확대·bounding box·computed style·새 탭 실제 이동·Tab/Space/Enter·화면낭독기·실제 저장 왕복은 미실측이다.
- 테스트/빌드/lint는 독립 재실행하지 않았다. 기존 시험의 추가 구간과 실제 action 연결을 읽었다. **644pass/skip0, lint/build/typecheck 성공은 Front029의 보고 근거**이며 이번 Design의 실행 결과가 아니다. 소스상의 개선 인수와 운영/접근성 실측 인수를 구분한다.

## D028별 판정·근거

| 항목 | 판정 | 현재 파일·심벌/근거 | 남은 조건 |
|---|---|---|---|
| D028-01 전체 비동작 안내 | 해결(소스) | 두 media page의 ConsoleShell에 MediaGateNotice 전달. 잘못된 ID 분기에도 not_loaded 전달. ok/준비 전/거부/조회 오류를 나누고 업로드 비활성·게시 gate 닫힘을 명시 | ConsoleShell 공용 기본 안내는 그대로지만 미디어의 모든 Shell 호출에서 교체됨. 승인 admin 화면 실측 필요 |
| D028-02 충돌·보관 문맥/복구 | 정상 폼 해결, 부분 잔존 | mediaNoticeOverrides → FormFrame → ActionForm.noticeOverrides → WriteNoticeView.overrides가 실제 연결. 충돌/보관/전이불가/없음은 자산 문맥. 합성 media: fields 중복 제거. 새 탭 링크와 입력 복사/새로고침 유실 가능성/자동 재저장 없음 안내 | 페이지 수준 URL notice는 R031-01. 새 탭 왕복·입력 유지·최신 버전 재확인은 미실측 |
| D028-03 필수 규칙 | 정상 필드 오류 해결, 부분 잔존 | RIGHTS_INVALID_BODY는 채널 1개 이상·기한 형식·사유 선택, 사유 label도 선택. ARCHIVE_INVALID_BODY는 확인 체크. 공용 TEXT를 건드리지 않은 선택 override | URL notice는 R031-01. 서버의 사용 중 자산 보관 거절은 R031-02 |
| D028-04 여러 줄 사유 | 해결(소스) | noteFieldError가 C0/DEL/C1·1000 코드포인트 초과를 note 오류로 반환. decideMediaRightsAction은 서비스 호출 전에 검사. textarea hint ID/fieldLabels/markInvalidFields가 note로 연결. 빈 사유 유지, 무단 정제 없음 | SQL `[[:cntrl:]]`와 실제 DB 로캘의 정확한 집합 일치는 미검증. maxLength는 브라우저의 UTF-16 단위여서 보조평면 문자의 허용량과 서버 코드포인트 상한이 다를 수 있음(기존 속성, 이번 신규 차단으로 판정하지 않음) |
| D028-05 원본 저장 안내 | 해결(소스) | 업로드 패널에 비공개 임시 보관·처리 후 삭제 시도·정리 미구현, 상세에 원본 비표시·삭제 시도·정리 공백. “원본 파일 저장 안 함” 단정 제거. 업로드 disabled 유지 | 저장소 실동작·최종 인수와 업로드 활성화는 별도 관문. 실제 삭제를 보증하지 않음 |

권리 처리의 expectedVersion은 제출값을 사용하며 실패 판정에서 변경하지 않는다. 두 쓰기 action의 성공 redirect·상세 revalidate는 제출 assetId가 아닌 서버 반환 out.asset.id다. bad_response/unavailable의 uncertain 안내·수동 refresh·자동 재전송 없음은 유지된다. 처리 완료와 권리 승인은 여전히 별도 축이며 보관 안내가 우선이다.

## P2 잔존·권장 후속

### R031-01 · P2 · 페이지 수준 notice에는 공용 원문/초안 문구 잔존

**조건/근거:** media/page.tsx:32와 media/[assetId]/page.tsx:49는 여전히 `<WriteNoticeView notice={sp.notice} />`를 overrides 없이 렌더한다. parseWriteNotice는 conflict_version/archived/invalid 등 공용 허용 코드를 그대로 수락한다. 승인 admin이 `/admin/distribution/media?notice=conflict_version` 또는 유효한 상세 ID 뒤 `?notice=archived`/`?notice=invalid`로 들어가면 공용 TEXT의 “원문이 이미 새 버전”, “보관된 원문·초안”, “반려·철회는 사유 필요”가 렌더되는 소스 경로다. 실제 브라우저 재현은 하지 않았다.

**영향/범위:** 현재 action의 성공 redirect는 saved만 전달하고 실패는 FormState로 돌려주므로 **정상 제출 경로에서는 이 문제가 재발하지 않는다**. URL 직접 입력/보존·공유된 쿼리 등 예외 경로의 문맥 잔존이다. 권한 우회나 잘못된 DB 저장으로 확대 해석하지 않는다. 현재 Front029 시험은 override를 직접 전달한 렌더와 공용 기본값 보존을 검사하므로 이 페이지 연결 누락까지 덮지 않는다.

**권장 후속/수락:** 미디어 페이지의 쿼리 안내는 실제 사용하는 코드만 제한하거나 페이지 문맥용 override를 제공한다. 목록에 유효 자산이 없을 때 임의 자산 링크를 만들지 않는다. 공용 TEXT 기본값은 유지한다. 목록/상세의 notice 쿼리별 렌더에서 원문/초안/체크리스트 필수 문구가 다시 나타나지 않는지 확인한다.

### R031-02 · P2 · 사용 중 자산 보관 거절에 체크 안내가 함께 나옴

**조건/근거:** 사용자가 confirmArchive를 체크해 제출했지만 서버가 ASSET_REFERENCED를 반환하는 경우다. mediaFailState는 notice=invalid, fields=[reason:asset_referenced]로 매핑한다. MediaArchiveForm은 모든 invalid에 ARCHIVE_INVALID_BODY(“보관하려면 '되돌릴 수 없음' 확인을 체크해야 합니다”)를 사용한다. 따라서 이미 체크한 사용자에게 체크 요구와 “채널 초안이 쓰는 자산이라 보관할 수 없음”이 함께 출력된다. 시험 media-actions.test.ts의 “사용 중 자산 거부”가 이 상태를 명시하나 복합 렌더 문구는 검사하지 않는다.

**영향/권장 후속:** 실제 거절 사유 자체는 오류 요약에 있어서 완전히 누락된 것은 아니다. 다만 체크 조작으로 해결할 수 있는 오류처럼 읽힐 수 있다. invalid 공통 본문을 “아래 확인할 항목 또는 거절 사유를 확인하세요”로 중립화하거나 field/사유별 안내를 분리한다. 체크 누락에는 확인 체크, ASSET_REFERENCED에는 현재 초안 참조 때문에 거절됐다는 안내를 우선한다. 참조 강제 해제나 보관 우회 기능은 추가하지 않는다.

## CSS·새 탭·접근성 연결 확인

- `.mediaForm fieldset.choiceGroup.choiceGroup`의 특정성은 (0,3,1), 공용 `.dc-console .ds-editor-fields fieldset`은 (0,2,1)이다. 같은 중요도·레이어의 현재 규칙에서는 CSS 순서에 의존하던 문제를 해소한다. legend 규칙도 같은 반복 클래스를 쓴다. 브라우저 computed style의 최종 flex/44px label/체크 크기는 미실측이다.
- 최신 상태 링크는 고정 내부 상세 경로, `target=_blank`, `rel=noopener noreferrer`, 보이는 이름에 “새 탭”이 있다. `ds-text-link`의 최소44px·공용 focus-visible 규칙이 적용되는 소스다. 현재 입력을 둔 채 최신 상태를 확인하는 의도가 명확하다. 새 탭에서 실제 조회 실패/보관/권한 변경/최근100건 밖 상태를 확인한 뒤 원래 탭으로 돌아오는 사용성은 승인 세션에서 검증해야 한다.
- 오류 notice는 StatusNotice의 role=status, 필드 요약은 role=alert다. note의 명시 label/htmlFor, `aria-describedby=...note-hint`, 요약 ID 및 markInvalidControls의 기존 hint ID 보존이 연결된다. 오류 반환 후 첫 대상에 focus를 시도한다. conflict는 fields=[]라 강제 입력 초점 없이 notice와 링크를 제공한다. 화면낭독기에서 notice 안 링크와 동적 안내를 찾을 수 있는지, pending 잠금 후 초점이 소실되지 않는지 미실측이다.
- 비활성 폼은 fieldset disabled+사유 ID 연결, 업로드 버튼은 disabled+사유 ID 연결을 유지한다. disabled 버튼이 Tab에 포함되지 않는 점을 고려해 사유 문단을 읽는 동선을 실측한다.
- 320/700/960px 공용 CSS 분기는 변경되지 않았다. 좁은 facts 한 열, 960 이하 모바일 details 메뉴, 콘텐츠 줄바꿈/표 region 초점·가로 이동을 유지한다. 새로 길어진 충돌 본문과 긴 note 오류, 새 탭 링크의 줄바꿈·포커스 외곽선·가로 넘침을 세 폭에서 확인해야 한다.

## Master 반환

Front029의 핵심 수정과 CSS 보완은 소스 기준 인수할 수 있다. D028-02/03의 전체 경로 해결 표시는 R031-01/02를 감안해 부분으로 남긴다. 두 P2를 후속 문구/페이지 연결 보완으로 처리할지 Master가 조정하고 승인 admin 실측 관문을 유지한다. 이번 산출물은 운영 정상·전체 접근성 통과·실제 업로드 가능 판정이 아니다. 지정대로 이 대화로 반환하며 Orca worker_done/--from 재시도는 하지 않는다.

## 기준 파일·심벌·SHA-256

아래 표는 실제 읽은 파일의 최종 채집 값이다. 소스는 병행 작업 트리이므로 이후 변경은 새 해시로 대조해야 한다.

최종 해시 채집: 2026-11-17T17:33:16.8943151+09:00

| 파일 | 읽은 심벌/구간 | SHA-256 |
|---|---|---|
| src/app/admin/distribution/media/actions.ts | decideMediaRightsAction / archiveMediaAssetAction | 1685AD43A8253418A4B41A09F00B67603CFDA48E137198E9B2FE57F689DA96BD |
| src/app/admin/distribution/media/action-state.ts | mediaFailState / noteFieldError / kstToIso | A571A0EBF796648D466DD1BFF963FFE19534D1EF1356E10D8E3DB2C593AC23BD |
| src/app/admin/distribution/media/load.ts | loadMediaList | 670E8285E597933E3079990594F9A55549A070C16EB0F08BD06F80E153539D8B |
| src/app/admin/distribution/media/page.tsx | MediaPage / gateNotice / query notice | B7863589B1CBEBFE809623D02D342F028C7CA134300B42C15319BB61B2D1BC31 |
| src/app/admin/distribution/media/[assetId]/page.tsx | MediaAssetPage / invalid ID / gateNotice / query notice | FD943CD741CB5CAC4E086B86F2068E1EE587579E378F694246E103A0355F39CC |
| src/components/distribution-console/media-forms.tsx | mediaNoticeOverrides / FormFrame / MediaGateNotice / MediaRightsForm / MediaArchiveForm / MediaUploadPanel | 9FA26F5C48828A1F1E6A7F7389C5821004ACAF240210E228753251A0EB89E3EF |
| src/components/distribution-console/media-asset-detail.tsx | MediaAssetFacts / usageNote | DF8B9CA1A1821790F24EE18B03A1E0872A1F8E6BDAEE8DA384CDC8FE16A79A28 |
| src/components/distribution-console/media-asset-list.tsx | MediaAssetList | CED6EEC4DFD7BD9CC5E8A327700D1736198689689ACD6C72EDA16C60453FD310 |
| src/components/distribution-console/media-labels.ts | MEDIA_REASON_FIELD_LABELS | 36269A0148F2B30B18AB0423B8FAC9D6E5BDFD392C6BA8C441E66B8155DC75CD |
| src/components/distribution-console/media.module.css | choiceGroup / choice / mediaForm | E8BD7854D243D66D988C392874877DD4DFA30DBF69B6E3A195B9B7BE41265629 |
| src/components/distribution-console/action-form.tsx | ActionForm / markInvalidControls | 3C652FE5480C0D8EB8724DB7BCB8D7D601F8045229817FB3A915F8E2712A42B5 |
| src/components/distribution-console/write-notice-view.tsx | TEXT / WriteNoticeOverrides / WriteNoticeView | 0221B8A75AE43AA29E9F33E7AAED0FF8ED8E50C398CD48AB0653F4DEA5A422F2 |
| src/components/distribution-console/console-shell.tsx | ConsoleShell gateNotice fallback | 21CE1274C2570782F169D822CDEAA7013222009E62E3679C05C6DA44BB32FC7A |
| src/components/status-notice.tsx | StatusNotice role | 3B7F661A5D1DF97AB34DBF43DE0A85D7C28E4E96E894F8A000878985039AA50C |
| src/server/distribution/write-notice.ts | parseWriteNotice / code mapping | 1AAF0C09166B27BD1D78EF93D8E28915D007DB0173FFBF9D9D340D2AEC8C61EF |
| src/styles/design.css | focus-visible / ds-text-link / inputs | F7913EB445AB97B8A8C71291105C0158CBB970E62FB3BF4BE4CDA302802E61E3 |
| src/app/globals.css | fieldset / 700px / 960px | 152D079E161C5137B8575071152A7C4D761528C15C911F03B84E3D576525B23A |
| supabase/migrations/20261116120000_distribution_media_assets.sql | note constraints / distribution_decide_media_rights | D02FDEC9A0764C6B636463EAB9299BA44CD8127EA03E060626EC965040DC2F99 |
| tests/distribution-front/media-ui.test.ts | D028 SSR / field DOM helpers / CSS assertions, read only | E0502D8215908830851D7CEEAAB14C68489C13B389BA559E075376748A78C965 |
| tests/distribution-front/media-actions.test.ts | actual actions with mocked service / ASSET_REFERENCED / note cases, read only | 15C2CC99B49DE5DA5EA4D835C48154F2D4B529C2B3372A31950B898EDC3483E2 |
| handoff/workspace/docs/contracts/MEDIA_UPLOAD_CONTRACT.md | temporary intake / deletion / readiness | 107898CA1A8A32E04B360E52FF6A45CE6FA260A7D8C5B0680EC4615FCE76A30A |
| handoff/workspace/.ai/results/FE-MEDIA-FIX-029-CC-FRONT-01.md | Front029 reported validation / hash table | 6936A6143EDEB8196B4FDC299EF16116C8C2CBFD6E479C3CC5CA85F4FAD2AD3A |
| handoff/workspace/.ai/results/DESIGN-MEDIA-RESUME-028-CX-DESIGN-01.md | D028 original conditions | 389FF316CEA3667492C01980EC9D326D0ED4DCD61F4A2BC7E7B4A278C96F5EF7 |
