# FE-CHANNEL-RELEASE-034 — Claude(Front) CC-FRONT-01 결과

상태: **ready_review · 코드 동결**(반환 후 추가 수정 없음). 로컬 코드·서버 렌더 문자열·정적 경로 검사 기준. build·전체 최종검사·commit·push·배포는 Master 담당. 브라우저 조작 없음(배포 후 검증은 Master — Master 대화의 최신 지시는 Chrome).
지시: Master 답변으로 배정(`.ai/tasks/FE-CHANNEL-RELEASE-034.md`), 착수 보고 msg_a1cd01796b8f, 후속 보완 task_acc81e6cd19f / ctx_e75027dff48f(CapabilityTable connected 문구). 기존 대화에서 수행, 새 세션 없음.
비수정: Backend/API/SQL/package/config/auth, WriteNoticeView/ActionForm 공용 안내, 화면별 gateNotice(미디어·Blog 확장·Threads·수동 인계)는 그대로 우선. Instagram OAuth/live worker 신규 구현 없음, disabled 기능 활성화 없음.

## 1. 세 채널 실제 내부 경로·상태 (현재 코드 기준)
| 단계 | 경로 | Blog | Threads | Instagram |
|---|---|---|---|---|
| 진입 | `/me` → `/admin` → `/admin/distribution`(통합 개요) | 공통 | 공통 | 공통 |
| 원문 | `/contents`, `/contents/new`, `/contents/[id]` | 저장·버전·승인 | 동일 | 동일 |
| 채널 초안 | `/contents/[id]/channels/[channel]` | 본문(제목=원문) | 글 | 캡션 — **이미지 첨부 화면 없음**(미디어·권리 링크로 안내) |
| 검토 | `/contents/[id]/channels/[channel]/review` | 승인/반려 | 동일 | 동일 |
| 실행 준비 | `/contents/[id]/prepare` | 수동 게시 작업 생성 | 모의 실행 작업 생성(실행기 없어 실행 안 됨) | 비활성 + 사유 |
| 작업 | `/jobs`, `/jobs/[id]`, `/jobs/[id]/manual`, `/jobs/[id]/reconcile` | 수동 인계·증거·대사 | 모의 실행 작업 조회 | 없음 |
| 연결 | `/connections`, `/connections/blog-extension`, `/connections/threads` | 연결 대상 아님 · 확장 토큰 관리 | 공식 로그인 연결(연결 ≠ 게시 가능) | **OAuth 미구현**(비활성 버튼) |
| 미디어 | `/media`, `/media/[assetId]` | — | — | 처리·권리 조회·권리 결정·보관(업로드 비활성) |
| 실제 게시 | — | 사람이 외부 게시 | live gate 닫힘 | live gate 닫힘 |
고정 `/admin` 내부 링크 전수 대조: 끊긴 링크 0(시험으로 고정).

## 2. 수정
| 파일 | 내용 |
|---|---|
| `src/components/distribution-console/console-shell.tsx` | 기본 gate 안내(화면별 gateNotice 없는 원문·초안·검토·준비·작업·연결·개요 화면) 갱신: 구 "저장·작업 실행 미연결, 입력·버튼 동작 안 함, 실제 결과 아님" → "원문·초안·검토·작업은 연결된 서버에 저장·조회, 준비 전·조회 오류는 화면마다 표시 / 자동 게시 닫힘, Blog 수동+증거, Threads 연결·모의 실행 작업까지, Instagram 초안·검토·미디어 권리까지". gateNotice prop 우선순위 불변 |
| `src/components/distribution-console/readiness.ts` | CHANNEL_INFO 문구를 현재 구현에 맞춤(Blog "운영 저장·증거 경로 미연결" → 수동 작업·증거 흐름 / Threads "계정 연결 없음" → 연결·모의 실행 가능, 실행기 없음·gate 닫힘 / Instagram "미디어 저장·권리 없음" → 초안·미디어 권리 가능, OAuth·이미지 첨부·실행기 없음). prepare의 Instagram 비활성 사유도 이 값을 사용 |
| `src/components/distribution-console/states.tsx` | IdLine "(조회 경로 미연결 · 존재 여부 미확인)" → "(주소의 값 · 존재 여부는 아래 조회 결과로 확인)". **CapabilityTable**: 정적 `caps.connected`(항상 false)를 "연결 상태: 연결 안 됨"으로 표시하던 문장 제거 → "이 표는 기능 검증 상태만, 계정 연결 여부는 각 채널 연결 화면에서 확인"(Master 후속 지시) |
| `src/app/admin/distribution/connections/page.tsx` | Threads 계정·마지막 확인을 "없음/미확인" 단정 대신 "Threads 계정 연결 화면에서 확인". Instagram 비활성 사유 정정 + 사용 가능한 미디어·권리 화면 링크 |
| `src/app/admin/distribution/contents/[contentId]/channels/[channel]/page.tsx` | Instagram 안내 "미디어·권리 기능이 준비되면 연결" → 첨부 화면 없음 명시 + 미디어·권리 링크 |
| `src/app/admin/distribution/page.tsx` | 개요 "조치 필요 · 최근 작업"의 `NotConnected`(운영 데이터 미연결 단정) 제거 → 예약·작업 화면 안내(건수 집계 없음 명시) |
| `src/app/admin/page.tsx` | 콘솔 진입 카드 문구: "저장·예약·게시 불가" → 채널별 실제 범위 + 자동 게시·예약 닫힘. (관리 페이지 중 콘텐츠 배포 진입 블록만 수정) |
| `tests/distribution-front/channel-release.test.ts` (신규) | 10개: 채널 문구 정합·과장 금지, 카드 렌더, 셸 기본 안내/gateNotice 우선, CapabilityTable connected 비표시, IdLine, 끊긴 링크 0, /me→/admin→콘솔, Instagram 미디어 링크·OAuth 경로 미생성·비활성 유지, 개요 NotConnected 제거 |

