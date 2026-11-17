# UI-MKT-001 모의 배포 상태·오류 안내 보강

P2 / CX-DESIGN-01 / Master CX-MASTER-01 / MKT010 반환 후 즉시 후속.
입력 MARKETING_INTEGRATION_REVIEW U01~03, DEC-DISTRIBUTION-002, 현재 distribution Result 타입 읽기전용.
범위 web/src/components/content-distribution-preview.tsx, web/src/styles/design.css 필요 최소변경, docs/DESIGN_SYSTEM.md, docs/qa/UI-MKT-001/**, .ai/results/UI-MKT-001-CX-DESIGN-01.md. app/lib/tests/package/원고/공용.ai 수정 금지.
U01 raw dry_run_succeeded 대신 사람이 읽는 한글 상태 표시. U02 CODE:원문 오류 노출 대신 코드별 짧고 구체적 안내+다음 행동, 모르는 코드는 비밀/원문 그대로 내보내지 말고 일반 안내. 중복은 같은원문·채널 이미모의실행됨/다시입력확인 등 실제현재기능에 맞게. 미지원 행동을 해결경로로 약속하지 않는다.
U03 applyResult(started.value,outcome,{attempt:started.value.attempts})로 시도 식별자 전달. 공통 lib는 Claude가 강화 중이며 API충돌시 Master에게 근거보고, lib수정하지 않는다. UI는 dry_run만 유지, published/실예약/저장/로그인우회 추가금지.
공백·미검토·중복·편집무효·모의완료와 예시상태 분리 실제브라우저 재검증. raw code/status가 일반 사용자화면에 나타나지 않는지 확인, 320/390/1440 반응형·키보드. lint/typecheck 및 변경에 맞는 검증만. 원고v2 미승인 상태 유지.
결과 worker_done. 새패키지/외부호출/추가위임 금지.
