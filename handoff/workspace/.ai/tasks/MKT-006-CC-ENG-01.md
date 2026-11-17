# MKT-006 404 서버 렌더 결함 조사·복구

P2 / 책임 CC-ENG-01 / 총괄 CX-MASTER-01. MKT-004 결과 검토 후 후속.
입력 .ai/results/MKT-004-CC-ENG-01.md, web/AGENTS.md, Next 설치본 문서.
범위 web/src/app/** 중 404 및 layout 경계 관련 최소 변경, web/tests/content/**, docs/qa/MKT-006/**, .ai/results/MKT-006-CC-ENG-01.md. components/styles/lib/distribution/package/lockfile/DB 변경 금지. Next 버전 변경·패키지 추가는 근거로 Master에 요청하고 임의 수행하지 않는다.
1 production build/start에서 정상 경로와 없는 경로/없는 story slug의 원시 HTTP 본문·status·robots·헤더를 확인. RSC/브라우저 hydration 응답 혼동 여부·스트리밍·메타데이터·레이아웃 경계 조사. 최소 재현은 테스트용으로 격리하고 실제 페이지에 잔존하지 않게 한다.
2 설치된 Next 문서와 공식 소스/문서만 근거로 조사. 원인 추측과 재현 확인 구분. 적용할 수정이 있으면 최소 변경, 404 status/noindex/비공개 글 누출 방지 유지. fake 200 또는 JS 강제 사용으로 덮지 않는다.
3 정상 SSR·404 본문에 안내와 복구 링크가 있는지 JS disabled 브라우저/원시 HTML로 검증. 기존 public/personal cache·거래 비활성 보호 유지. DOM 오인 없이 검사.
4 typecheck/lint/build 및 관련 테스트 검증. 원인 해결 불가면 시도2회 후 반복 확대하지 말고 명확한 재현과 대안/제약으로 반환.
5 MKT-004 공개 콘텐츠 저장소는 아직 빈 상태 유지. 승인 원문이나 GitHub 원격을 창작하지 않는다. 외부 게시/계정/비밀파일 접근 금지. 추가 위임 금지. worker_done으로 반환.
