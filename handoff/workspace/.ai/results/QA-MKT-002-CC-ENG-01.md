# QA-MKT-002 — 배포 결과 근거·집계 기술 결정 적용

- 책임 CC-ENG-01 / Master 지시 msg_3fc485e818be, 결정 `.ai/decisions/DEC-DISTRIBUTION-002.md` / 2026-11-16
- 상태: **ready_review**
- 범위: `web/src/lib/distribution/**`, `web/tests/distribution/**`만. UI·content·app·package·DB·공용 .ai는 변경하지 않았다. 새 공급자·저장 계층·계정 기능 없음.

## 결정별 적용

| # | 결정 | 적용 |
|---|---|---|
| 1 | live 결과에 유효한 시도 번호 필수, dry_run은 선택 | `applyResult`: live에서 `attempt` 누락·비정수·0 이하·현재와 다름 → STALE_RESULT. 상태는 바뀌지 않는다. dry_run은 생략하면 기존 동작이고, 주면 같은 검사 |
| 2 | 늦은 게시 근거는 버리지 않고 별도 보존, 대사 필요 | 새 순수 함수 `preserveLateEvidence(job, evidence)` → `LateEvidenceRecord`(사유: job_not_dispatching / older_attempt / attempt_unknown / already_published, conflict, duplicateOfConfirmed, requiresReconciliation). **작업 상태는 바꾸지 않는다.** 현재 시도의 정상 결과는 거절하고 applyResult로 보낸다. 기존 published와 다른 식별자는 conflict=true로 둘 다 보존 |
| 3 | 근거 URL은 null 또는 계정 정보 없는 https | `isValidEvidenceUrl` 공개. http·javascript·data·빈 문자열·계정 정보 포함 → 거절. applyResult·reconcileUnknown·preserveLateEvidence에 공통 적용. 식별자만 있어도 근거로 허용 |
| 4 | 안전한 작업 ID | `isValidJobId`: 영문·숫자로 시작하는 1~128자 `[A-Za-z0-9_.:-]`. `createJob`에서 검사. UI 샘플 `local-job-N` 호환 |
| 5 | 전체 이력 요약과 콘텐츠·버전 요약 분리 | `summarizeBatch`는 기존 의미(받은 작업 전부)를 유지하고 `mixedScope` 필드를 추가(여러 콘텐츠·버전이 섞이면 true). 새 함수 `summarizeContentVersion(jobs, { contentId, contentVersion })`는 해당 버전만 센다 |

## 저장 계층 미구현 — 보장이 아니라 계약

`preserveLateEvidence`는 판정과 기록 형태만 만든다. 다음은 아직 아무것도 실제로 보장하지 않으며, 저장 계층을 구현할 때 지켜야 할 계약이다.

- 기록의 영구 저장과 감사 로그
- `requiresReconciliation=true`인 작업의 재시도·재게시 차단
- 운영자 수동 대사 절차

현재 `retryFailed`는 늦은 근거 기록의 존재를 알 수 없다.

## 변경 파일

- `src/lib/distribution/jobs.ts`: 시도 번호 필수 검증, `isValidEvidenceUrl`, `isValidJobId`, `summarizeContentVersion`, `summarizeBatch.mixedScope`
- `src/lib/distribution/late-evidence.ts`(신규), `index.ts` export
- `tests/distribution/qa-decisions.test.ts`(신규, 39 tests)
- 기존 시험(`jobs`, `adapters-utm`, `qa-boundaries`): live 결과 반영 호출에 현재 시도 번호를 넘기도록 호출부만 수정(`applyLive` 헬퍼). 기대값은 바꾸지 않았다.

## 검증

| 명령 | 결과 |
|---|---|
| `npm.cmd run typecheck` | exit 0 (Design `content-distribution-preview.tsx` 포함 — 계약 호환) |
| `npm.cmd test` | exit 0, 10 files / **186 tests** (+39) |
| `npm.cmd run lint` | exit 0 |

미실행: 실제 공급자·외부 게시·저장 계층 시험(범위 밖), 브라우저 UI 재확인(UI 코드 변경 없음).

## 호환성 메모

- UI는 dry_run만 쓰고 `applyResult`를 인자 2개로 호출 → 영향 없음.
- live 결과를 반영하는 미래 실행기는 `{ attempt: job.attempts }`를 반드시 넘겨야 한다. 넘기지 않으면 의도적으로 STALE_RESULT가 된다.
- 주제 범위 밖 미해결: UI 제안 U-01·U-02(Design)는 그대로 남아 있다.
