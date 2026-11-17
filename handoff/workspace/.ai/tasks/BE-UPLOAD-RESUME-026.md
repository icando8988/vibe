# BE-UPLOAD-RESUME-026 — 업로드 서버 인수 및 최종 계약 확정

지시: 사용자 2026-11-17 개발플랜 확인 후 담당별 작업지시 / Codex master CX-MASTER-01.
담당: 기존 Claude Backend CC-BACKEND-01. 우선순위 P1. 상태 prepared.
실제 앱/작업 경로: D:/VIBE/vibe-github. D:/VIBE는 앱 루트가 아니다.

먼저 루트 AGENTS.md, PROJECT_HANDOFF.md, handoff/workspace/AI_TEAM_RULES.md, .ai/TEAM_CURRENT.md, .ai/WORK_OWNERSHIP.md, docs/MASTER_EXECUTION_PLAN_20261117.md, .ai/results/RESUME-20261117-MASTER.md를 읽는다(.ai/docs는 handoff/workspace 아래). 해당 역할 지침은 .ai/roles/CLAUDE_BACKEND.md다. 과거 terminal/dispatch는 재사용하지 않는다. 시작 시 작업ID/수정파일/직접지시와 충돌 유무를 Master에 보고한다.

기준선 main 8f0691c. 새 PC에서 Node24/PGlite 포함 37파일622pass/skip0, build/typecheck 성공, lint 오류0/기존경고3. 기존 BE-UPLOAD-025는 코드가 보존됐으나 최종 보고 없고 MEDIA_UPLOAD_CONTRACT는 잠정이다.

## 실행 및 수정 범위

1. BE-UPLOAD-025 구현과 docs/contracts/MEDIA_UPLOAD_CONTRACT.md를 대조하고 불일치를 수정한다. grant→직접전송→complete/cancel, actor/D1, nonce, 버전, 만료, 중복완료/취소, 응답유실/uncertain, not_uploaded/storage_error 재확인 동선을 검토한다. Storage 서명 업로드 방식/헤더의 미검증 전제를 명시하고 실제 코드와 계약을 일치시킨다. 소스만으로 실제 Storage 검증 완료라 하지 않는다.
2. 허용 수정: src/server/distribution/media/**, src/app/api/distribution/media/upload/**, 관련 tests/distribution-server/**와 scripts/distribution-local-verify/upload-run.mjs, docs/contracts/MEDIA_UPLOAD_CONTRACT.md, 고유 결과. 기존 metadata export 후방호환을 유지한다. SQL 결함이면 적용된 migration 수정 대신 새 forward migration을 제안하고 Master와 범위를 먼저 조정한다.
3. Front에 넘길 확정 DTO/오류/status/준비도/재시도 조건을 고유 결과에 명확히 쓰고 Master에 반환한다. UI 활성화는 Master 인수 전 보류. 계약이 로컬 기준 확정돼도 실제 Storage 미검증은 남긴다.
4. OPS-READY-024 준비로 실제 서비스에 쓰기 없이 필요한 migration/bucket/환경변수명/검증순서/고아정리 공백을 결과에 정리한다. 비밀값을 읽거나 출력하지 않는다.

Front UI/CSS/공통auth/package/lock/config/TEAM/공통이력 수정 금지. 배포·실DB 적용·bucket 생성·외부게시 없음. 다른 담당 변경 보존. Next 관련 코드 작성 전 설치된 node_modules/next/dist/docs의 해당 안내 확인.

## 완료/반환

변경 영향에 맞는 업로드 단위/PGlite 왕복과 회귀, 타입/린트 검사. 이미 622통과한 기준선을 약화시키거나 skip을 추가하지 않는다. Node24/PGLITE_PROJECT 준비 명령은 RESUME 결과 문서 참조. 수정파일·명령/exit·pass/skip·실/대역 구분·남은 결함·Front 전달계약·최종diff/hash를 handoff/workspace/.ai/results/BE-UPLOAD-RESUME-026-CC-BACKEND-01.md에 기록하고 worker_done으로 Master에 반환한다. 상태 ready_review. 임의로 통합수락/운영완료라 하지 않는다.
