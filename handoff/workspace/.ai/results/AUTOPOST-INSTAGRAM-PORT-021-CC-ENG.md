# AUTOPOST-INSTAGRAM-PORT-021 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_35f587fa2b73 / dispatch ctx_1532a6dba859 / 2026-11-17
- 범위 준수: `src/server/distribution/instagram/**`, `tests/distribution-server/instagram-client.test.ts`, 이 결과 파일만. UI·SQL·다른 모듈·확장·package·키트 원본 미수정. 실DB·실계정·키/env 열람·실플랫폼 API·외부 게시·commit/push 없음. 네트워크는 공식 문서 읽기만.
- **구분: 실제 이식 = 공급자 HTTP 부품 4단계 + 결과 계약. 검증 = mock fetch 단위 시험뿐. 운영 = 미완료(OAuth·토큰 연결·M4 미디어·live 실행기·capability 승격·live gate 해제 모두 없음). 어떤 화면·실행기도 이 모듈을 import하지 않는다(rg 0건).**

## 1. 이식 파일(키트 파생 — 공개 release 제외 유지)
- `instagram/NOTICE` — 키트 `insta_auto_poster/NOTICE` 원문 그대로(cmp 동일).
- `instagram/types.ts` — 상태 5개·정제 오류·결과 계약(create/status/publish/permalink/합성), DI fetch 타입.
- `instagram/client.ts` — 원본 `publish.ts`에서 Instagram 로그인 경로 단일 이미지만:
  1. `createImageContainer` POST `/<IG_ID>/media`(image_url, caption ≤2200, alt_text ≤1000) — 게시 아님. timeout·유실이면 definite=false.
  2. `getContainerStatus` GET `?fields=status_code` 1회 — 폴링 반복은 호출자(워커).
  3. `canRequestPublish` — FINISHED에서만 true(**FINISHED = 게시 준비됨, 게시 아님**; PUBLISHED도 요청 대상 아니며 게시 확정 근거로 쓰지 않음).
  4. `publishContainer` POST `/<IG_ID>/media_publish`(creation_id) **1회** — 2xx+ID → published(config_issue는 부분 성공 표시), 4xx 명시 거절/auth/rate_limited → rejected, **timeout·응답 유실·5xx·2xx 무ID → unknown**(재전송 0).
  5. `getPermalink` GET `?fields=permalink` — 실패해도 게시 실패 아님, instagram.com https만 신뢰.
  6. `combinePublishOutcome` — permalink 실패 시 **게시 확인 + URL 미확인**(urlConfirmed=false).
  - 원본 일괄 `publishInstagramPost`·캐러셀·Facebook 로그인·OAuth·계정 조회는 미이식. create와 publish를 이어 부르는 helper 없음(시험으로 export 목록 고정) → 워커가 컨테이너 ID DB 선기록 후 publish.
  - **원본 K4 수정**: `postGraphWithRetry`가 media_publish "Timeout"도 재시도하던 것 제거 — 어떤 요청도 재시도하지 않음.
  - fetch 주입만(기본 실 fetch 없음), 요청별 timeout(15초), `redirect:"error"`, `no-store`. 공급자 메시지·토큰·요청 URL·이미지(서명) URL은 결과·로그에 없음(console 없음).
  - **서버 내부 계약**: image_url은 미디어 계층(M4)이 검증한 공개 HTTPS URL만 받는다. 서버가 임의 URL을 다운로드하지 않으며 형식만 확인(https, 호스트, 자격정보·fragment·제어문자 없음, ≤2048자, localhost 거부). 공급자 호스트·경로는 상수(임의 endpoint 없음).

