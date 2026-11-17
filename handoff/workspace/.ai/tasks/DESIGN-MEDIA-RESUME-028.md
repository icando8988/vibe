# DESIGN-MEDIA-RESUME-028 — 미디어 화면 독립 UX/접근성 검토

지시: 사용자 2026-11-17 개발플랜 확인 후 담당별 작업지시 / Codex master.
담당 기존 Codex Design CX-DESIGN-01. 우선순위 P2. 상태 prepared.
앱 경로 D:/VIBE/vibe-github. 먼저 루트 AGENTS.md/PROJECT_HANDOFF.md, handoff/workspace/AI_TEAM_RULES.md, .ai/TEAM_CURRENT.md, .ai/WORK_OWNERSHIP.md, docs/MASTER_EXECUTION_PLAN_20261117.md, .ai/results/RESUME-20261117-MASTER.md, .ai/results/UI-MEDIA-025-CX-DESIGN-01.md와 현재 미디어 소스를 읽는다(.ai/docs는 handoff/workspace 아래)。

## 작업

Front FE-MEDIA-RESUME-027과 병행하므로 앱 코드 수정 없이 읽기전용 검토한다. 실제 현재 소스와 기존 P2 지적을 대조하고, 미디어 목록/상세/권리/보관의 상태·문구·포커스·label·키보드·표·오류 안내·모바일 320/700/960px 동선을 검토한다. 준비상태/조회오류/0건/충돌/uncertain과 ready/권리승인 차이가 이해되는지 확인한다. 업로드는 최종 계약 인수 전 비활성 유지. 원문 중심 A안 유지.

검토한 파일/심벌과 기준 해시를 기록하고 P1/P2·재현/근거·권장 수정·Front 인계 순으로 결과를 만든다. 브라우저 검토가 가능하면 ego-browser 스킬로 진행하고, 승인 admin 접근이 없으면 인증우회/가짜 성공 없이 소스 검토와 실측을 명확히 구분한다. 서버 시작이 필요한 경우 기존 실행과 포트부터 확인하며 다른 담당 환경을 중단하지 않는다.

수정 허용은 고유 결과 handoff/workspace/.ai/results/DESIGN-MEDIA-RESUME-028-CX-DESIGN-01.md뿐. UI/CSS/시험/TEAM/점유/공통이력 수정 금지. Front 변경이 중간 반영되면 읽은 시점을 명시한다. 시작에 작업ID/읽을범위/충돌을 보고하고, 완료 시 worker_done으로 Master에 결과·실측/미실측·남은문제를 반환한다. 배포/외부게시 없음.
