# MKT-010 독자용 v2·비교 HTML

책임 Codex design / CX-DESIGN-01 · P1 · 상태 ready_review · 2026-11-16.
범위: reader-content-pack.md/json, render-reader-review.cjs, reader-review.html, docs/qa/MKT-010/**, 이 결과.
원본 pack·renderer와 web은 수정하지 않는다. 3주제 원문/9변형의 내부 말투를 메타로 분리하고 v1-v2 비교·미승인·원문일치·escape·3폭 검증한다.
착수 시 EDITORIAL_REVIEW.md 및 최종 결과가 없어 불완전본을 읽지 않고 독립 편집한다.

## 최종 편집 검토 수령·반영

작업 중 Master msg_370aac04936f와 MKT-009 ready_review 결과를 확인하고 EDITORIAL_REVIEW.md 전체를 읽어 반영했다. 아래 판정은 v2에만 적용하며 v1은 보존한다.

| 의견 | 적용/보류와 이유 |
|---|---|
| R-01 | 적용. 내부 기획·면책·검토 말투를 editorialNotes/근거/확인사항으로 분리. 독자 본문은 계획의 소개/질문/출판 구상으로 편집 |
| R-02 | 적용. E49에 적힌 2029년3월15일 부산항 출발·13구간·단독 탐방 후 귀향을 T1 원문/변형에 계획으로만 사용. 거리 수치·현재 확정·실적은 추가하지 않음 |
| R-03 | Master 지시대로 T2 4항목 유지하되 editorialHold=true 및 실제 준비자료 없음/발행 보류 사유를 JSON·MD·HTML에 표시. 운영 체크리스트는 구간/수단/일정의 독자 질문으로 바꿈 |
| R-04 | 적용. 모든 CTA를 /about 제안으로 통일. 빈 /stories로 유입시키는 본문과 목적 경로를 제거 |
| R-05 | 적용. T2의 E48 sourceRefs 제거. 여행/준비 사진은 원문 근거 없음으로 기록하고 권리·자료 편집 원칙은 총괄20절 AS02로 구분. E48은 책/상품 관련 근거로만 유지 |
| R-06 | 적용. 본문 면책 반복을 없애고 blog는 설명/소제목, Threads는 핵심 계획+질문, Instagram은 짧은 캡션으로 구분 |
| R-07 | 별도 후속. /about 보강은 web 금지 범위이므로 수정하지 않음. CTA 제안만 반환 |
| R-08 | 유지/확인 대기. 저장소 실명 유지 승인 범위를 별도 객체로 기록하고 게시물별 공개승인은 모두 false. 호칭·당사자 소개 공개 동의는 Q1 대기 |
| R-09 | 적용. T3는 전자책·종이책으로 펴낼 계획이라는 간결한 문장으로 편집. 개인 출판 동기/감정 추가 없음 |
| R-10 | 적용. 이미지 미확보 Instagram 3항목 editorialHold=true. 플랫폼 이미지 필수 여부를 단정한 것이 아닌 자료/권리·채널 미확인에 따른 편집 보류 |
| R-11 | 적용. 긍정형 제목으로 계획 자체를 먼저 설명 |
| 검토 예시의 운영 약속 | 미적용. ‘차례로 소개하겠습니다/알려 드릴게요’는 Q5 미확정이므로 추가하지 않음 |

Q1~Q6는 모두 확인 대기로 유지했다. 고유 보류 항목은 T2 4개 + 다른 주제 Instagram2개 =6개이며 T2 Instagram에는 두 보류 사유가 함께 있다. 보류가 아닌 나머지6개도 공개 미승인/앱 반영 불가/외부 미게시다.

## 변경 산출물

- reader-content-pack.json/md: 독자용 원문3개·블로그/Threads/Instagram변형9개. 본문과 내부 근거 분리, 전12항목 draft/publicApproval=false/runtimeImportAllowed=false/externallyPosted=false, 보류 사유와 Q1~Q6 유지.
- render-reader-review.cjs: Node 빌트인 fs/path만으로 원본v1과 v2를 읽어 비교HTML 및 v2Markdown 생성. 기존 renderer는 수정하지 않음.
- reader-review.html: 주제3개/항목4개 선택, v1-v2나란히 비교(모바일 세로), 본문 복사와 실패시 수동선택, 근거/확인사항 접기, 보류 배지는 항상 본문 전에 표시. 모든 공개승인 false. 승인·저장·예약·게시 기능/외부요청/storage 없음.
- docs/qa/MKT-010: 재현 스크립트·원본해시·36조합·복사/키보드검사·스크린샷.
- 이 결과. web/기존pack/공용.ai 수정 없음. 실게시·외부 프로그램·계정·이미지 생성 없음.

## 검증

Node assert와 실제 Orca Chromium 최종 exit0:

1. v2 12항목 상태3플래그 false, 원문3개/변형9개, CTA모두 /about, Q1~Q6, 저장소실명승인≠발행승인, T2 E48출처제거, 보류6개 사유 검사.
2. 본문에서 내부말투·확인필요반복·운영약속·기네스/최고령/협찬/거리km/외부URL/계정/해시태그 패턴 없음. 날짜/구간은 원문에 있는 계획만 사용. 수동 자체검토에서 동기·감정·경험창작 없음 확인.
3. 실제 DOM의 v1-v2 12쌍(24패널) 제목·본문이 JSON과 완전일치, v2Markdown에도12항목 동일. v1 pack JSON/MD·기존renderer·기존HTML의 SHA-256 변경없음.
4. 320/390 mobile·1440 desktop ×3주제×4항목 총36조합: 선택주제/항목 및 v1/v2패널, 해당보류표시, 가로넘침없음 확인.
5. 실제 v2본문 복사 성공. 실패 shim에서 시도payload/선택문자열이 v2본문과 완전일치, Ctrl+C안내 확인. 사용자기존클립보드는 읽지 않음. reload로 shim제거.
6. 실제 Tab/ArrowDown으로 비교항목 전환 및 상태알림 확인. 세 대표캡처 직접 확인, 320px에서도 보류사유가 본문앞에 표시됨.
7. 엄격UTF-8 디코딩, 결정적 HTML생성, 악성 script닫힘/img태그 합성입력 escape, 실행script구문 검사 통과. inlineJSON없음/고정script와 텍스트escape 사용.

미실행: 다른브라우저·실기기·화면낭독기·실제200%확대·모바일복사메뉴, 실발행/권리/채널규격 검증. 별도 서버나 앱을 실행하지 않았음.

## Master 후속

v2는 검토용이며 발행원고로 승인한 것이 아니다. Q1~Q6·권리/이미지·프로그램분석·채널규격과 게시물별 공개승인이 필요하다. T2와 Instagram 보류 유지, /about보강은 별도범위로 검토.

Master msg_60ab2dada82e의 모의배포UI 한글상태/오류안내 및 applyResult attempt 전달 권고는 다음배정 준비사항으로만 기록했다. 지시대로 이번콘텐츠작업과 동시에 web/lib를 편집하지 않았다. 자료 MARKETING_INTEGRATION_REVIEW는 다음배정에서 확인한다.
