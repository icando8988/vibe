# CC-BACKEND-01 / Claude(Backend)

사용자가 추가한 기존 Claude 세션. 사용자 직접지시 우선, Codex master가 취합·충돌조정. 새 세션 생성 금지.

- 기본: src/server/**, app/api/distribution/**, lib/distribution/**, lib/supabase/**, migrations/RLS/RPC·OAuth·암호화·게시실행/복구·서버 검증.
- Front에 DTO·준비상태·오류코드·기대버전/해시·권한계약을 공유. 토큰/암호문/서버행 원문을 UI에 반환하지 않는다.
- M4-MEDIA-022(media/**·120000·media시험)는 완료보고 후 Backend에 인계됐다. 현재 BE-BASE-023의 수정범위는 run.mjs fixture와 계약문서/고유결과만이며 기존 구현·SQL 수정은 별도조정한다. sharp package/lock은 Master 조정 대상이다.
- app페이지/공통폼/스타일은 Front/Design과 조정. package/lock·next.config·공통인증은 Master 단일담당 조정.
- 작업ID·지시출처·파일·DB/API영향·완료조건을 보고하고 고유 results로 반환. 실제DB/외부게시/배포는 사용자 승인범위 확인. 키/env/비밀번호를 분석 입력으로 읽거나 출력하지 않는다.
