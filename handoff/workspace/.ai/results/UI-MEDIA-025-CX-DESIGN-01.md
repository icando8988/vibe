# UI-MEDIA-025 신규 미디어 UI 읽기 전용 디자인·접근성 검토

Codex design / CX-DESIGN-01 · Master CX-MASTER-01 · 2026-11-17 Asia/Seoul · ready_review.
배정: msg_b47304c453e9 / UI-MEDIA-025. 추가 세션·위임 없음.
허용 변경은 이 결과 파일뿐이다. Front 코드·계약·공용 상태는 수정하지 않았다. 비밀/env·실DB·계정·Storage·API·외부 네트워크·commit 접근/실행 없음.

## 판정과 확인 범위

FE-MEDIA-024 1단계 코드와 MEDIA_FRONT_CONTRACT를 정적으로 대조했다. 서버/브라우저/테스트/빌드/스크린샷은 실행하지 않았다. 아래 항목은 소스에 드러난 분기·스타일 위험이며 운영 장애 재현·WCAG 부적합 판정이 아니다.

기준 계약은 검사 시 §0-A에 BE-MEDIA-024 런타임 진입점이 확정돼 있었지만 Front 두 페이지는 아직 wiring pending 상수와 안내만 제공한다. 이는 Front 후속 연결 대기라는 배정과 일치한다. 계약 확정·코드 존재를 실DB/Storage 검증이나 현재 페이지 연결 완료로 표현하지 않는다.

## 기준 파일·시각·해시

첫 확인 2026-11-17T14:08:52.969~14:08:53.011+09:00. 재확인 14:09:49.290~14:09:49.326+09:00. 아래 8개 SHA-256은 두 번 모두 동일했다. Front가 이후 연결을 수정하면 새 기준에서 재검토해야 한다.

| 파일 | SHA-256 |
|---|---|
| docs/contracts/MEDIA_FRONT_CONTRACT.md | 1A968979C9BADF5FE34A0C8F2C2DA684FF397BD4009AB4180B647F7EDF19E9D1 |
| components/distribution-console/media-labels.ts | E62A4DD342AF8E3118017E49EBD994F13D67C01CA57C56CD52252D4962B3EE10 |
| components/distribution-console/media-asset-list.tsx | 3DDD6770E99DA169064191EDA9194909D5C29A83235E6E296F8D19B23B9D2419 |
| components/distribution-console/media-asset-detail.tsx | 760851118024EC1E9A33E10927E38ADAA5E1F407284F491B025DFC4876142145 |
| components/distribution-console/media-forms.tsx | 10891810F14688950B50A487EA47024D3806C042E3F7686388044419B084ABBD |
| components/distribution-console/media.module.css | EC18A95572FAA78AA59CEDB197E38E4AC57D5CFF07DEE43F3166DAA6E25AA3A1 |
| app/admin/distribution/media/page.tsx | BEA557A6D199FA8F5F640E4B71E8B8C5637712A9A573EADA0A6AC76C8108B92F |
| app/admin/distribution/media/[assetId]/page.tsx | 48CE8B154EC2118EE5FA94CCF1EB2F131DAE1B7779740C3E0B7F9F5F4B3BE4A9 |

components/app의 접두 경로는 web/src/다. 보조 확인: 현재 globals.css/design.css, layout의 CSS import 순서, ActionForm의 오류 출력·fieldset 잠금 선언. 보조 파일도 읽기 전용이다.

## 수정 후보

### M025-01 · P2 · 체크박스가 텍스트 입력 스타일을 계승

- 파일/심벌: media-forms.tsx MediaRightsForm 58~64행 허용 채널 체크박스, MediaArchiveForm 86~88행 확인 체크박스. media.module.css channelList. 보조 근거 design.css:96.
- 정적 조건: FormFrame은 ds-editor-fields로 감싼다. 공용 `.ds-editor-fields input:not([type=radio])`는 checkbox에도 width:100%, min-height:48px, padding/border를 적용한다. 공용 globals의 새 입력 규칙은 checkbox를 제외하므로 이를 되돌리지 않는다. media CSS에도 checkbox 전용 규칙이 없다.
- 영향: 채널 선택·보관 확인의 체크박스가 넓은 텍스트 필드처럼 커지거나 라벨을 밀 가능성. 실제 브라우저 모양·잘림 정도는 미실측.
- 제안: 미디어 범위에서 radio/checkbox의 inline-size/min-block-size/padding/flex-shrink를 명시해 텍스트 입력 규칙과 분리. 체크 자체는 작게 두되 전체 label 타깃 44px 이상. 보관 label도 포함해야 한다.
- 수락: 준비된 로컬 UI fixture에서 320/390/1440 및 확대 시 checkbox가 필드 폭을 차지하지 않고 라벨 클릭·Space 선택·확인 문구 읽기가 가능. 공용 스타일 회귀 없음.

