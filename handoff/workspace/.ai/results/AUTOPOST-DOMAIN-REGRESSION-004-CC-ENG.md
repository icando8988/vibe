# AUTOPOST-DOMAIN-REGRESSION-004 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_bae404328271 / dispatch ctx_5252a9592d35 · 2026-11-17 · 상태: **ready_review**

## 결론
- `tests/distribution`에서 실패하던 41건(파일 4개)을 실제로 재현했다.
- 원인은 4가지였고, **모두 M2·manual 계약이 바뀐 뒤 갱신되지 않은 기대값과 테스트 데이터**였다.
- 현행 구현(`web/src/lib/distribution/**`)과 M2 SQL을 대조한 결과 **구현 결함은 찾지 못했다.** 따라서 구현 코드는 바꾸지 않았다.
- 고친 테스트는 요구사항을 약화하지 않는다. 시험 대상을 계약상 유효한 입력으로 옮기고, 새 계약을 확인하는 단언을 **추가**했다.
- 테스트 삭제·skip은 0건이다.

**중요 발견:** `qa-boundaries` 36건과 `qa-decisions` 전체(모듈 로드 실패로 0 test)는 이전까지 **원래 검사하려던 경계값에 닿기 전에** `MODE_MISMATCH`에서 끝나고 있었다. 즉 시각 검증·날짜·시도 횟수·늦은 결과 같은 QA 회귀 시험이 사실상 꺼져 있었다. 수정 후에는 이 시험들이 실제로 실행되고, 모두 통과한다(구현의 경계값 처리는 정상).

## 원인별 분류와 계약 근거

| # | 증상 | 영향 시험 | 분류 | 계약 근거 | 수정 |
|---|---|---|---|---|---|
| R1 | `MODE_MISMATCH: blog 채널은 live 모드를 쓸 수 없습니다` | adapters-utm 2, jobs 1("다른 채널·dry-run은 별도 키"), qa-boundaries 36, qa-decisions 모듈 로드 실패 | 기대값 노후 | `types.ts` `CHANNEL_MODES`(blog=manual/dry_run). M2 `distribution_create_job`의 `mode % is not allowed for channel %`(check_violation), `distribution_jobs_blog_modes` | live를 검사하는 시험의 채널을 live가 허용되는 threads로 바꿨다(다른 채널 비교는 instagram). blog live·threads manual 거절과 blog manual → manual_ready를 확인하는 시험을 **추가** |
| R2 | 부재 확인(confirmed_absent) 뒤 `retryFailed` → `RETRY_NOT_ALLOWED` | jobs "대사…" | 기대값 노후 | DEC-AUTOPOST-DATA-001 D2, M2 `distribution_approve_rerun`. 부재 확인은 operator_only이고 자동 재시도 허가가 아니다. 재실행은 대사 기록을 인용해야 한다 | 기대를 "retryFailed 거절 + approveRerun(대사 ID 일치)만 허용"으로 바꿨다. 다른 대사 ID는 `RECONCILE_REQUIRED`이며 이것도 **추가 확인** |
| R3 | retryable 실패 뒤 `retryFailed` → `RETRY_NOT_ALLOWED` | jobs "retryable 실패는 최대 시도…", qa-boundaries D5, qa-decisions #2 | 기대값 노후 | M2 retry_policy: auto는 게시 요청 전 실패에만. 요청 여부를 모르면 operator_only(`retry-policy.ts classifyFailure`, `ApplyResultOptions.publishRequested`) | 해당 시험에 `publishRequested:false`를 명시했다(자동 재시도가 가능한 실제 상황). "게시 요청 이후·모름 → operator_only, 자동 재시도 거절" 시험을 **추가** |
| R4 | 요약 시험의 blog 작업이 `mode:"live"`(계약상 존재할 수 없는 행) | qa-decisions #5 | 테스트 데이터 노후 | M2 CHANNEL_MODES, `summarize()`는 live+manual을 실제 게시 대상으로 셈 | blog 행을 manual 모드·manual 키로 바꿨다. 기대 결과(published·failed 채널, overall)는 그대로 |
| R5 | qa-boundaries D4: 정책 때문에 거절되어, 시도 횟수 오염 때문인지 구분되지 않음 | qa-boundaries D4 | 시험 약점 보강 | `autoRetryEligibility` | 실패 데이터를 auto 정책(`autoRetry:true`, `retryPolicy:"auto"`)으로 만들어, 거절 사유가 시도 횟수 오염(`INVALID_INPUT`/`RETRY_NOT_ALLOWED`)임을 확인 |

모든 변경 위치에 `REGRESSION-004` 주석과 근거를 남겼다.

## 변경 파일
- `web/tests/distribution/adapters-utm.test.ts`: liveDraft(threads), 채널별 허용 모드 시험 추가
- `web/tests/distribution/jobs.test.ts`: instagram 비교, D2 재실행 흐름, publishRequested 명시, operator_only 시험 추가
- `web/tests/distribution/qa-boundaries.test.ts`: 기본 채널 threads, 비교 채널 instagram, D4 보강, D5 publishRequested
- `web/tests/distribution/qa-decisions.test.ts`: 기본 채널 threads, preview 채널, #2 publishRequested, #5 blog=manual
- `web/src/lib/distribution/**`: **변경 없음**(결함 없음)

## 실행 명령과 종료코드 (D:/Vibe/web)
| 명령 | 결과 |
|---|---|
| `npx vitest run tests/distribution`(수정 전 재현) | 실패 — 41 failed + qa-decisions 모듈 로드 실패 |
| `npx vitest run tests/distribution`(수정 후) | 0 — 7 files / 189 tests |
| `npm.cmd test`(전체) | **0 — 14 files / 308 tests 통과**(이전 267 중 41 실패. qa-decisions가 이제 로드되고 추가 시험도 포함되어 총수 증가) |
| `npm.cmd run typecheck` | 0 |
| `npm.cmd run lint` | 0(경고 2건은 원본 확장 코드의 미사용 변수, 기존과 같음) |
| `npm.cmd run build` | 0 |

## 이전 보고 정정
- 이전 보고들(SERVER-BRIDGE-PLAN-001 §0 B1, SOURCE-PORT-001 "미연결 한계")의 "로컬 DB 실행기 없음 / SQL 실행 검증 0건"은 **최신 사실이 아니다.**
- `.ai/results/AUTOPOST-LOCAL-DB-VERIFY-002-CC-ENG.md` 기준: Supabase 대역 + PGlite 환경에서 migration 6개를 순차 적용했고, **시나리오 203/203이 통과**했다.
- 실제 Supabase(서울) 적용·검증은 여전히 하지 않았다(미검증 유지).

## 범위 준수
- SQL, 확장, UI, package, env, 키, 공용 문서는 수정하지 않았다.
- 네트워크, 실DB, 게시, commit, push는 없다.
- 이 작업은 다음 Blog 토큰·작업 API 구현 전의 품질 작업이다.
