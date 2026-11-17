# FE-MEDIA-NOTICE-032 — 잔존 미디어 안내 2건 마무리

담당 기존 CC-FRONT-01, Master 후속배정. D:/VIBE/vibe-github. FE-MEDIA-FIX-029의 기존 개선 및644pass 검증 수락. 입력 results/DESIGN-MEDIA-RECHECK-031-CX-DESIGN-01.md의 R031-01/02(.ai는 handoff/workspace/.ai).

1. R031-01: 목록/상세의 query notice도 미디어 문맥으로 제한한다. 정상 action redirect는 saved뿐이므로 페이지 수준 notice는 saved만 수락하는 최소안으로 진행해도 된다. 쿼리 문구를 실제 서버 저장의 독립 증거로 간주하지 않는다. 미지원 notice는 공용 원문/초안/체크리스트 안내로 흘리지 않는다. 임의 자산 링크를 생성하지 않는다.
2. R031-02: ARCHIVE_INVALID_BODY를 확인항목/서버 거절사유를 확인하는 중립 문구로 바꾼다. 체크 누락은 confirmArchive 필드라벨, ASSET_REFERENCED는 기존 사유라벨로 정확히 안내하도록 한다. 이미 체크한 사용자에게 다시 체크하라고 단정하지 않는다. 참조/보관 제약 변경 없음.

허용: 두 media 페이지, 전용 media-forms/labels/필요한 작은 순수 helper, 관련 Front 시험, 고유 결과. 공용 ActionForm/WriteNoticeView 추가변경은 이번 두 항목에 필요 없으므로 피한다. Backend/API/SQL/package/config/auth/globals 수정 금지. 업로드 비활성. 기존 미커밋 변경 보존.

관련 UI/액션 회귀·타입/lint 적정검증, 전체build 반복은 신규 우려 없으면 생략 가능. query notice 필터와 보관확인 누락/참조자산 거절의 복합안내가 구분되는지 기존 시험을 적절히 보완한다. results/FE-MEDIA-NOTICE-032-CC-FRONT-01.md로 diff·명령/exit·실측여부·남은문제 보고, worker_done 반환. 새 기능 확대 없이 이 2건만 마무리한다.
