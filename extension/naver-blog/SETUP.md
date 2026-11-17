# 네이버 블로그 입력기 (이식본) — 출처와 설정

## 출처
- 원본: `Blog_Posting_Kit_v1.07/ai-auto-blog/extension/` (BUYLIFE 블로그 포스팅 자동화 배포판 v1.07, 확장 v1.87)
- 저작권 고지: 같은 폴더의 `NOTICE`(원본 그대로)
- 이식: AUTOPOST-SOURCE-PORT-001, 2026-11-16. 원본 폴더는 수정하지 않았다.
- **이 폴더는 공개 저장소에 커밋하지 않는다.** 저장소가 private로 바뀐 뒤에만 커밋한다(키트 안내: GitHub 저장소 안에 두지 말 것).

## 원본 대비 변경
| 파일 | 변경 |
|---|---|
| `config.js` | **신규.** 사이트 주소(`SITE_ORIGIN`, 기본 빈 값)와 `API_READY`(기본 false), 확장 API 경로(`/api/distribution/extension/*`). 준비 전이면 요청을 보내지 않고 "연결 준비 전" 오류 |
| `background.js` | 원본 운영 서버 주소 상수 제거. 모든 서버 요청이 `requireSite()`를 거친다. API 경로를 config로 이동(`posts/{id}` → `jobs/{id}`). 메시지 출처 검사를 원본 운영 주소 2개 → `SITE_ORIGIN` 하나로 |
| `sidepanel.js` | 서버 주소 상수 제거, `requireSite()` 사용. 자동 연결은 콘솔 연결 화면(`/admin/distribution/connections`)을 연다. 업데이트 링크는 내 사이트 상대 경로만 허용 |
| `web-bridge.js` | 원본 운영 주소 2개 대신 `SITE_ORIGIN`만 허용(미설정이면 아무것도 하지 않음) |
| `sidepanel.html` | 원본 서버 링크와 브랜드 표시를 제거하고 `config.js`를 로드 |
| `manifest.json` | 이름 변경. 빌드 자리표시(`__SITE_URL__`, `__SUPABASE_URL__`)와 content_scripts 제거 → 기본 상태에서는 네이버 외 어떤 사이트에도 접근 권한이 없다 |
| `blog-core.js`, `blog-engine.js`, `naver-adapter.js`, `naver-page.js`, `styles.css`, `icons/` | **변경 없음.** 최종 [발행] 버튼(`seOnePublishBtn`)은 원본대로 찾지도 누르지도 않는다(설정창만 연다) |

## 설치 (압축 해제 방식, zip 없음) — 개발·진단용 절차
이 절은 개발자용이다. 관리자용 설치 안내·배포본은 아직 준비 전이다(관리 화면에도 그렇게 표시된다).
서버 API는 코드로 구현됐지만(아래 표) 실제 DB 적용·브라우저 실측 전이라, 배포 확장은 `API_READY=false`로 **연결 준비 전** 상태를 유지한다. 검증이 끝난 뒤 아래를 설정한다.
1. `config.js`
   - `SITE_ORIGIN`: 내 사이트 origin(예: `https://<내 도메인>`, 끝 슬래시 없음)
   - `API_READY`: `true`
2. `manifest.json`에 같은 origin을 추가한다.
   - `"host_permissions"`에 `"<SITE_ORIGIN>/*"`
   - 아래 블록 추가(사이트 화면 ↔ 확장 연결 코드 전달용):
     ```json
     "content_scripts": [{ "matches": ["<SITE_ORIGIN>/*"], "js": ["config.js", "web-bridge.js"], "run_at": "document_start" }]
     ```
   - 글에 이미지가 있고 이미지가 다른 호스트(예: Supabase Storage)에 있으면 그 origin도 host_permissions에 추가한다.
3. Chrome `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → 이 폴더 선택
4. 사이드패널에서 관리 화면에서 발급한 연결 코드(`pat_…`)와 네이버 블로그 ID를 저장

## 사이트 API 계약 (서버 코드 구현: TOKEN-005·HANDOFF-007 — 실DB·브라우저 미검증)
모든 요청은 `Authorization: Bearer pat_…`. 응답은 no-store이며 CORS 헤더가 없다(확장은 host_permissions로 호출).
401 = 토큰 무효·만료·철회 또는 소유 관리자가 더 이상 승인 상태가 아님. 503 = 서버 준비 전·일시 오류.

| 경로 | 방식 | 요청 | 응답 |
|---|---|---|---|
| `/api/distribution/extension/whoami` | GET | — | `{ ok: true, connected: true }` = **토큰 인증만 확인**(이메일·권한·버전 없음. 블로그 일치·작업 가능을 뜻하지 않음) / 401 / 503 |
| `/api/distribution/extension/task` | POST | `{}` | `{ task: null }` 또는 `{ task: { id(작업 ID), runId, leaseSeconds, title, blocks[], tags[], category: null } }`. 관리자가 "확장으로 보낸" 30분 이내의 본인 요청만, 작업당 1회. title = 승인된 원문 버전 제목, blocks = 승인된 리비전 본문 |
| `/api/distribution/extension/jobs/{id}/heartbeat` | POST | `{ runId }` | `{ ok, leaseSeconds }` / 409(superseded: 다른 run·토큰, 리스 만료, 원문·승인 변경 → 입력 중지) / 404 |
| `/api/distribution/extension/jobs/{id}/input-result` | POST | `{ status: in_progress\|completed\|publish_ready\|failed, error?, runId }` | `{ success, persisted, status, unchanged }` / 409 / 400. **입력 결과는 게시가 아니다** — 서버는 작업을 published·증거 대기로 바꾸지 않는다. error는 `[CODE]` 접두어만 저장 |

리스(3분)가 끝나면 서버는 인계를 "확인 필요"로 두고 **자동으로 다시 보내지 않는다**(이미 입력됐을 수 있음).
