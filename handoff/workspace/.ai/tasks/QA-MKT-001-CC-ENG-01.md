# QA-MKT-001 마케팅 로직 독립 결함 검토

P1 / CC-ENG-01 / Master CX-MASTER-01.
MKT-009 편집 검토를 먼저 완료·반환하고 곧바로 본 작업 착수. 현재 MKT-009가 이미 완료됐으면 바로 시작. Design은 별도 콘텐츠v2 담당.
입력 web/src/lib/distribution/**, lib/content/**, components/content-distribution-preview.tsx, 기존 테스트, web/AGENTS.md. 자기 작성 로직은 자기 검토임을 명시하고 Design UI와의 계약 검토는 독립 교차 검토임을 구별한다.
허용 수정 web/src/lib/distribution/**, web/tests/distribution/**, docs/MARKETING_INTEGRATION_REVIEW.md, .ai/results/QA-MKT-001-CC-ENG-01.md만. content/app/components/styles/package/DB/마케팅원고/공용.ai 변경 금지.
실제 결함 중심: 비어있지 않지만 잘못된 현재시각/시간대, maxAttempts 0·NaN·음수, mode/channel 런타임오염, 멱등키 구분자 충돌, 결과 식별자 공백/재생 입력, dispatch 상태 아닌 결과 반영, unknown 후 안전재시도, 취소와 늦은결과, 원문 버전 변경과 stale 승인, UTM 경로 우회/외부호스트, UI 모의 결과와 운영 상태 혼동. 모두 새 기능이 아닌 현재 계약의 검증.
각 발견에 재현·영향·기대 결과. 허용 범위 실제 결함은 최소 수정+의미 있는 회귀시험. 정상 동작을 결함처럼 꾸미거나 구현 복제 테스트/불필요 복잡화 금지. 정책 미결은 코드로 확정하지 않는다. 외부 게시·계정·새패키지·실제 공급자 SDK 금지.
공통타입 API 변경은 Design 컴포넌트와 호환 유지, 변경 필요시 ask. typecheck/test/lint 실행, UI 범위 결함은 제안만 반환. MKT009와 본 결과 각각 별도파일·반환 요약. 추가 위임 금지.
