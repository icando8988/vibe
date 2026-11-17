# BE-UPLOAD-RECOVERY-030 — 소비 후 고착 복구 설계 및 forward migration

책임 CC-BACKEND-01, Master 후속배정. D:/VIBE/vibe-github. BE-UPLOAD-RESUME-026 결과·upload.ts diff·계약 정정을 검토했고 로컬 코드/계약 보완을 수락한다. 실제 Storage/운영 수락은 아니다.

소비 후 pending_upload/processing 고착 재현을 바탕으로 기존 120000/130000을 수정하지 않고 새 forward migration과 관련 서버/대역시험/복구계약/고유 결과를 작성할 범위를 허용한다. 먼저 시작보고에 정확한 신규 migration명·복구 전이·락 순서·정상 처리 중 작업과 경합 시 보호책을 명시한다.

단순 consumed 후 시간 경과만으로 살아있는 정상 업로드를 실패 처리하지 않는다. 처리 최장시간/기존 타임아웃을 근거로 stall 기준 하한·상한을 설정하고, 정상 completion·cancel·복구 간 잠금/버전 경합과 늦게 도착한 완료의 ready 덮어쓰기/파일 삭제 오판을 방지한다. 기존 처리 흐름상 안전한 판별이 불가능하면 먼저 최소 lease/소유권/조건부 전이 설계를 Master에 제안하고 구현을 그 부분에서 기다린다. 독립 분석은 계속한다.

service_role 전용 bounded RPC, 권한 거부, 대상 소유자/버전·상태 검증, ready/failed/archived 및 신규 정상 처리 비대상, 반복 실행 멱등성, pending 상한 회복을 시험한다. Storage 원본/변형 자동삭제·실제 Cron 실행은 이번 범위 아님. 후속 sweep/호출주체는 공백으로 기록한다. 위험한 경합을 단일연결 PGlite로 실동시 검증했다고 하지 않는다.

허용: 신규 supabase/migrations/*.sql 1개, 관련 media 서버/독립 러너/서버시험, 복구 계약 문서/고유 결과. Front/API 공개계약/package/config/auth 수정은 별도조정. 실제 DB적용/배포/bucket생성/게시 없음. 전체 migration 회귀와 영향시험, 타입/lint 근거를 results/BE-UPLOAD-RECOVERY-030-CC-BACKEND-01.md로 반환한다. 새결함/검사실패를 기대값 완화로 숨기지 않는다.