### M025-02 · P2 · 보관 자산에 게시 사용 가능 문구

- 파일/심벌: media-asset-detail.tsx MediaAssetFacts 10~23행.
- 정적 조건: archivedAt가 있고 rightsState=approved·유효기한 미경과인 DTO. usable은 권리 상태/시각만 보므로 true. 보관됨 배지 바로 아래 ‘권리 승인 채널에서만 게시에 쓸 수 있습니다’가 표시된다. 보관은 권리 철회와 별개이며 계약은 보관 자산 첨부/사용을 허용하지 않는다.
- 영향: 보관 안내와 사용 가능 안내가 충돌한다. 서버 검사를 우회해 실제 게시된다는 주장은 아니다.
- 제안: 본문 설명은 archivedAt를 먼저 분기해 ‘보관되어 새 초안·게시용으로 선택할 수 없음’을 우선 안내. 처리·권리 배지는 독립 축으로 유지하고 rightsUsableNow 자체를 종합 게시 준비 판정으로 바꾸지 말 것. 미처리·변형/채널 조건도 게시 직전 서버 판정임을 유지.
- 수락: archived+ready+approved fixture에서 사용 가능 문구 없음. 미보관 ready+미승인/만료/승인 조합은 각 사유를 정확히 설명. 운영 실행 없이 렌더링으로 확인 가능.

### M025-03 · P2 · 알 수 없는 처리 실패 코드 원문 노출

- 파일/심벌: media-labels.ts failureText 49~51행 → media-asset-detail.tsx 49행.
- 정적 조건: FAILURE_TEXT에 없는 비어 있지 않은 code가 `처리 실패 코드 ${code}`로 그대로 출력된다. 계약 DTO의 failureCode는 string|null이며 화면에서 허용 목록 제한이 없다.
- 영향: 내부 코드·불필요한 원문이 일반 안내로 노출된다. React는 텍스트 이스케이프하므로 HTML 실행/XSS라고 판정하지 않는다.
- 제안: 미확인 코드는 일반 한글 처리 실패 안내로 매핑하고 원문 문자열은 표시하지 않음. 뒤의 ‘새로 올리세요’도 업로드 비활성 상태에서는 ‘업로드 준비 후 수정 파일로 진행’처럼 현재 가능한 동선과 맞출 것.
- 수락: 알려진 코드 안내 유지, 미지 코드·긴 문자열에 원문 노출 없음. 현재 비활성 업로드를 즉시 이용할 수 있는 것처럼 안내하지 않음.

### M025-04 · P2 · 목록의 자산 진입 링크 최소 타깃 누락

- 파일/심벌: media-asset-list.tsx 64행.
- 정적 근거: 짧은 ID 링크에 ds-text-link/dc-action 등 44px 규칙이 없다. 셀 padding은 링크 클릭 영역 자체를 확장하지 않는다. 표 caption과 행/열 scope는 구현되어 있다.
- 영향/제안: 작은 자산 진입 링크의 터치·포커스 범위가 좁을 수 있음. 링크에 기존 44px 행동 클래스를 적용하고, 같은 접두 ID를 구별할 수 있도록 전체 ID의 접근 가능한 이름 또는 추가 구분 텍스트를 검토.
- 수락: 링크 bounding box 높이 44px 이상, 긴/같은 접두 ID에서도 선택 대상 구분, Tab/Enter 목록→상세 동작. 실측은 후속.

### M025-05 · P2 · 오류·비활성 사유의 컨트롤 연결 보강

