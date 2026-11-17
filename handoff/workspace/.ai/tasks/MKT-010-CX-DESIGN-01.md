# MKT-010 독자용 콘텐츠 v2와 비교 HTML

P1 / CX-DESIGN-01 / Master CX-MASTER-01. 사용자: 계속 진행·쉬는 세션 없이 후속 지시.
입력 docs/marketing/first-content-pack.md/.json 읽기전용, planning-source-extracted.txt, 존재하면 EDITORIAL_REVIEW.md(Claude 작성 중이면 불완전본 사용하지 말고 최종 보고 후 반영).
허용 docs/marketing/reader-content-pack.md/.json, docs/marketing/render-reader-review.cjs, docs/marketing/reader-review.html, docs/qa/MKT-010/**, 본인 결과 .ai/results/MKT-010-CX-DESIGN-01.md. web/기존pack/공용.ai 변경 금지.
1 기존3주제×3채널을 v2 별도 편집. 내부 검토 말투 ‘기획서에는/방향을 제안합니다/초안입니다/내용을 창작하지 않습니다’ 등은 독자용 본문에서 덜어내고 메타데이터 확인사항으로 분리. 핵심 계획/미확정 사실은 정직하게 유지, 허위 경험/인용/인증/성과/수치·날짜 추가 금지.
2 실제 출판 동기·개인 감정은 입력이 없어 쓰지 않는다. 주제2는 계획을 독자가 이해할 질문으로, 주제3는 출판 계획 소개로 편집. 새로운 여행 장비/훈련 지식을 꾸며내거나 외부 정보 조사하지 않는다. 기존 자료 범위 내 읽기 쉬운 제목·도입·소제목·마무리 CTA를 만든다. 문구 효과/트래픽 성과 보장 금지.
3 전체12항목 publicApproval=false, runtimeImportAllowed=false, externallyPosted=false 유지. 출처와 확인사항은 본문과 분리. 내부 /about,/stories 목적 경로 제안만, 외부 URL/계정/해시태그 창작 금지. 사용자 공개repo 실명 유지 승인과 게시물별 발행 승인은 별개로 기록.
4 원본 보존, v1-v2 비교 가능한 reader-review.html 생성. 본문 복사/주제·채널 선택, 근거/공개 전 확인사항 접기. 승인/저장/게시 기능과 외부요청 없음. 기존 renderer 재사용은 독립 복사/공통 읽기 수준으로 기존 파일 변경 금지. HTML escape·12항목일치·320/390/1440 검증.
5 Claude EDITORIAL_REVIEW가 완성되면 의견별 적용/미적용 이유를 결과에 기록. 아직 없으면 이를 기다리며 멈추지 말고 v2 제작·검증부터 완료해 반환.
완료 worker_done. 추가 위임/앱 반영/실발행 금지.
