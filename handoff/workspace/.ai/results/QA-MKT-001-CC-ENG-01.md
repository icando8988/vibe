# QA-MKT-001 — 마케팅 로직 결함 검토

- 책임 CC-ENG-01 / Master 지시 msg_6a6ee50722f5 및 .ai/tasks/QA-MKT-001-CC-ENG-01.md / 2026-11-16
- 상태: **ready_review**
- 검토 성격: `lib/distribution`은 자기 작성 코드라 **자기 검토**다. Design 컴포넌트와의 계약 검토는 **독립 교차 검토**다.
- 상세: `docs/MARKETING_INTEGRATION_REVIEW.md`

## 결과

재현된 실제 결함 6건을 최소 수정했다.

- D1: 잘못된 현재 시각 허용
- D2: 2월 30일 같은 없는 날짜가 다른 날로 넘어감
- D3: 같은 콘텐츠·채널의 다른 버전이 동시에 진행 → 중복 게시
- D4: 시도 횟수 NaN·범위 오염 시 제한 해제
- D5: 이전 시도의 늦은 결과가 현재 시도에 반영 → 근거 소실·중복 게시 위험
- D6: `javascript:` 게시 근거 주소 허용, 식별자 공백 미정리

결함이 아닌 것으로 확인한 항목도 회귀 시험으로 고정했다: 멱등키 구분자, 모드·채널 오염, 실행 중이 아닌 작업의 결과 반영, unknown 재시도, 옛 승인, UTM 우회.

## 변경

- `web/src/lib/distribution/jobs.ts`: 엄격 시각 파서, now·시도 횟수·근거 주소 검증, `applyResult` 선택 인자 `{ attempt }`
- `web/src/lib/distribution/idempotency.ts`: 끝나지 않은 다른 버전 live 작업 차단
- `web/src/lib/distribution/result.ts`: `STALE_RESULT` 추가
- `web/tests/distribution/qa-boundaries.test.ts` (37 tests)
- `docs/MARKETING_INTEGRATION_REVIEW.md`, 이 파일

공통 타입은 Design 컴포넌트와 호환된다(typecheck 통과, 기존 2인자 호출 유지). content·app·components·styles·package·DB·마케팅 원고·공용 .ai는 변경하지 않았다. 임시 확인용 시험은 삭제했다.

## 검증

typecheck exit 0 · test 9 files / 147 passed · lint exit 0.

## 남은 일

- UI 제안(Design): U-01 원시 상태값 라벨, U-02 오류 코드 안내 문구.
- Master 결정: 늦게 도착한 published 근거를 받을 경로, 여러 버전 요약 방식, https 한정 여부, 작업 id 검증.
- 실제 실행기를 연결할 때 `applyResult`에 `{ attempt }`를 반드시 넘긴다.
