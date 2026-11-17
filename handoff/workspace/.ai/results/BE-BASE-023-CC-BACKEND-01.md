# BE-BASE-023 — Backend 인수·M4 회귀 복구 결과

- 작업자: Claude(Backend) CC-BACKEND-01 / 지시 msg_c60ad0e6c80a (CX-MASTER-01) / 2026-11-17 / 상태 `ready_review`
- 사용자 직접지시와 충돌: 없음.
- 금지 준수: 기존 SQL·media 구현·Front UI·package/lock·다른 러너·공용 lib(`lib.mjs`) 미수정. M4 검사·FK 완화·SQL 제외·시험 삭제/skip 없음. 비밀·env·실DB·Storage·API·네트워크·게시·commit 없음.

## 1. 수정 파일
| 파일 | 변경 |
|---|---|
| `web/scripts/distribution-local-verify/run.mjs` | 고정 가짜 `ASSET`(3)·`VARIANT` uuid 제거 → 그룹 4 시작 시 현재 M4 RPC(`distribution_create_media_asset` → `distribution_mark_media_received` → `distribution_complete_media_processing`, service_role, U.admin, expected row_version)로 ready 자산 3개 생성, 2번째 자산의 `feed_jpeg` 변형 id를 `VARIANT`로 사용. 각 단계 PASS 기록(12개), 실패 시 이후 중단(exit 1). 나머지 시나리오·기대값 변경 없음 |
| `docs/contracts/MEDIA_FRONT_CONTRACT.md` | 새 문서: Front용 DTO·함수·입출력·준비전·오류 토큰·실 Storage adapter/세션 배선 부재·출처 파생 배포 제약·관찰 |
| `.ai/results/BE-BASE-023-CC-BACKEND-01.md` | 이 파일 |
별도 helper는 만들지 않았다(run.mjs 안 20줄로 충분).

## 2. 원인
120000이 `distribution_draft_revision_media`에 FK(NOT VALID, 이후 INSERT부터 강제)와 `distribution_revision_media_asset_check` 트리거(존재·미보관·ready, 변형 소속)를 추가했다. run.mjs 그룹 4는 존재하지 않는 고정 uuid로 리비전 미디어를 넣어 `MEDIA_NOT_READY`로 중단됐다. M4 검사는 의도된 동작이고 fixture가 낡은 것.

## 3. 검증(환경: Windows, Node, PGlite 기존 임시 설치 `%TEMP%\autopost-local-db-verify-002`, 인메모리 단일 연결, migration 000000~120000 13개 전체 적용)
| 명령 | exit | 결과 |
|---|---|---|
| `node scripts/distribution-local-verify/run.mjs --pglite-project <dir>` | 0 | 222/222 (fixture 12 포함) |
| m2-run | 0 | 334/334 |
| token-run | 0 | 78/78 |
| handoff-run | 0 | 91/91 |
| handoff-review-run | 0 | 105/105 |
| fix006-precheck-run | 0 | 21/21 |
| connections · oauth · threads-connect · blog-flow · content-connect · dry-run-exec · media 러너(vitest) | 0 | 5 · 6 · 3 · 5 · 2 · 7 · 5 passed |
| `npx vitest run` (PGLITE_PROJECT 지정) | 0 | 32 files · 555 passed · skip 0 |
| `npx tsc --noEmit` | 0 | — |
| `npx eslint scripts/distribution-local-verify/run.mjs` | 0 | — |
- 전체 lint·build는 이번 변경(검증 스크립트 1개·문서)과 무관해 재실행하지 않았다.
- PGlite는 단일 연결이며 PostgREST/JWT·다중 연결 경합·실 Storage를 대신하지 않는다.

## 4. 기존 media/runtime 인터페이스 대조 결과(상세는 계약 문서)
- 서버 함수 6개(`listAssets`, `createAndProcessFromBytes`, `processControlledUpload`, `decideRights`, `archiveAsset`, `issuePublishUrl`)와 RPC 8개 이름·인자 일치 확인.
- **런타임 배선 없음**: media용 세션/deps 조립 파일 없음, 실 Supabase Storage adapter 없음(`MediaStorage` 인터페이스 + mock만). `app/admin/distribution/media/**`는 service를 import하지 않는다 → 현재 화면은 자리만.

## 5. 남은 문제·제안(수정하지 않음)
1. M4 오류 토큰(`MEDIA_NOT_READY`·`ASSET_REFERENCED`·`MEDIA_PENDING_LIMIT`·`VARIANT_MISMATCH`·`RIGHTS_*`·`CHANNEL_NOT_ALLOWED`)이 `errors.ts` TOKEN_MAP에 없어 `code`가 `invalid_input`으로 뭉친다. 토큰은 `MappedDbError.token`에 남으므로 Front는 token으로 분기 가능. TOKEN_MAP 추가는 별도 배정 제안.
2. 원문 버전 `media_asset_ids`(uuid[])는 존재·ready 검사가 없다(정적 확인). 원문 미디어 사용 여부 결정 후 검사 추가 여부 판단 필요.
3. 변형 업로드 후 DB 완료 실패 시 Storage 고아 객체 정리 없음.
4. Backend 후속 후보: media 세션 배선(server-only deps) + 실 Storage adapter(운영 키 없이 mock 계약 시험까지), 목록 커서 페이지.
5. 배포: `process.ts`는 키트 참고 파생 → 공개 release 제외 묶음 권장(Master 판단). sharp 네이티브 빌드 배포 환경 확인 필요.
