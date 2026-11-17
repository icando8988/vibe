# 마케팅 배포 로직 결함 검토

QA-MKT-001 · CC-ENG-01 · 2026-11-16.

- **자기 검토:** `web/src/lib/distribution/**`는 이 검토자가 MKT-003에서 작성한 코드다. 독립 검토가 아니다.
- **독립 교차 검토:** `web/src/components/content-distribution-preview.tsx`(Design 작성)와의 계약 검토는 다른 담당 코드에 대한 독립 검토다.
- `lib/content`는 입력으로 읽었고 이번 범위에서 수정하지 않았다.

방법: 임시 확인용 시험으로 결함을 먼저 재현했다(재현 후 삭제). 실제로 재현된 것만 최소 수정했고 회귀 시험을 추가했다(`tests/distribution/qa-boundaries.test.ts`). 공급자 연결·새 패키지·새 기능은 없다.

## 결함과 수정 (모두 재현 확인)

| ID | 결함 | 재현 | 영향 | 기대 결과 / 수정 |
|---|---|---|---|---|
| D1 | 잘못된 현재 시각 허용 | 즉시 실행 작업에 `now="not-a-date"`를 넣으면 생성 성공. `startDispatch(job, "also-bad")`도 성공하고 `lastAttemptAt="also-bad"`로 기록 | 실행 이력·예약 판단 오염 | `createJob`·`startDispatch`·`isDue`가 시간대 있는 ISO만 받도록 수정. 실행 시각은 UTC로 정규화해 기록 |
| D2 | 없는 날짜가 다른 날로 넘어감 | `2027-02-30T00:00:00Z` → `Date.parse`가 3월 2일로 해석해 예약이 받아들여짐(현재 연도 값은 과거라 엉뚱한 사유로 거절) | 의도와 다른 날짜에 게시 | 엄격 파서 `parseZonedTime`(월·일·시·분·초·시간대 범위, 윤년). 범위 밖은 INVALID_INPUT |
| D3 | 같은 콘텐츠·채널의 다른 버전이 동시에 진행 | v1 live 작업이 예약 상태일 때 v2 live 작업 생성 성공(키가 버전별이라 통과) | 같은 채널에 두 버전 모두 게시 | `checkDuplicate`: 같은 콘텐츠·채널에 끝나지 않은 live 작업(scheduled·dispatching·unknown·failed)이 있으면 DUPLICATE. `allowRepublish`로도 우회 불가. 취소·대사 후 생성. dry-run과 다른 채널은 영향 없음 |
| D4 | 시도 횟수 오염 시 제한 해제 | `maxAttempts=NaN, attempts=99`인 작업으로 `startDispatch` 성공(NaN 비교가 항상 false) | 저장소에서 읽은 값이 깨지면 무한 재시도 | `startDispatch`·`retryFailed`가 정수·범위를 검사하고 오염 시 INVALID_INPUT |
| D5 | 이전 시도의 늦은 결과가 현재 시도에 반영 | 1차 실패(retryable) → 재시도 → 2차 실행 중일 때 1차의 늦은 `failed`가 반영됨. 이어서 2차의 `published`는 INVALID_TRANSITION으로 버려짐 | 실제 게시 근거가 사라지고 재시도로 중복 게시될 수 있음 | `applyResult(job, result, { attempt })` 선택 인자 추가. 시도 번호가 다르면 STALE_RESULT. **재시도가 있는 실행기는 반드시 넘겨야 한다.** 인자를 생략하면 기존 동작이라 Design 컴포넌트와 호환 |
| D6 | 게시 근거 값 검증 부족 | `externalUrl="javascript:alert(1)"`로 published 기록. 식별자 앞뒤 공백도 그대로 저장 | 관리 화면이 링크로 그리면 스크립트 실행 위험 | `applyResult`·`reconcileUnknown`: 주소는 http(s)만(아니면 NO_EVIDENCE), 식별자는 공백 정리 |

공통 타입 변경: `DistributionErrorCode`에 `STALE_RESULT` 추가, `applyResult`에 선택 인자 추가, `parseZonedTime` 공개. 기존 호출과 호환된다.

## 확인 결과 정상 (결함 아님)

| 항목 | 확인 |
|---|---|
| 멱등키 구분자 충돌 | 콘텐츠 ID가 `[A-Za-z0-9_-]`만 허용돼 `:` 구분자와 충돌하지 않음 |
| mode·channel 런타임 오염 | `makeIdempotencyKey`가 목록 밖 값 거절. DryRunAdapter는 모드·채널 불일치 거절 |
| 실행 중이 아닌 작업에 결과 반영 | INVALID_TRANSITION으로 거절(회귀 시험 추가) |
| unknown 후 재시도 | 대사 전 재시도·취소 불가, confirmed_absent 뒤에만 재시도(기존 시험) |
| 원문 버전 변경 후 옛 승인 | 생성 시 STALE_DRAFT(기존 시험). 생성 후 버전이 바뀐 경우의 동시 게시는 D3로 막음 |
| UTM 경로 우회·외부 호스트 | `//`·역슬래시·탭·줄바꿈 경로 모두 거절(같은 출처 확인). 회귀 시험 추가 |

## Design UI 계약 교차 검토 (제안만, 수정 안 함)

| ID | 내용 | 중요도 | 제안 |
|---|---|---|---|
| U-01 | 모의 실행 결과에 원시 상태값(`dry_run_succeeded`)이 그대로 보임 | 낮음 | 사람이 읽는 라벨로 바꾸기(제목에는 이미 "모의 실행 완료 · 외부 게시 없음") |
| U-02 | 오류를 `CODE: 메시지`로 그대로 표시 | 낮음 | 코드별 안내 문구로 바꾸기(DUPLICATE·STALE_DRAFT 등) |
| U-03 | `applyResult`를 시도 번호 없이 호출 | 정보 | 모의 실행은 시도가 1회라 문제없음. 실제 실행기 연결 시 `{ attempt }` 필수 |
| U-04 | 모의 결과와 운영 상태 혼동 | 확인 결과 문제 없음 | dry-run 전용 어댑터·모드 사용, "외부 게시 식별자 없음·저장 없음" 표시, 상태 예시는 "실제 사건 아님"으로 분리 |

## 남은 결정 (정책·코드로 확정하지 않음)

1. 취소·실패 처리된 작업에 늦게 도착한 `published` 근거를 어떻게 받을지. 지금은 버려진다(INVALID_TRANSITION). 대사 경로를 failed·cancelled로 넓힐지 Master가 판단.
2. `summarizeBatch`가 같은 채널의 여러 버전 작업을 함께 센다. 재게시 허용 뒤 요약을 최신 버전 기준으로 할지.
3. 게시 근거 주소를 https로만 제한할지(현재 http도 허용).
4. 작업 `id` 형식 검증(현재 호출자 책임).

## 검증

`npm.cmd run typecheck` exit 0 · `npm.cmd test` 9 files / 147 tests(+37) · `npm.cmd run lint` exit 0. 실제 공급자·외부 게시 시험은 범위 밖.
