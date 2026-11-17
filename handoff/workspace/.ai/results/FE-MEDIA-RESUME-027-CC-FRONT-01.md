# FE-MEDIA-RESUME-027 — Claude(Front) CC-FRONT-01 결과

상태: **ready_review** (Master 통합검토 전). 운영 완료 아님 — 실제 DB·Storage·승인 admin 브라우저 실측 없음, 배포·commit 없음.
지시: Codex master task_cf456f812b75 / dispatch ctx_019525d0f8db. 착수 보고 msg_bcfd45377744. 기준선 main 8f0691c + FE-MEDIA-024 중간 보존본.
사용자 직접지시 충돌 없음. Backend/API/SQL/OAuth/package/lock/globals/config/공통auth/TEAM/공통히스토리·공용 action-form·write-notice(-view) 미수정.

## 1. 인수 시점 확인
FE-MEDIA-024 보존본에는 이미 실제 연결이 있었다: `media/load.ts`(mediaReadiness→listAssets), `media/actions.ts`(decideRights·archiveAsset), 두 페이지 연결, Design M025-01~05 반영(체크박스 분리 CSS, 보관 우선 안내, 미지 실패코드 비노출, 목록 링크 dc-action+전체 ID 이름+표 스크롤 region, 비활성 사유 aria-describedby, ActionForm의 선택 props `errorSummaryId`·`markInvalidFields`는 8f0691c에 이미 커밋됨). 이번 작업은 현재 코드 대조 후 남은 빈틈 수정.

## 2. 변경 파일
| 파일 | 변경 |
|---|---|
| `src/app/admin/distribution/media/action-state.ts` (신규) | 실패→폼 상태 순수 판정 `mediaFailState`, `kstToIso`, `intOf` 분리("use server" 파일은 async만 export → 시험 가능하게) |
| `src/app/admin/distribution/media/actions.ts` | action-state 사용. ① 유효기한은 **승인일 때만** 검사(반려·철회 때 남은 값으로 막히던 문제) ② 보관 성공 redirect를 입력 assetId가 아닌 **서버 응답 asset.id**로, 상세 경로 revalidate 추가 |
| `src/app/admin/distribution/media/load.ts` | 조회 오류 종류 구분: `unavailable`(응답 유실)·`bad_response`(형식 이상)·`db`(거절). 모두 0건 아님 |
| `src/components/distribution-console/media-asset-list.tsx` | `MediaListView.error.kind`(선택) + 종류별 안내 문구 |
| `src/components/distribution-console/media-labels.ts` | 공용 안내 문구가 원문·작업 기준("원문이 이미 새 버전…", "보관된 원문·초안")이라 미디어 문맥 보충 라벨 `media:conflict_version/archived/invalid_transition/not_found` 추가 |
| `src/components/distribution-console/media.module.css` | 중복 `inline-size` 선언 정리(동작 동일) |
| `tests/distribution-front/media-ui.test.ts` | 시험 7개 추가(실패 구분·mediaErrorReason 우선·문맥 보충·KST/버전·오류 종류·rowVersion 보존·actions 정적 경계) → 26개 |
| `tests/distribution-front/media-actions.test.ts` | FE-MEDIA-024 Front 시험의 기대값을 의도한 새 동작(문맥 보충 fields, error kind)에 맞춤. 허용목록에 명시되지 않은 Front 소유 미디어 시험이라 Master 확인 요청 |

## 3. 상태 구분(현재 코드 기준)
- 준비 전(`metadata=false` 또는 not_ready) / 권한 없음 / 조회 오류(3종) / 조회 성공 0건 / 목록 — 서로 다른 화면. 준비 전·오류를 0건으로 표시하지 않음.
- 쓰기 실패: not_ready·denied·invalid(필드 aria-invalid)·확정 거절(`invalid` + `reason:<mediaErrorReason>`)·충돌/전이불가/보관/없음(공용 notice + `media:` 보충)·결과 불명(`bad_response`, `unavailable` → uncertain, 자동 재시도 없음, ActionForm의 "최신 상태 다시 불러오기").
- expectedVersion: 렌더된 rowVersion을 hidden으로 보내고 실패 시 바꾸지 않음(조용한 갱신으로 덮어쓰기 방지). 입력은 ActionForm이 유지.
- ready ≠ 권리 승인: 목록 열·상세 배지·안내 분리, 보관 안내 우선. 권리·보관 폼은 실제 목록 조회 성공일 때만 활성(`upload` 준비도와 무관).

## 4. 검증 (Node 24.22.3, PGLITE_PROJECT=%TEMP%\vibe-resume-20261117)
| 명령 | 결과 |
|---|---|
| `npx vitest run tests/distribution-front/media-ui.test.ts` | exit 0, 26 passed |
| `npx vitest run`(전체, PGlite 포함) | exit 0, **37 files · 631 passed · skip 0** |
| `npm run lint` | exit 0, 오류 0 / 기존 경고 3(background.js·sidepanel.js·m2-run.mjs) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0, `/admin/distribution/media`, `/media/[assetId]` dynamic |
주의: 전체 시험·build는 작업 트리에 함께 있던 Backend BE-UPLOAD-RESUME-026 진행 중 변경(upload.ts·upload 시험·upload-run.mjs·계약 문서)을 포함한 상태에서 실행됨. 해당 파일은 Front가 수정하지 않았다.

