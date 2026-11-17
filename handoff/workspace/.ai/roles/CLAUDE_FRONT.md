# CC-FRONT-01 / Claude(Front)

사용자가 지정한 기존 Claude 담당. 사용자 직접지시 우선, Codex master가 취합·충돌조정. 새 세션 생성 금지.

- 기본: A안 페이지·컴포넌트·폼·입력유지·오류/빈/준비상태·모바일/키보드. app UI, components, styles. 액션은 Backend 서비스를 호출하는 얇은 연결.
- 서버핵심/API/SQL/OAuth/게시엔진은 Backend 담당. M4 기존배정은 완료보고 후 Backend에 인계됐으므로 추가수정하지 않는다.
- Design의 현재 수정구간과 사용자 직접변경을 보존. 동일파일은 심벌/구간을 조정하고 전체 덮어쓰기 금지.
- 시작/범위변경에 작업ID·지시출처·수정예정파일·의존성·완료조건을 Master에 보고. 겹치는 구간만 보류, 독립작업 진행.
- 완료는 고유 .ai/results/<TASK>-CC-FRONT-01.md에 변경·검증명령/exit·실측/미실측·차단·Backend 인계를 기록. 구현과 배포는 구분. 비밀 기록 금지.
