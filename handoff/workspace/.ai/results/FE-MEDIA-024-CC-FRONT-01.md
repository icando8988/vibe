# FE-MEDIA-024 — Claude(Front) CC-FRONT-01 결과 (1단계: 표시·폼 컴포넌트 완료, 실연결은 Backend 확정 대기)

- 출처: Master msg_e3e4386351b6(배정), msg_62cc309afde0(계약 공유). 계약: `docs/contracts/MEDIA_FRONT_CONTRACT.md`(§0-A 잠정).
- 착수 보고: msg_924bc434fb3c. Backend 잠정 계약 수신 회신: msg_8e955e1bb511.
- 수정 금지 준수: states.tsx·console-shell.tsx(Design 수정 구간)·globals·package·next.config·API·server·SQL·write-notice 미수정. 공용 `action-form.tsx`는 import만.

## 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `web/src/components/distribution-console/media-labels.ts` (신규) | 처리 상태·권리·출처·채널 라벨, 처리 실패 코드 설명(정책 수치 그대로), KST·크기·픽셀 형식, 상태별 권리 결정 선택지, 권리 사용 가능 판정, DB 거절 토큰 안내, 요청 시각 helper |
| `media-asset-list.tsx` (신규) | 목록: 준비 전 / 권한 없음 / 조회 오류 / 조회 성공 0건 / 목록 분리, 처리 상태·권리 상태 다른 열, 권리 유효기한 지남 표시, 선택 행(aria-current) |
| `media-asset-detail.tsx` (신규) | 상세 사실: 처리·권리 두 축 태그와 안내, 출처, 원본 규격(원본 미저장 명시), 변환본 규격·sha256 앞 12자, 실패 이유, 허용 채널, 유효기한 KST, 보관(되돌릴 수 없음), 버전 |
| `media-forms.tsx` (신규) | 권리 결정 폼(상태별 가능한 결정만, 채널·유효기한 KST·사유 ≤1000, expectedVersion=렌더 rowVersion), 보관 폼(되돌릴 수 없음 확인 필수, 사용 중 거부 안내), 업로드 패널(비활성+이유, 정책 수치 안내). 액션이 없으면 **제출 경로 없는 비활성 fieldset + 이유**, 액션이 생기면 공용 ActionForm(잠금·입력 유지·결과 불명 새로고침) |
| `media.module.css` (신규) | 선택 행·두 축 태그·규격 숫자·채널 체크박스(44px 터치 높이) 보조 스타일만 |
| `web/src/app/admin/distribution/media/page.tsx` | 자리표시 교체: 업로드 패널(비활성) + 목록(현재 준비 전) |
| `web/src/app/admin/distribution/media/[assetId]/page.tsx` | 자리표시 교체: 준비 전 안내 + 연결 후 할 일 목록 |
| `web/tests/distribution-front/media-ui.test.ts` (신규) | 렌더 시험 13개 |

## 2. 계약 반영
- 처리 완료(ready) ≠ 권리 승인 — 목록·상세 모두 두 축을 분리하고 "처리는 끝났지만 권리 미승인이면 게시에 못 씀"을 표시.
- 권리 결정 선택지: approved는 ready만, approved 상태면 revoked만, 그 외 rejected 가능, 보관 자산은 폼 없음(서버 INVALID_TRANSITION이 최종).
- 준비 전·조회 오류를 0건으로 바꾸지 않음. 0건은 "조회 성공 · 0건"일 때만.
- 업로드: HTTP 요청 한도·전송 방식·bucket 계약 확정 전 비활성+이유(20MB 서버 정책을 브라우저 업로드 허용으로 단정하지 않음). 파일 입력·외부 URL 입력·미리보기(`<img>`)·issuePublishUrl·서명 URL 없음(정적 시험으로 고정).
- 서버 런타임은 type만 import(`MediaAssetDto`) — `media/service` 런타임 import·`media/session` import 없음(정적 시험).
- 컴포넌트는 렌더 중 시계를 읽지 않음(react-hooks/purity) — 페이지가 요청 시각을 한 번 구해 넘김.

## 3. 아직 연결하지 않은 것(정확히)
- `media/session.ts`(getMediaMetadataDeps·getMediaDeps·mediaReadiness)와 `errors.ts` mediaErrorReason이 **아직 파일로 없음(잠정)** → import하면 build가 깨지므로 가짜 shim 없이 대기. 현재 두 페이지는 서버를 부르지 않고 "미디어 저장 준비 전"만 표시.
- 확정 알림 후 할 일: `app/admin/distribution/media/actions.ts`(decideRights·archiveAsset 얇은 server action, 성공 시 redirect, 실패 시 mediaErrorReason ?? code 안내·결과 불명은 재시도 없음), 목록 `listAssets(getMediaMetadataDeps())` 결과로 view 결정(metadata=false → not_ready, denied, db_error/bad_response → error, ok), 상세는 목록 결과의 해당 자산으로 MediaAssetFacts·폼 렌더, 권리·보관 폼은 **실제 목록 조회 성공 시에만** 활성(metadata 신호만으로 켜지 않음), 업로드는 계속 비활성.

## 4. 검증
| 명령 | 결과 |
|---|---|
| `npx vitest run tests/distribution-front/media-ui.test.ts` | 13 passed |
| `npx vitest run`(전체) | 27 files · 550 passed · 33 skipped(PGlite 전용) |
| `npx tsc --noEmit` | 0 |
| `npm run lint` | 0 error(범위 밖 기존 경고 3) |
| `npm run build` | 성공(`/admin/distribution/media`, `/media/[assetId]` dynamic) |
- **브라우저 실측: 하지 않음(미실측)** — 로그인 세션 필요, 현재 화면은 준비 전 상태뿐. 렌더 시험은 서버 렌더 문자열 검사.
- 배포: 없음(commit/push 안 함).

## 5. 차단·의존
- Backend BE-MEDIA-024 session.ts·mediaErrorReason "확정" 알림 대기.
- 실 Storage·bucket 미준비 → 업로드는 계약 확정까지 비활성 유지.
- 원문/채널 미디어 선택 UI는 이 화면 완료 후 별도 배정(이번에 안 함).
