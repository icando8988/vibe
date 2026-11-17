# FE-MEDIA-NOTICE-032 — Claude(Front) CC-FRONT-01 결과

상태: **ready_review** — 코드·서버 렌더 문자열·순수 함수 기준. 브라우저·운영 수락 아님. commit·배포 없음.

## 실행 경로 구분
- 지시서: `.ai/tasks/FE-MEDIA-NOTICE-032.md`, 입력 `results/DESIGN-MEDIA-RECHECK-031-CX-DESIGN-01.md` R031-01/02.
- **실패 dispatch(미사용)**: task_260386b2e095 / ctx_3efb3b16ba87 — 별도 dispatch가 agent-hooks-review-prompt로 미착수 실패한 기록. 재시작·hooks 설정/검토 우회 없음.
- **실제 실행 경로**: 기존 정상 대화 term_6cc6dbb5-064f-408b-99d5-54a370e35f50(CC-FRONT-01). 사용자 직접 지시로 다음 작업을 요청했고, 실행 가능 보고 후 Master가 이 대화에서 착수를 승인함(orchestration ask 답변). 새 Task/세션 생성 없음. 저장소에 `.claude` 프로젝트 hooks 설정 없음 확인.
- 공용 ActionForm/WriteNoticeView 추가 변경 없음(기존 선택 `overrides`만 사용). Backend/API/SQL/package/config/auth/globals 미수정. 업로드 비활성 유지. 기존 미커밋 변경 보존.

## 수정
| 항목 | 내용 |
|---|---|
| R031-01 | `mediaPageNotice(v)`(media-labels.ts, 순수): 쿼리 notice는 `saved`만 수락(배열이면 첫 값), 그 외 코드·빈값·대소문자 다름·비문자열은 null → 렌더 없음. 두 페이지가 `<WriteNoticeView notice={mediaPageNotice(sp.notice)} overrides={MEDIA_PAGE_NOTICE_OVERRIDES} />`로 연결. saved 문구는 "요청을 마치고 화면을 다시 불러왔습니다 / 결과는 아래에 서버에서 다시 불러온 자산 상태로 확인하세요" — 쿼리를 저장의 독립 증거로 단정하지 않음, 자산 링크 생성 없음 |
| R031-02 | `ARCHIVE_INVALID_BODY` 중립화: "보관하지 않았습니다. 아래 '확인할 항목'에 표시된 항목이나 거절 사유를 확인하세요." `ARCHIVE_FIELD_LABELS` 분리: `confirmArchive` = "보관 확인('되돌릴 수 없음' 체크 필요)", ASSET_REFERENCED는 기존 `reason:asset_referenced` 라벨("채널 초안이 쓰는 자산이라 보관할 수 없음"). 참조/보관 제약 변경 없음 |

변경 파일(이번 작업분): `src/app/admin/distribution/media/page.tsx`, `src/app/admin/distribution/media/[assetId]/page.tsx`(import·notice 연결 1줄씩), `src/components/distribution-console/media-forms.tsx`(ARCHIVE_INVALID_BODY·ARCHIVE_FIELD_LABELS·MEDIA_PAGE_NOTICE_OVERRIDES), `media-labels.ts`(mediaPageNotice), `tests/distribution-front/media-ui.test.ts`(시험 4개 추가, 029의 보관 invalid 단언 1곳을 중립 문구로 교체), 이 결과.

## 검증 (Node 24.22.3, PGLITE_PROJECT=%TEMP%\vibe-resume-20261117)
| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run`(전체, PGlite 포함) | 0 | **38 files · 657 passed · skip 0** (파일 수 증가는 작업 트리의 Backend 진행분 포함) |
| `npm run lint` | 0 | 오류 0 / 기존 경고 3 |
| `npm run typecheck` | 0 | |
| `npm run build` | 생략 | 지시서 허용(신규 클라이언트 경계·공용 변경 없음, 029에서 build 0 확인) |
추가 시험: 쿼리 notice 허용/거부 11종 렌더 없음 · saved 문구 단정 없음·링크 없음·원문/초안 없음 · 두 페이지 연결(원 쿼리 직접 전달 없음) · 체크 누락 vs ASSET_REFERENCED 요약 분리(거절 요약에 "체크" 없음)·공통 본문 체크 단정 없음·폼이 라벨 상수 사용.

## 실측/미실측
- 미실측: 승인 admin 브라우저(쿼리 직접 입력 후 화면, 보관 거절 왕복), 화면낭독기, 반응형. 인증 우회 없음.

## 남은 문제
- ActionForm 요약 문구 조합은 시험에서 동일 규칙(`fieldLabels[f] ?? f`)으로 재현해 검사 — 실제 클라이언트 렌더 왕복은 브라우저 실측 필요.
- 업로드 활성화·원문/리비전 미디어 선택은 범위 밖(후속 지시 대기).

## SHA-256 (작성 시점)
| 파일 | SHA-256 |
|---|---|
| src/app/admin/distribution/media/page.tsx | 2e13be64d41a0202dc20518f210bbcc25183fb1bc98934c2b184087a54f919ae |
| src/app/admin/distribution/media/[assetId]/page.tsx | 8c0955a58810225e7924e4e627515058e56c29d2369c6b692c5bed31975e3ea5 |
| src/components/distribution-console/media-forms.tsx | a388db06f746070f8db9617febee5e4a4a2730aeda02a3337bbd2848996fc4c8 |
| src/components/distribution-console/media-labels.ts | 02342d4fabae6269cda62fadf03e1f51d082c810b78a96bab1bc4d5d7b081853 |
| tests/distribution-front/media-ui.test.ts | f4307dace2dd3b6465da44396224b436536498dfee9b0562794d3fe02754e90a |
