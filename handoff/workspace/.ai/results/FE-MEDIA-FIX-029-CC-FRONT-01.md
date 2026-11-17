# FE-MEDIA-FIX-029 — Claude(Front) CC-FRONT-01 결과

상태: **ready_review** — 코드/대역(mock·서버 렌더 문자열) 기준. 브라우저·운영 수락 아님(승인 admin 세션·실DB·Storage 없음). commit·배포 없음.
지시: Master task_5842ab86d0ab / dispatch ctx_81955503ea62, 지시서 `.ai/tasks/FE-MEDIA-FIX-029.md`. 입력: DESIGN-MEDIA-RESUME-028 D028-01~05, FE-MEDIA-RESUME-027 결과. 착수·범위 회신 msg_0fc898db9d7e.
사용자 직접지시 충돌 없음. Backend/API/SQL/package/globals/config/auth·ConsoleShell 미수정. 업로드 비활성 유지. React best-practices 스킬은 이 세션에 설치돼 있지 않아 적용하지 못함(기존 패턴: 서버 컴포넌트에서 시계 읽지 않음·클라이언트 경계 최소 유지는 따름).

## 1. 반영 내용
| 항목 | 수정 |
|---|---|
| D028-01 | `MediaGateNotice`(media-forms.tsx) — 두 미디어 페이지의 `gateNotice`로만 사용. 조회 성공일 때만 "조회·권리 결정·보관은 실제 서버에 저장", 준비 전/권한 없음/조회 오류/잘못된 ID(`not_loaded`)는 저장을 약속하지 않음. 업로드 비활성·실제 게시 gate 닫힘은 항상 표시. 공용 ConsoleShell 기본 안내 불변 |
| D028-02 | 공용 `WriteNoticeView`에 선택 `overrides`(코드별 tone/title/body/extra), `ActionForm`에 선택 `noticeOverrides` 전달만 추가. 미디어 폼이 자산 문맥 문구로 conflict_version/archived/invalid_transition/not_found/invalid를 덮어씀. 충돌: "입력은 남아 있지만 새로 고치면 사라질 수 있음 → 복사 → **새 탭**에서 최신 상태 확인 → 이 화면 새로 불러와 다시 결정, 자동 재저장 없음" + 자산 상세 새 탭 링크(rel=noopener). expectedVersion 자동 갱신·재제출 없음. 027의 `media:<code>` fields 보충은 중복이라 제거 |
| D028-03 | 미디어 invalid 문구를 실제 규칙으로: 권리 = "허용 채널 1개 이상, 유효기한 비우거나 날짜·시각 모두, 사유는 선택·최대 1000자·줄바꿈/탭 없이 한 줄", 보관 = "되돌릴 수 없음 확인 체크". 사유 라벨에 "선택" 명시(required 없음, 정책 불변) |
| D028-04 | `noteFieldError`(action-state.ts): 1000 코드포인트 초과 또는 C0(줄바꿈·탭·CR 포함)·DEL·C1 제어문자 → 서비스 호출 전 `invalid`/`note`. 정제·필수화 없음, 입력은 ActionForm이 유지, markInvalidFields로 note에 aria-invalid·초점. textarea에 힌트 `aria-describedby` 연결 |
| D028-05 | "원본 파일은 저장하지 않습니다" 단정 제거 → 업로드 패널 "업로드가 열리면 원본은 비공개 임시 저장소에 보관해 처리한 뒤 삭제를 시도, 삭제 실패·만료·취소로 남은 원본 정리 작업은 아직 없음", 상세 "원본은 화면에 표시하지 않음 · 처리 뒤 임시 저장소에서 삭제 시도, 정리 작업 없음". 비활성 사유 "최종 인수·실제 저장소 연결 검증 전" |
| M025-01 대조 | Design 지적대로 `.mediaForm fieldset.choiceGroup`(0,2,1)이 공용 규칙과 같아 순서 의존 → `.choiceGroup.choiceGroup`(0,3,1)로 상향, 주석 정정 |
| 핵심 회귀(5) | 실제 action 실행 + 서비스 mock: 승인 잘못된 기한 3종 거부·서비스 미호출 / 반려·철회는 잘못된 잔존 기한·채널을 막지 않고 미전송 / 보관·권리 결정 모두 **제출 ID ≠ 서버 반환 ID**로 redirect·revalidate가 서버 ID만 사용 / 사유 제어문자·1001자 거부, 1000자·빈 값 통과 / 충돌 1회 호출·redirect 없음·버전 유지 |

## 2. 변경 파일
`src/components/distribution-console/write-notice-view.tsx`(선택 overrides·type export, TEXT 불변), `action-form.tsx`(선택 noticeOverrides 전달만), `media-forms.tsx`, `media-asset-detail.tsx`, `media-labels.ts`(027의 media: 라벨 제거 → HEAD와 동일), `media.module.css`, `src/app/admin/distribution/media/{page.tsx,[assetId]/page.tsx,actions.ts,action-state.ts}`, `tests/distribution-front/{media-ui,media-actions}.test.ts`, 이 결과.
공용 소비자 영향: overrides/noticeOverrides 미지정 시 기존과 동일 렌더(시험: overrides 없는 conflict_version·invalid 공용 문구 유지, 덮어쓰지 않은 uncertain 공용 문구 유지). ActionForm 다른 소비자 9개 페이지는 prop을 주지 않음.