## 3. 검증 (Node 24.22.3, PGLITE_PROJECT 설정)
| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run`(전체) | 0 | **39 files · 668 passed · skip 0** |
| `npm run lint` | 0 | 오류 0 / 기존 경고 3 |
| `npm run typecheck` | 0 | |
| `npm run build` | 미실행 | Master 담당(지시서) |
작업 트리의 다른 담당 미커밋 변경 포함 상태에서 실행.

## 4. 실측/미실측·남은 문제
- 브라우저 실측 없음(배포 후 Master 검증). 실제 DB·Threads 계정·네이버 확장 동작 미검증.
- 개요의 작업 요약(조치 필요 상위 N건)은 신규 기능이라 넣지 않음.
- `NotConnected` 컴포넌트는 이제 미사용 export(삭제하지 않음).
- `currentCapabilities`/`unverifiedCapabilities`의 `connected:false` 값 자체는 lib 모델이라 변경하지 않음 — UI에서 연결 상태로 읽지 않게만 정리.

## 5. SHA-256 (동결 시점)
| 파일 | SHA-256 |
|---|---|
| src/components/distribution-console/console-shell.tsx | 7384ED3A3E0D0C6E23E06A45C7A760C173F1E40B95B2BBACCA0409B26D5D165A |
| src/components/distribution-console/readiness.ts | C335F7E15D5578A6F1B7C7AE39C6306847315F02676F06166DEADCEDC8142302 |
| src/components/distribution-console/states.tsx | CF84E2C2E0529CFDFB00A8A023C8B7B140BA0E8D4CD126162A9988DD7080E608 |
| src/app/admin/distribution/page.tsx | BEE0E69C30D0417F4B293426169A9D65E4E351DDF5F4EF2FE847F78018692AB9 |
| src/app/admin/distribution/connections/page.tsx | DB7C5CE6AA3F9807B2B02C33D7D69E8B00A78E6702F7F85757D8329559096B2A |
| src/app/admin/distribution/contents/[contentId]/channels/[channel]/page.tsx | 8F493C15835EEA82B5B10F2D3C0F04165CA58FAEF1188F4C2ABFA33608940F46 |
| src/app/admin/page.tsx | 57641952A14919EBA258DFC755B024DF3A0D91DEEA99F22174949CDCD8C29A9A |
| tests/distribution-front/channel-release.test.ts | B3AE46933AA5399B98EE475124A80D45BA43BA922E72BFDC76C9F59660A55CDE |

## 6. 정정 이력 — follow-up task_8e7ad286ef3d / ctx_93fcb9c5381f (재동결)
- 사실 오류 1건 정정(Master 지적): `CHANNEL_INFO.threads.blocked`의 "모의 실행 작업도 아직 실행되지 않습니다"는 `jobs/actions.ts` `runDryRunAction → runThreadsDryRun`과 `jobs/[jobId]/page.tsx`의 모의 실행 ActionForm(관리자 수동 실행)이 이미 연결된 사실과 충돌.
  → "게시 실행기(워커)가 없고 live gate가 닫혀 있어 실제 게시·자동 예약은 할 수 없습니다. 모의 실행은 자동으로 돌지 않으며, 관리자가 작업 상세에서 직접 실행할 수 있습니다(외부 게시 없음)."
- `channel-release.test.ts` 보강: 정정 문구 포함·구 문구 부재, actions.ts의 runDryRunAction→runThreadsDryRun 호출, 작업 상세의 `<ActionForm action={runDryRunAction}` 연결을 단언.
- 검증: `npx vitest run tests/distribution-front` exit 0 · 3 files 61 passed / `npm run typecheck` exit 0 / 변경 2파일 `eslint` exit 0. build·전체검사·배포는 Master.
- 관찰(범위 밖, 미수정): `contents/[contentId]/prepare/page.tsx` 모의 실행 안내의 "실행기(워커·스케줄러)가 아직 없어 실행되지 않으며"도 같은 오해 소지가 있음 — 수정 여부 Master 판단.
- 재동결 해시:

| 파일 | SHA-256 |
|---|---|
| src/components/distribution-console/readiness.ts | 0ED359418E947556C91638CDA876EDE92312F0414CC237C13B4F804F4DCFC6EC |
| tests/distribution-front/channel-release.test.ts | 06958D2D34D6BB872FC024C3191EA37F0F45E3415013682B5BE18859040EEC2B |
(나머지 6개 파일 해시는 §5와 동일 — 이번 정정에서 미변경)

## 7. 정정 이력 2 — follow-up task_f67db9c52e09 / ctx_4ab82a675114 (최종 재동결)
- `contents/[contentId]/prepare/page.tsx` 주석(19행)·Threads 안내 본문 정정: 구 "실행기(워커·스케줄러)가 아직 없어 실행되지 않으며 … 계정 연결(OAuth)·토큰 저장·live gate가 준비되지 않아 닫혀 있습니다" →
  "모의 실행 대기 작업 생성 → 자동 실행기(스케줄러) 없음 → 작업 상세의 '모의 실행' 버튼으로 관리자가 직접 실행 / 모의 실행은 게시 아님, 작업 생성 ≠ 모의 실행 완료 / 실제 게시(live)는 게시 실행기 없음·live gate 닫힘 / 계정 연결은 Threads 연결 화면에서 따로 확인, 연결 ≠ 게시 가능(운영 설정 검증 별도)". OAuth·토큰 저장 "미구현" 단정 제거(실제로는 Threads OAuth·암호화 저장 코드 존재, 운영 설정 검증은 별도).
- `channel-release.test.ts`: prepare 안내의 수동 실행 경로·스케줄러 없음·gate 닫힘 포함, 구 단정 문구 부재, 작업 상세 링크(`/admin/distribution/jobs/${openThreadsDry.id}`) 존재 단언 추가.
- 검증: `npx vitest run tests/distribution-front` exit 0 · 3 files 61 passed / `npm run typecheck` exit 0 / 변경 2파일 eslint exit 0. 전체 build·test·배포는 Master.
- **최종 동결 해시**(034 전체 기준, 나머지는 §5 동일):

| 파일 | SHA-256 |
|---|---|
| src/components/distribution-console/console-shell.tsx | 7384ED3A3E0D0C6E23E06A45C7A760C173F1E40B95B2BBACCA0409B26D5D165A |
| src/components/distribution-console/readiness.ts | 0ED359418E947556C91638CDA876EDE92312F0414CC237C13B4F804F4DCFC6EC |
| src/components/distribution-console/states.tsx | CF84E2C2E0529CFDFB00A8A023C8B7B140BA0E8D4CD126162A9988DD7080E608 |
| src/app/admin/distribution/page.tsx | BEE0E69C30D0417F4B293426169A9D65E4E351DDF5F4EF2FE847F78018692AB9 |
| src/app/admin/distribution/connections/page.tsx | DB7C5CE6AA3F9807B2B02C33D7D69E8B00A78E6702F7F85757D8329559096B2A |
| src/app/admin/distribution/contents/[contentId]/channels/[channel]/page.tsx | 8F493C15835EEA82B5B10F2D3C0F04165CA58FAEF1188F4C2ABFA33608940F46 |
| src/app/admin/distribution/contents/[contentId]/prepare/page.tsx | DB7B742179D6D0731E8AA0548D3CA0011D83ED1E304BAB762696EA73C3C3DF3D |
| src/app/admin/page.tsx | 57641952A14919EBA258DFC755B024DF3A0D91DEEA99F22174949CDCD8C29A9A |
| tests/distribution-front/channel-release.test.ts | C748D72CF64D86DDD7069B7A1B0E9EA2575F197713ED137DFE87361949AC6E69 |
