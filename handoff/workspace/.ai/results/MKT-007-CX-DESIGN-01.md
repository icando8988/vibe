# MKT-007 검토용 첫 콘텐츠 묶음

책임 Codex design / CX-DESIGN-01 · P1 · 상태 ready_review · 2026-11-16.
범위: docs/marketing/first-content-pack.md, first-content-pack.json, 이 결과만.
완료 조건: 3주제 원문과 3채널 변형 총9개, 항목별 출처/미승인/확인사항/이미지 권리·채널 미확인, UTF-8/구조/자체 검토.
입력: MASTER_DEVELOPMENT_PLAN, planning-source-extracted, MARKETING_DELIVERY_PLAN. 자격정보 미열람, 앱 변경·외부 게시 없음.

## 산출물

- docs/marketing/first-content-pack.md: 사용자 검토용 원문 3개와 블로그/Threads/Instagram 변형 9개. 주제별 주장 근거 표, 각 초안별 출처·미승인·확인사항·CTA·이미지 상태·채널 기능 미확인 표시.
- docs/marketing/first-content-pack.json: 같은 제목·본문과 메타데이터. editorial_review_only, runtimeImportAllowed=false. 원문/변형 12개와 topic/pack 모두 draft/publicApproval=false/externallyPosted=false. 자동 배포용 ContentItem/ChannelDraft로 변환하지 않음.
- 이 결과 파일. 이 세 파일 외 변경 없음. 새 패키지·프로그램 실행·외부 게시·계정 연결·이미지 생성 없음.

## 읽은 범위·주장 분리

planning-source-extracted.txt의 첫 시트 관련 입력 E17(전자책/종이책), E19(자전거 세계일주 도전), E48(자료), E49(여정 계획)을 핵심 근거로 사용했다. MASTER_DEVELOPMENT_PLAN 1·2·4·9·20절과 MARKETING_DELIVERY_PLAN의 콘텐츠 가설/미수령 제한을 적용했다. 원본 XLSX를 새로 열거나 추출기가 계산한 것처럼 보고하지 않는다. E열과 예시 D열의 중복은 당사자 확인 대상으로 명시했다.

주제 1은 프로젝트 소개, 주제 2는 앞으로 기록할 질문, 주제 3은 출판 구상이다. 준비 항목의 질문은 편집 제안으로 분류했다. 실제 장비/훈련/답사/여권/예약/준비 완료를 만들지 않았고 출판의 개인적 동기·감정·인용을 창작하지 않았다. 세계일주는 계획으로 한정했으며 기록 인증/최고령/협찬·실제 사진·확정 브랜드·가격·일정을 초안에 넣지 않았다.

## 실행 검증

Node.js v26.13.0의 일회성 읽기 전용 assert 검사 최종 exit 0:

- TextDecoder UTF-8 fatal 디코딩과 JSON.parse 성공. 대체문자 및 깨진 연속 물음표 없음.
- 3주제 각각 blog/threads/instagram 정확히 1개, 원문 3개+변형 9개=12개.
- 12개 모두 draft, 공개승인 false, 외부 미게시. pack/topic 승인도 false.
- 출처 셀 패턴 E17/E19/E48/E49와 실제 추출문 셀 존재, 각 claimIds의 근거 연결 확인.
- 모든 초안의 확인사항·이미지 미수령/권리·동의 미확인·채널 미연결/기능 미확인 확인.
- CTA는 /about 또는 /stories만, 승인 false.
- JSON 제목/본문 12개가 Markdown에 그대로 존재, Markdown 미승인 메타데이터 블록 12개.
- 12개 본문은 서로 완전히 동일하지 않음. 외부 URL/계정명/해시태그/1인칭 인터뷰·직접 인용/기네스·최고령·협찬 패턴이 본문에 없음.

수동 검토도 수행했다. 같은 계획을 채널별로 반복하는 부분은 의도된 재구성이며 새 사실이나 별도 경험담으로 바꾸지 않았다. 패턴 검사만으로 사실 확인을 완료했다고 보지 않는다.

초기 생성에서 PowerShell 파이프의 기본 인코딩 때문에 Markdown 안내 라벨과 새 메타 문자열이 깨졌다. 검증 시 발견하여 UTF-8 OutputEncoding을 지정하고 재생성했으며 최종 한글 표시·엄격 디코딩·구조 검사까지 통과했다. 이 실패 시점 산출물은 최종 결과로 반환하지 않는다.

## Master 검토와 필요한 입력

1. 당사자의 계획 유효성·성명/소개 공개 동의·문구 승인 및 공식 표기.
2. 실제 준비 상태·최신 여정 자료와 원본 사진/문서·촬영 맥락·권리/공개 범위.
3. 실제 출판 목적 설명, 원고/표지/목차 유무와 책 정보를 공개할 수 있는 범위.
4. 프로그램 수령 후 서비스/계정·문자/미디어·이미지 필수·API/예약 지원과 CTA 제공 방식 확인.

모든 초안은 공개 전 당사자 사실 확인과 별도 승인 필요. 실제 게시 적합성·채널 규격·성과·외부 게시·앱 저장은 검증하거나 수행하지 않았다. 사용자 검토를 위한 반환이며 운영 게시 완료가 아니다.