- 파일/심벌: media-forms.tsx FormFrame 16~28행, MediaRightsForm·MediaArchiveForm. 보조 관찰 ActionForm.
- 구현된 것: radio/checkbox 암시적 label, 결정/채널 legend, 유효기한·메모 명시적 htmlFor, 보관 required 확인, 공용 role=alert 오류 요약과 입력 유지.
- 빈틈: FormFrame의 disabledReason 문단은 fieldset/조작에 aria-describedby로 연결되지 않는다. 공용 ActionForm은 fields를 이름으로 요약하지만 현재 미디어 입력에 aria-invalid/오류 설명 ID를 제공하지 않는다. 그룹 오류 발생 시 해당 입력으로 연결되는 경로가 약하다.
- 제안: 미디어 범위의 사유 ID 연결, 필드 오류/요약→입력 연결을 Front와 공용 ActionForm 담당이 조정. 이번 읽기 전용 검토에서 공용 파일 변경 제안은 구현 배정으로 취급하지 않는다.
- 수락: 활성 invalid fixture에서 오류 식별·해당 필드 찾기·입력 유지, disabled fixture에서 사유를 컨트롤/그룹과 함께 읽을 수 있음. 화면낭독기 실측 필요.

## 충족/후속 실측 항목

| 항목 | 정적 확인 | 한계/후속 |
|---|---|---|
| 처리·권리 축 | 별도 열/배지·만료 문구, ready≠권리 승인 설명 | M025-02의 보관 분기 보강 |
| expectedVersion | 두 쓰기 폼 모두 String(asset.rowVersion) hidden 전달 | 서버 액션 재검증·충돌 왕복은 연결 후 별도 검증 |
| 보관 확인 | required checkbox·불가역·참조 중 거절 안내, 이미 보관이면 폼 없음 | 서버 거절·체크 누락 검증은 미실행 |
| KST | formatKst Asia/Seoul 지정, 출력 KST suffix, datetime-local label KST | datetime-local은 시간대 없는 값이므로 서버 액션에서 KST→UTC 명시 변환 확인 필요. 현재 변환 구현을 단정하지 않음 |
| 좁은 화면 | 공용 dc-facts는700px 이하 한 열, dc-content min-width0·줄바꿈 | .spec nowrap은 긴 규격/숫자에 가로 넘침 가능성. 긴 메모·ID·만료시각 fixture로 실측 |
| 표 | caption·scope, 래퍼 overflow-x:auto | 래퍼 초점/접근 가능한 이름 없음. 브라우저별 자동 포커스 가정 없이 키보드 횡스크롤·표 읽기 검증 후 필요시 region/tabIndex 추가 |
| 포커스·타깃 | 공용3px focus-visible, channelList label44px, 주요 버튼 스타일 | M025-01/04, 실제 focus와 타깃 실측 필요 |
| 준비도 | 현재 페이지는 서비스 호출 없이 not_ready 안내, 업로드 비활성·이미지 URL/preview 없음 | 계약 §0-A metadata/upload는 설정 준비도일 뿐 Storage 검증 아님. 연결 시 업로드 readiness로 권리/보관까지 막지 말 것 |
| 상태/오류 | not_ready/denied/error/ok0 분리, 가짜 목록 없음 | uncertain/bad_response 분리·자동 재시도 금지는 연결 액션 후 별도 확인 |

## 계약 정합성·연결 주의

media-labels.ts:93의 ‘token으로 분기’ 주석과 MEDIA_TOKEN_TEXT는 최신 §0-A의 mediaErrorReason 우선 규칙보다 오래됐다. 현재 두 페이지에는 이 helper를 호출하는 서버 연결이 없으므로 실제 계약 위반 호출을 재현했다고 보고하지 않는다. Front 연결 시 error.token 직접 비교 대신 mediaErrorReason(e)와 code fallback을 사용해야 한다. 계약 문서 §1/§4의 일부 과거 ‘어댑터 없음/항상 not_ready’ 문장과 §0-A는 시점이 다르므로 최신 §0-A와 Master의 runtime 확정 통보를 우선할 필요가 있다.

또한 modules의 channelList display:flex보다 공용 `.dc-console .ds-editor-fields fieldset`의 grid/padding 선언 특정성이 높다. 채널 배치의 최종 computed style을 확인해야 하며, 별도 CSS에 선언돼 있다는 이유만으로 의도한 flex 배치를 보장했다고 보지 않는다.

## 반환과 한계

현재 사용자 직접 UI 작업(기존 두 링크)은 이 검토 파일과 겹치지 않는다. Front 파일 수정/서버 연결을 방해하지 않고 이 결과만 작성했다. 발견 항목은 정적 소스 조건을 제시한 P2 개선이며 P0/P1 운영 사고를 입증하지 않았다. 후속 Front 수정→동일 파일의 새 해시 기준 재검토→서버 없는 렌더 fixture/접근성 실측→승인된 runtime 통합 검증 순으로 권고한다. 이 결과는 운영 완료·접근성 통과·실제 저장/Storage 정상 판정이 아니다.
