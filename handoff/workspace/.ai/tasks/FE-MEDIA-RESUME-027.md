# FE-MEDIA-RESUME-027 — 미디어 UI 인수 및 metadata 흐름 완성

지시: 사용자 2026-11-17 개발플랜 확인 후 담당별 작업지시 / Codex master.
담당: 기존 Claude Front CC-FRONT-01. 우선순위 P1. 상태 prepared.
앱 경로 D:/VIBE/vibe-github. 먼저 루트 AGENTS.md, PROJECT_HANDOFF.md, handoff/workspace/AI_TEAM_RULES.md, .ai/TEAM_CURRENT.md, .ai/WORK_OWNERSHIP.md, .ai/roles/CLAUDE_FRONT.md, docs/MASTER_EXECUTION_PLAN_20261117.md, docs/contracts/MEDIA_FRONT_CONTRACT.md, .ai/results/RESUME-20261117-MASTER.md, .ai/results/FE-MEDIA-024-CC-FRONT-01.md, .ai/results/UI-MEDIA-025-CX-DESIGN-01.md를 읽는다(.ai/docs는 handoff/workspace 아래)。 시작 시 작업ID/수정파일/사용자 직접지시 충돌 유무를 Master에 보고한다.

기준선 8f0691c. 현재 전체 37파일622pass/skip0, build/typecheck 성공, lint 기존경고3. FE-MEDIA-024 중간변경 보존본에서 이어간다.

## 실행 및 범위

1. 현재 미디어 목록/상세/권리/보관의 실제 서비스·액션 연결을 인수한다. 기존 Design 지적을 현재 코드에 대조해 남은 문제를 수정한다. 준비안됨/조회오류/성공0건/충돌/uncertain을 구분하고 expectedVersion 및 사용자 입력을 보존한다. ready와 권리승인을 구분한다. 접근성·반응형 상태까지 정리한다.
2. 허용: src/app/admin/distribution/media/**, 미디어 전용 컴포넌트/CSS, tests/distribution-front/media-ui.test.ts, 고유 결과. 관련 실제 파일 경로를 찾아 시작보고한다. 공통 ActionForm 변경이 필요하면 심벌/호환영향을 Master에 먼저 알리고 해당 구간 조정 후 수정한다.
3. Backend가 BE-UPLOAD-RESUME-026으로 잠정 업로드 계약을 검토 중이다. 이번 작업은 metadata 흐름 완성 및 직접업로드 소비 계획까지다. 업로드 활성화/실제 전송 UI 추가는 Master가 최종 계약을 인수해 후속 지시한 뒤 진행한다. 가짜 성공이나 준비되지 않은 업로드 활성화 금지.
4. Design은 읽기전용 검토·고유 결과만 작성한다. 지적은 현재 코드와 대조해 수용하고 미해결 이유를 보고한다.

Backend/API/SQL/OAuth/package/lock/globals/config/공통auth/TEAM/공통히스토리 수정 금지. 배포/실DB/외부게시 없음. 기존 다른 담당 변경 보존. Next 관련 수정 전 node_modules/next/dist/docs 안내, 여러 TSX 수정 시 React best practices 스킬 적용.

## 완료/반환

관련 UI 회귀/타입/lint 및 필요 범위의 build. 실제 승인 admin 세션이 없으면 우회하지 말고 실측 불가 범위를 기록한다. handoff/workspace/.ai/results/FE-MEDIA-RESUME-027-CC-FRONT-01.md에 변경파일·명령/exit·pass/skip·실측/미실측·Backend 의존·업로드 후속 수정파일 계획을 남기고 worker_done으로 Master에 반환한다. ready_review와 운영완료를 구분한다.