## 5. 실측/미실측
- 실측 없음: 승인 admin 세션·실제 Supabase·Storage가 이 환경에 없어 브라우저 실측(320/390/1440, 확대, 키보드·화면낭독기, computed style의 체크박스/fieldset 배치)을 하지 않았다. 인증 우회 코드 없음. 서버 렌더 문자열·순수 함수·mock 단위 시험만.
- Design(DESIGN-MEDIA-RESUME-028 등) 재검토는 위 새 해시 기준으로 필요.

## 6. Backend 의존
- metadata: `media/session.ts`(getMediaMetadataDeps·mediaReadiness), `errors.ts` mediaErrorReason — 확정 계약대로 소비. 실제 서버 키·migration 미적용이면 운영에서는 not_ready 또는 DB 오류가 정상.
- 업로드: BE-UPLOAD-RESUME-026 최종 계약 대기. `mediaReadiness().directUpload` 필드 확정 필요.

## 7. 업로드 후속 계획(이번 미구현 — Master 최종 계약 인수 후 지시 시 진행)
소비 계약: MEDIA_UPLOAD_CONTRACT §3·§6 (grant → 브라우저 PUT → complete/cancel). 업로드 UI는 `directUpload`로만 켠다.
| 예정 파일 | 내용 |
|---|---|
| `src/components/distribution-console/media-upload-form.tsx` (신규, client) | 파일 선택(jpeg/png/webp, 20MB 사전 확인은 안내용·서버 재검사가 최종) + 출처/메모 → `fetch` grant(JSON, same-origin) → `PUT upload.url`(headers 그대로) → complete. 서명 URL·nonce는 **컴포넌트 메모리에만**(state/URL/storage/log 금지), 완료·취소 후 즉시 폐기. 단계 표시(요청→전송→서버 처리) + `aria-live` |
| `src/components/distribution-console/media-upload-labels.ts` (신규) | grant 실패(denied/not_ready/invalid/limit:pending_limit·grant_limit/signing_failed/uncertain/error), complete 상태(ready/failed+code/not_uploaded/grant_used/grant_expired/grant_cancelled/grant_invalid/conflict_version/uncertain/storage_error), cancel 결과 안내 |
| `src/components/distribution-console/media-forms.tsx` | `MediaUploadPanel`에 `directUpload` 분기(비활성 사유 유지), DECLARED_MISMATCH 등 실패코드 라벨은 media-labels에 추가 |
| `src/app/admin/distribution/media/page.tsx`·`load.ts` | readiness의 `directUpload`를 패널에 전달(목록 결과와 독립) |
| `tests/distribution-front/media-upload-ui.test.ts` (신규) | 상태 분기 순수 시험 + fetch mock 흐름 |
재시도 규칙: 사용자 버튼으로만 complete 재시도 — `not_uploaded`·`storage_error`만. `uncertain`(grant·complete)은 목록 새로고침만, 자동 재요청 금지. PUT 4xx/네트워크 오류 → 완료 요청 없이 안내 + 취소 권장. 성공(ready)도 "권리 승인 전 게시 불가"로 안내. 취소해도 서명 URL은 2시간 유효(철회 불가)임을 숨기지 않음. 미확인 전제: PUT에 apikey 헤더 필요 여부(실환경 확인 전 활성 금지).

## 8. Master 할 일
- 이 변경 통합검토, `media-actions.test.ts` 기대값 변경 수락 여부 확인.
- Design 새 해시 기준 재검토 배정, 승인 admin 실측 환경 준비 시 브라우저 실측 배정.
- BE-UPLOAD-RESUME-026 최종 계약 인수 후 §7 업로드 UI 지시.

## 9. 파일 SHA-256 (작성 시점)
| 파일 | SHA-256 |
|---|---|
| src/app/admin/distribution/media/actions.ts | d3dd247bbd6b1ec8ffc665a49ac28051a3c74f61189263cd2af1b6c44b0fc1cd |
| src/app/admin/distribution/media/action-state.ts | daf1238db8dac9400c868f9a8e07780f067287678981402888a5a79e6afb0a32 |
| src/app/admin/distribution/media/load.ts | 670e8285e597933e3079990594f9a55549a070c16eb0f08bd06f80e153539d8b |
| src/app/admin/distribution/media/page.tsx | 2836251130f95a6f501b48fcf04a9b6e7324f79565222905f3cbe9cfd102f624 |
| src/app/admin/distribution/media/[assetId]/page.tsx | 18503da64a2a299aefe8bb50c0ec279836b09cc1f9f9e086228eb6304f62928a |
| src/components/distribution-console/media-asset-list.tsx | ced6eec4dfd7bd9cc5e8a327700d1736198689689acd6c72eda16c60453fd310 |
| src/components/distribution-console/media-asset-detail.tsx | 8e85f26bbeb5407d28dfaa74549900ca273c977347f25e0f599463bd9329a4dc |
| src/components/distribution-console/media-forms.tsx | 5d1a46de1bf6934fbb046114664937785983ef28d2eea596e13b12db58e554db |
| src/components/distribution-console/media-labels.ts | f6c6593858e65bf8615ee57e174aebe8841dfedc2539361b34813fcf09ebd5d3 |
| src/components/distribution-console/media.module.css | 8d9887d7f30bf140051a479ac4c8b762aba2d2fc1fa111b72f22b65e6f69e583 |
| tests/distribution-front/media-ui.test.ts | 53c78644b9470535a01b78089d04d35beec63bc9eeb58e7e8b0322c9e91598ef |
| tests/distribution-front/media-actions.test.ts | 3832c34492a4fb978343c2f776b575888ab0f8babdb32aabec7a328d74dd94eb |
