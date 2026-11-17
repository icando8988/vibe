# QA-TESTER-001 — 기준선 재현 · 미디어 화면 · 업로드 실패 경로 · 채널 서버 시험 공백 (결과)

담당: CC-TESTER-01 Claude(Tester) / Orca term_e0acaf6c-d971-442d-a40b-82bf98efc36c (Claude 세션 이름 vibe-2e). 2026-11-17.
지시: 사용자 직접 지시. 역할은 테스트·디버깅·기능 확장 제안이다.
방법: 로컬 실행·읽기·저장소 밖 탐침 시험. **앱 소스·시험·설정은 수정하지 않았다.** 새로 만든 파일은 이 결과 문서 1개다. env 값과 비밀 파일은 열어 보지 않았다. 실제 DB·Storage·외부 호출·배포·commit은 하지 않았다. 업로드·복구 코드는 동결 상태라 결함을 찾아도 보고만 한다.

## 1. 기준선 재현 (Node 24.22.3 + PGlite 0.5.16, `%TEMP%\vibe-resume-20261117`)
| 항목 | 결과 |
|---|---|
| `npm test` | 39개 파일·667개 통과, **skip 0**, 실패 0 |
| `npm run typecheck` | 통과 |
| `npm run lint` | 오류 0, 경고 3(기존과 같음: naver-blog background.js·sidepanel.js, m2-run.mjs) |
| `npm run build` | 통과 |

- 작업 트리에 다른 담당의 미커밋 변경(Front 미디어 화면 등)이 섞인 상태에서 돌린 결과다.
- 참고: 시스템 Node는 v26.13.1이고 `.nvmrc`는 24다. 기본 Node(26)로 돌리면 PGlite 시험 8개 파일이 skip된다.

## 2. FE-MEDIA-024 화면 점검 (ego lite, `next dev -p 3107`)
- **차단: 실제 미디어 화면은 확인하지 못했다.** `.env.local`(Supabase 설정)이 없어서 관리자 인증 경계가 모든 `/admin/**`를 막는다. 목록·상세·업로드 패널은 화면에 그려지지 않는다. 실 Supabase(또는 로컬 Supabase)와 관리자 계정이 있어야 점검할 수 있다.
- 확인된 것: `/admin/distribution/media`, `/media/[assetId]`, `/admin`에서 "관리자 확인이 필요합니다" 안내가 정상으로 나온다. 응답 헤더에 `Cache-Control: no-store`와 `X-Robots-Tag: noindex, nofollow`가 있고, meta robots도 noindex다. 공개 홈(`/`)도 정상 렌더된다.
- 참고(낮음): 거부 화면의 HTTP 상태는 200이다. 401/403이 아니어서 모니터링에서 정상 응답으로 보인다. 의도된 설계라면 그대로 두어도 된다.

## 3. 업로드 흐름 실패 경로 점검 (코드 읽기 + 저장소 밖 탐침 시험)
탐침 방법: `createSupabaseIntakeStorage`에 SDK mock을 넣고 `completeUpload`를 직접 호출했다. 저장소에는 파일을 추가하지 않았다.

### R-QA-01 (중간) — 0바이트 또는 20MB 초과 intake 객체면 `storage_error`가 영구 반복된다
- 재현: intake 객체가 `size 0`이거나 `size > 20MB`이면 `downloadCapped`(`storage-supabase.ts:104`)가 `storage_error`를 낸다. 그러면 `completeUpload`가 `{status:"storage_error"}`(502)를 돌려주고, 이때 grant는 소비되지 않는다. 같은 grant로 다시 완료해도 매번 `storage_error`다(탐침에서 2회 연속 확인, RPC는 get만 호출됨).
- 문제: 계약(`MEDIA_UPLOAD_CONTRACT.md` §응답표 68행)은 `storage_error`를 "잠시 뒤 사용자 조작으로 재전송 가능"으로 정의한다. 그런데 이 두 경우는 다시 보내도 결과가 바뀌지 않는다. 사용자는 grant가 만료되거나 직접 취소할 때까지 재시도만 하게 된다. 0바이트는 원래 `EMPTY_INPUT`이나 `DECLARED_MISMATCH` 실패로 끝나야 할 입력이다. 원본도 지워지지 않아 sweep 대상으로 남는다.
- 제안(동결 해제 뒤 Backend 판단):
  - (a) 크기 위반을 `storage_error`와 구분되는 실패 코드로 돌려준다. 예: `too_large`·`empty`를 따로 두거나, grant를 소비하고 `failed: INPUT_TOO_LARGE / EMPTY_INPUT`으로 끝낸다.
  - (b) 최소한 Front 안내에서 "다시 시도"가 아니라 "취소 후 새로 업로드"로 이끈다.
