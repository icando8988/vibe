# MKT-005 배포 시안과 공통 로직 연결

책임 CX-DESIGN-01 / P1 / Master CX-MASTER-01.
MKT-002 결과 수용 범위: 콘텐츠 중심 홈·독립 미리보기 구현 및 lint/typecheck/로컬 harness 검증. 인증/Next 관리자 라우트/실게시 통합 완료 아님.
입력 .ai/results/MKT-003-CC-ENG-01.md, web/src/lib/distribution/** (읽기 전용), 기존 계약/디자인.
수정 범위 web/src/components/**, web/src/styles/**, docs/DESIGN_SYSTEM.md, docs/qa/MKT-005/**, .ai/results/MKT-005-CX-DESIGN-01.md. app/lib/tests/package/DB/공용 .ai 수정 금지. Claude는 app/stories와 lib/content 점유.

1 ContentDistributionPreview의 로컬 시안을 공통 배포 타입/순수 함수/모의 어댑터와 연결. 기존 domain 직접 import가 클라이언트 호환인지 확인. 독립적으로 같은 상태 기계를 또 만들지 않는다.
2 명시적 ‘샘플 검토 확인’→‘모의 실행’ 흐름. 승인/원문 버전·빈 본문 검증, 편집하면 이전 확인이 무효임을 표시. 검토는 화면 내 샘플 상태이며 운영상 승인으로 저장되지 않는다. 모의 실행 결과 dry_run_succeeded를 ‘모의 실행 완료·외부 게시 없음’으로 표시.
3 live 실행 호출/실계정/실예약/저장은 제공하지 않는다. 미연결 capability 표를 표시하고 임의 supported 표시 금지. unknown·부분성공은 별도 ‘상태 설명 예시’ 영역에서만 보여주고 실제 사건으로 위장 금지. UI의 예정 상태와 실제 실행 결과를 명확히 구분.
4 공통 로직의 의미있는 테스트는 이미 Claude가 작성했으므로 중복 구현 테스트 추가 금지. UI 입력→검토무효→모의 결과 및 재클릭/빈 본문 오류를 실제 브라우저 harness로 검증. 기존 외부 네트워크 호출/브라우저 storage 없음 유지, 개인정보 입력 금지 안내 유지.
5 320/390/768/1440 폭 검증. /stories는 Claude가 구현 중이므로 헤더·홈 콘텐츠 링크는 완성 여부 확인 전 임의 변경하지 말고 연결 제안으로 보고. Next 보호 관리자 route 통합은 별도 후속.
완료 worker_done, 미실행/권한 미연결 명시. 추가 위임/새 라이브러리/게시/인증 우회 금지.
