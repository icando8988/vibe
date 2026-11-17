# 프로젝트·계정 이동 진입 지침

먼저 PROJECT_HANDOFF.md, handoff/workspace/AI_TEAM_RULES.md, handoff/workspace/.ai/TEAM_CURRENT.md, WORK_OWNERSHIP.md, history/WORK_HISTORY.md와 docs/MASTER_EXECUTION_PLAN_20261117.md를 읽는다(.ai와 docs는 handoff/workspace 아래).

이 저장소 루트가 원래 D:/Vibe/web 앱이다. handoff/workspace는 원래 D:/Vibe의 지침·계획·결과·원본키트 보존본이며 별도 앱 소스가 포함돼 앱의 타입검사/린트에서 제외한다. 실제 앱 src/tests의 검사 범위는 유지한다. 원본 안내의 절대경로·터미널/dispatch ID·진행상태는 과거 기록이므로 새 계정에서 재확인한다.

모든 사용자 대화·작업 설명·보고는 한국어. 사용자 직접 지시 우선, 역할은 Codex master/Claude(Front)/Claude(Backend)/Codex Design으로 구분하며 새 담당을 실제 세션에 연결한다. 비밀값·비밀번호·로그인상태를 소스/문서/커밋에 넣지 않는다. 기존 미커밋 작업과 다른 담당 변경을 보존한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