- 전제 확인 필요: intake bucket의 `file_size_limit`(20MB)이 서명 업로드에도 실제로 적용되는지. 계약 실측 항목 5번이다. 적용된다면 20MB 초과 경우는 실제로 생기지 않는다. 반면 0바이트 PUT은 bucket 제한으로 막히지 않을 가능성이 높다.

### R-QA-02 (낮음, 실측 항목) — 크기 검사는 다운로드 뒤에 한다
- `downloadCapped`는 SDK `download()`가 Blob을 다 받은 뒤 `blob.size`를 검사한다. `arrayBuffer` 변환은 하지 않는 것을 탐침으로 확인했다. 하지만 fetch 본문은 이미 메모리에 올라온 상태다. bucket 제한이 서명 업로드에 적용되지 않으면 큰 객체가 서버 메모리를 쓴다. R-QA-01의 전제 실측과 같이 확인하면 된다.

### R-QA-03 (확인 요청) — `Origin` 일치 검사와 프록시
- `readJsonBody`는 `Origin`이 `new URL(request.url).origin`과 같아야 통과시킨다(`upload-http.ts`). Vercel 등 운영 프록시 뒤에서 `request.url`의 host가 공개 도메인과 다르면 모든 업로드 요청이 `invalid_request`(400)가 된다. 시험에는 `x-forwarded-host` 같은 프록시 상황이 없다. Threads start는 `NEXT_PUBLIC_SITE_URL` 기준으로 비교한다. 두 방식이 다른 이유를 확인하고, 실배포에서 한 번 실측하기를 제안한다.

### 정상 확인
- 신고 형식(magic)·크기 불일치는 `DECLARED_MISMATCH`로 처리된다. 실패 기록을 확인한 경우에만 원본을 지운다(RECOVERY-030). 동시 완료는 원자 소비로 `grant_used`가 된다. 서명 URL은 issued 응답에서만 노출된다. 본문은 4KB로 제한되고, content-length를 속여도 실제 바이트 수로 다시 검사한다.

## 4. 채널 배포 서버 시험 공백 (BE-CHANNEL-RELEASE-035 보완, 읽기만)
시험 파일이 직접 import하지 않는 모듈:
| 모듈 | 공백 | 위험 |
|---|---|---|
| `app/api/distribution/oauth/threads/start/route.ts` | 라우트 수준 시험 없음: Origin 불일치 → `invalid_request`, formData 파싱 실패, 설정 미비(`not_ready`)에서 Origin 검사를 건너뛰는 분기 | 중간: CSRF 경계가 라우트에 있다 |
| `app/api/distribution/media/upload/cancel/route.ts` | 라우트 시험 없음(grant·complete 라우트는 있음) | 낮음: 같은 helper를 쓴다 |
| `server/distribution/content-page.ts`, `read-session.ts` | 직접 시험 없음(페이지에서만 사용) | 낮음 |
- Backend 결론(차단 결함 없음, live 게시 미구현)과 다른 점은 찾지 못했다.

## 5. 다음 작업 제안
1. 실 Supabase 연결(또는 로컬 Supabase) 준비 후 FE-MEDIA-024 화면과 업로드 흐름을 ego lite로 끝에서 끝까지 실측한다. 계약 실측 6건 포함, Master 승인 필요.
2. R-QA-01 처리 방향 결정(Backend/Front). 동결 해제 시점은 Master가 정한다.
3. 시험 공백 보강: threads start 라우트 시험과 cancel 라우트 시험을 Tester가 새 시험 파일로 작성한다(기존 파일은 수정하지 않는다). Master 승인 시 진행한다.

## 6. 수정·흔적
- 저장소 변경: 이 문서 1개만 추가했다.
- 저장소 밖: scratchpad의 탐침 시험과 ego 스크린샷. dev 서버(3107)와 ego task space는 종료했다.
