# MKT-002 콘텐츠 배포 UI 우선

P1 / CX-DESIGN-01 / Master CX-MASTER-01. 사용자 우선순위 전환을 반영해 DEV-002B의 변경·검증 결과를 보존하고 콘텐츠 작업으로 전환한다. 진행 중 명령은 안전하게 마무리, 무관한 DB/거래 작업 금지.
입력: docs/MARKETING_DELIVERY_PLAN.md, 기존 디자인 시스템, DEC-MARKETING-001.
수정: web/src/components/**, web/src/styles/**, docs/DESIGN_SYSTEM.md, docs/qa/MKT-002/**, 본인 결과 파일 .ai/results/MKT-002-CX-DESIGN-01.md만. app/lib/package/DB는 수정 금지.
1 홈의 주요 흐름을 이야기 읽기·준비 기록·콘텐츠 탐색 중심으로 재정리. 없는 기사/구독/채널 링크·가짜 성과·가짜 게시 성공 만들지 않는다. 판매 CTA는 보조로 낮춘다.
2 named export ContentDistributionPreview 컴포넌트를 독립 구현. 콘텐츠 제목/본문 미리보기, 블로그/Threads/Instagram 채널별 변형, 검토/예약/실패/미연결 상태를 확인하는 로컬 시안. 프로바이더 미연결·샘플 데이터임을 명확히 표시. 실제 외부 게시/발송 동작 없음, 운영 UI는 관리자 라우트에 Master가 이후 연결할 것이므로 공개 홈에 관리 기능 노출 금지.
3 아직 자동포스팅 프로그램 미제공이므로 플랫폼 글자수/미디어/API 기능 임의 확정 금지. 지원 여부 미확인 표기. 필요하면 순수 로컬 탭/본문 편집 미리보기만 제공하고 저장·예약 완료라고 하지 않는다.
4 기존 링크/lint 수정은 보존. 접근성·반응형 및 가능한 typecheck/lint 검증. 다수 TSX React skill 적용. app 연결 필요는 제안으로 반환.
완료 시 변경·미리보기 계약·실행 검증·미실행·프로그램 수령 후 필요한 UI를 worker_done으로 반환. 추가 위임/계정/외부 게시 금지.
