# MKT-004 공개 콘텐츠 읽기 기반

P1 / CC-ENG-01 / Master CX-MASTER-01 / 상위 DEVELOPMENT-001.
MKT-003 결과 검토 후 후속. 콘텐츠 배포 우선 원칙 유지. 프로그램 수령을 기다리지 않고 유입 목적지의 콘텐츠 읽기 기반을 준비한다.
입력: docs/MARKETING_DELIVERY_PLAN.md, 기존 디자인 시스템, MKT-003 모델, DEV-002B 보고.
수정 범위: web/src/lib/content/**, web/tests/content/**, web/src/app/stories/**, web/src/app/_components/**, web/src/app/login/page.tsx, web/src/app/me/page.tsx, web/src/app/not-found.tsx, docs/CONTENT_WORKFLOW.md, .ai/results/MKT-004-CC-ENG-01.md. components/styles/package/DB/배포 공통 로직은 변경 금지.

1 공개 콘텐츠 모델 및 repository interface 작성: slug/title/summary/body/source references/publication status/publishedAt/author label 등. 기존 배포 ContentItem과 연결 관계를 문서화하되 일방적으로 타입 변경 금지. draft/reviewed/published 상태에서 검토·출처·공개 허용이 없으면 공개 조회에서 제외. 서버 외부 네트워크/DB 연결 없이 명시적 빈 저장소로 시작.
2 /stories 목록, /stories/[slug] 상세를 구현. 현재 실제 승인된 글이 없으므로 목록은 정직한 빈 상태, 미게시/존재하지 않는 slug는 404. 테스트 fixture를 실제 공개 글처럼 seed하지 않는다. 원문 렌더는 HTML unsafe 삽입 없이 텍스트/단락 우선. 프로젝트 실적·이력·사진 창작 금지.
3 정적 metadata/공개 게시물별 metadata 구조 준비, 미승인 공개/색인/사이트 전체 noindex 해제는 하지 않는다. 사이트 URL 미확정이면 절대 canonical/OG 주소 창작하지 않는다. 외부 추적 스크립트 설치 금지.
4 DEV-002B APP-002B-01 링크 조작높이 24px 문제를 허용 app 파일에서 적절한 ds-text-link/ds-button으로 수정. 링크 의미·문장 구조 유지.
5 공개/초안/없는 slug/출처 미확인/악성 본문 안전 렌더 시험과 가능한 typecheck/lint/build 실행. Design이 병행 수정 중이므로 components/styles 변경은 하지 말고 전체 build 실패 중 타인 범위 원인은 구분 보고.
6 docs/CONTENT_WORKFLOW에 원문→검토→채널 초안→배포→방문 목적 콘텐츠 연결, 프로그램 수령 시 필요한 저장/인증/게시 검증, 실제 승인된 원문 필요를 기록.
완료 worker_done. 추가 위임/외부 게시/계정 연결/새 패키지/실자료 허위작성 금지. DB 실행기는 현재 우선순위에서 추가 도입하지 않는다.