## 2. 공식 문서 대조(2026-11-17, 읽기만)
| 항목 | 근거 | 채택 |
|---|---|---|
| 호스트 | instagram-platform/overview: Instagram 로그인 앱은 `graph.instagram.com` | 같음 |
| 버전 | ig-user/media·ig-media: 최신 v27.0(미지정 시 앱 생성 시점 버전) | **v27.0 고정**(원본 v25.0) |
| 컨테이너 | ig-user/media: POST /<IG_ID>/media, image_url 필수·공개 서버, caption ≤2200, alt_text ≤1000, 응답 id, 24시간 만료, 24시간 400개 | 같음 |
| 이미지 규격 | JPEG만(MPO/JPS 불가), ≤8MB, 4:5~1.91:1, 폭 320~1440, sRGB | **검사하지 않음 — M4 의존**(URL 형식만) |
| 상태 | ig-container: EXPIRED·ERROR·FINISHED("ready to be published")·IN_PROGRESS·PUBLISHED, 1분 1회·5분 이내 권장 | 원본은 FINISHED/ERROR/EXPIRED만 처리 → 5개 모두 수용 |
| 게시 | media_publish: creation_id → id, config_issue 부분 성공 | 같음 |
| 게시 한도 | content-publishing 100/24h vs media_publish·캐러셀 절 50/24h — **문서 내 불일치, 미확정** | 강제하지 않음(rate_limited 분류만) |
| 토큰 전달 | content-publishing POST 예시: `Authorization: Bearer` + JSON. 참조 페이지·GET 예시: access_token 쿼리 | POST는 Bearer+JSON(토큰이 URL·본문에 없음). GET은 문서 규격대로 쿼리(URL은 함수 밖으로 안 나감) — **GET Bearer 지원은 미검증** |
| permalink | ig-media: permalink 필드(앨범 하위 사진 제외) | 같음 |
- 미검증: 실제 응답 형식·오류 코드(예시 코드 9007·36003은 시험용 값일 뿐), GET Bearer, JSON 본문 실제 수락(문서 예시 기준), 한도 수치.

## 3. 검증
- `instagram-client.test.ts` 12개(mock fetch): export 목록(일괄 helper 없음), 이미지 URL 형식 거부 9종, 컨테이너 POST 1회·공식 호스트/버전·Bearer·JSON 본문·URL/본문에 토큰 없음·publish 미호출, 잘못된 입력 요청 0회, timeout definite=false·재시도 0·4xx definite=true, 공급자 메시지에 토큰·서명이 섞여도 결과 비노출, redirect 거부 설정, 상태 5개 수용·이상값 거부, FINISHED에서만 게시 요청, publish 1회·config_issue, timeout/유실/5xx/2xx무ID → unknown·재전송 0, 4xx rejected·190 auth·429 rate_limited, permalink 실패 → 게시 확인+URL 미확인, 다른 호스트 permalink 거절.
- 전체: vitest 24 files · 511 passed · 28 skipped(PGlite 전용) / tsc 0 / lint 0 error(기존 경고 3) / build 성공.

## 4. 다음 단계 제안
- **M4 미디어 최소**: 자산·변형 테이블(소유·권리 상태·허용 채널·유효기한·체크섬·규격 메타: JPEG·크기·비율·폭), 비공개 Storage 버킷 + 게시 시점 짧은 서명 URL 발급(만료 기록), JPEG 변환(sharp는 package 승인 필요), 리비전 미디어 ↔ 자산 FK, live gate 미디어 조건. image_url은 이 계층이 만든 서명 URL만 넘긴다.
- **Instagram OAuth**: Threads OAuth-019 구조 재사용(oauth_states channel 확장 migration, `instagram.com/oauth/authorize` → `api.instagram.com/oauth/access_token` → `graph.instagram.com/access_token` ig_exchange_token은 키트 기준이며 공식 문서 재대조 필요), scope instagram_business_basic·instagram_business_content_publish, M3 암호화 저장, env `INSTAGRAM_APP_ID`·`INSTAGRAM_APP_SECRET`.
- 그 뒤: Instagram live 실행기(컨테이너 선기록 → 상태 폴링 → FINISHED에서만 publish → unknown/permalink 처리), capability 검증, live gate 조건.
- 공개 release: `src/server/distribution/instagram/**`·`instagram-client.test.ts`는 키트 파생이므로 저장소 private 전환 전 커밋 금지.
