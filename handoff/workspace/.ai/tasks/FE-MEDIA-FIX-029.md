# FE-MEDIA-FIX-029 — Design 결과 반영 및 동작 회귀 보강

책임 CC-FRONT-01, Master 후속배정. 작업 경로 D:/VIBE/vibe-github. 기존 FE-MEDIA-RESUME-027 변경과 media-actions.test.ts 기대값 변경은 검토 결과 수락한다(검사 약화 없이 미디어 안내/조회오류 계약 반영). 최종 통합은 아래 보완 후다.

입력: results/DESIGN-MEDIA-RESUME-028-CX-DESIGN-01.md D028-01~05 및 본인 결과. .ai 기준 경로는 handoff/workspace/.ai.

1. D028-01: 두 미디어 페이지 gateNotice를 실제 metadata 연결/업로드 비활성/게시 gate 상태와 일치시킨다. 공용 ConsoleShell 기본 안내는 변경하지 않는다.
2. D028-02/03: 미디어 전용 오류 문구로 원문/초안/승인 체크리스트 안내의 중복·불일치를 해소한다. 충돌 시 입력 복사 후 수동 최신 상태 확인 동선을 제공하고 새로고침의 입력유실 가능성을 밝힌다. 자동 새버전 덮어쓰기/재제출 금지.
3. D028-04: 사유의 SQL 금지 제어문자를 액션에서 note 필드 오류로 안내(줄바꿈/탭 등)하고 입력을 보존한다. 필수화/무단 정제/SQL 약화 없음. 1000자 정책과 일치시킨다.
4. D028-05: 업로드 비활성 상태에서도 원본 미저장 단정을 private intake 임시 보관·처리후 삭제 시도·정리 공백에 맞게 수정한다. 업로드 활성화는 여전히 보류. Backend 계약이 grantExpiresAt/unavailable 재확인 조건 등으로 정정됐으니 후속 계획도 정본과 대조한다.
5. 핵심 동작 회귀: 승인일 때 잘못된 기한은 거부, 반려/철회 때 잘못된 잔존기한은 차단하지 않음. archive redirect/revalidate는 제출 ID와 서버 반환 ID를 다르게 두어 서버 ID 사용을 검증한다. 문자열 소스 비교로만 검증하지 않는다.

허용범위: 기존 Front 미디어 페이지/액션/전용 UI/CSS/시험과 고유 결과. Master가 공용 action-form.tsx의 선택 props 최소확장을 추가 허용한다(미디어에서만 사용, 기본값/기존동작 유지). 필요하면 write-notice-view.tsx도 선택 override 인자만 추가 허용하며 공용 TEXT 기본값/다른 페이지 안내는 보존한다. 가능한 작은 확장으로 처리하고 공용 컴포넌트 기존 소비자 회귀를 확인한다. Backend/API/SQL/package/globals/config/auth 수정 금지. 여러 TSX 수정이면 해당 React 스킬 적용.

관련 회귀·typecheck/lint 실행, 공용 영향에 맞는 기존 시험 포함. 변경 없는 전체 빌드 반복은 필수 아님. 고유 results/FE-MEDIA-FIX-029-CC-FRONT-01.md에 수정·검증/exit·실측/미실측·남은 문제를 반환한다. 코드/대역 수락과 운영/브라우저 수락을 구분한다.