## 3. 검증 (Node 24.22.3, PGLITE_PROJECT=%TEMP%\vibe-resume-20261117)
| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run tests/distribution-front` | 0 | 2 files 통과(media-ui 33·media-actions 포함) |
| `npx vitest run`(전체, PGlite 포함) | 0 | **37 files · 644 passed · skip 0** |
| `npm run lint` | 0 | 오류 0 / 기존 경고 3 |
| `npm run typecheck` | 0 | |
| `npm run build` | 0 | 공용 클라이언트 prop 변경 확인용, media·upload 라우트 빌드 |
전체 시험에는 Backend의 진행 중 업로드 변경(upload.ts·upload 시험)이 작업 트리에 함께 포함됨 — Front 미수정.
시험 기대값 변경: 027의 `media:<code>` fields 기대(media-actions 2곳·media-ui 1개)를 D028-02 중복 제거에 맞춰 `fields: []`로, 상세 "원본 파일은 저장하지 않음" 단언을 D028-05 문구로 교체. 검사 약화 아님(대신 overrides 렌더·원문 문구 부재·저장 단정 부재를 새로 단언).

## 4. 실측/미실측
- 미실측: 브라우저(320/700/960/확대), 키보드(Tab·방향키·Space·Enter), 화면낭독기, 체크박스·fieldset computed style, 새 탭 링크·충돌 왕복 후 입력 유지, 실제 DB 거절(note 제어문자 SQL 22023)과 Front 사전검사 일치. 인증 우회 없음.
- 대역: 서버 렌더 문자열, 순수 함수, next/cache·navigation·서비스 mock.

## 5. 남은 문제·결정
- Front 제어문자 범위(C0·DEL·C1)는 PostgreSQL `[[:cntrl:]]`의 보수적 근사. DB 로캘별 정확한 집합은 실DB에서 확인 필요(차이가 나도 서버가 최종 거절, 그때는 일반 invalid 안내).
- 충돌 시 새 탭 링크는 `target=_blank` — 사용자가 탭 이동을 원치 않으면 Design 실측 후 조정.
- 업로드 후속 계획(027 결과 §7) 정본 대조 갱신: grant 응답 필드 `grantExpiresAt`(기본 900초, 완료·취소 접수 기한)·`storageTokenDocumentedTtlSeconds`(7200, 참고값) 사용, 사용자 재전송 가능한 complete 응답은 `not_uploaded`·`storage_error`·**`unavailable`**(모두 grant 미소비), `uncertain`은 목록 확인만, cancel `unavailable`은 사용자 재취소 가능, `failed.code`에 `DECLARED_MISMATCH` 라벨 추가 필요, PUT의 `apikey` 헤더 필요 여부 미검증 → 실환경 확인 전 활성 금지. 활성화 시 원본 안내는 이번 D028-05 문구를 그대로 사용.
- Master: 통합검토, Design 새 해시 기준 재검토, 승인 admin 실측 환경 준비 판단.

## 6. SHA-256 (작성 시점)
| 파일 | SHA-256 |
|---|---|
| src/app/admin/distribution/media/actions.ts | 1685ad43a8253418a4b41a09f00b67603cfda48e137198e9b2fe57f689da96bd |
| src/app/admin/distribution/media/action-state.ts | a571a0ebf796648d466dd1bff963ffe19534d1ef1356e10d8e3db2c593ac23bd |
| src/app/admin/distribution/media/load.ts | 670e8285e597933e3079990594f9a55549a070c16eb0f08bd06f80e153539d8b |
| src/app/admin/distribution/media/page.tsx | b7863589b1cbebfe809623d02d342f028c7ca134300b42c15319bb61b2d1bc31 |
| src/app/admin/distribution/media/[assetId]/page.tsx | fd943cd741cb5cac4e086b86f2068e1ee587579e378f694246e103a0355f39cc |
| src/components/distribution-console/media-forms.tsx | 9fa26f5c48828a1f1e6a7f7389c5821004acaf240210e228753251a0eb89e3ef |
| src/components/distribution-console/media-asset-detail.tsx | df8b9ca1a1821790f24ee18b03a1e0872a1f8e6bdaee8da384cdc8fe16a79a28 |
| src/components/distribution-console/media-asset-list.tsx | ced6eec4dfd7bd9cc5e8a327700d1736198689689acd6c72eda16c60453fd310 |
| src/components/distribution-console/media-labels.ts | 36269a0148f2b30b18ab0423b8fac9d6e5bdfd392c6ba8c441e66b8155dc75cd |
| src/components/distribution-console/media.module.css | e8bd7854d243d66d988c392874877dd4dfa30dbf69b6e3a195b9b7be41265629 |
| src/components/distribution-console/action-form.tsx | 3c652fe5480c0d8eb8724db7bcb8d7d601f8045229817fb3a915f8e2712a42b5 |
| src/components/distribution-console/write-notice-view.tsx | 0221b8a75ae43aa29e9f33e7aaed0ff8ed8e50c398cd48ab0653f4dea5a422f2 |
| tests/distribution-front/media-ui.test.ts | e0502d8215908830851d7ceeaab14c68489c13b389ba559e075376748a78c965 |
| tests/distribution-front/media-actions.test.ts | 15c2cc99b49de5da5ea4d835c48154f2d4b529c2b3372a31950b898edc3483e2 |
